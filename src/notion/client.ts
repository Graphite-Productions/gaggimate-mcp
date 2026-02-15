import { Client } from "@notionhq/client";
import type { NotionConfig, BrewData, PushStatus, BrewFilters, BeanFilters } from "./types.js";
import { brewDataToNotionProperties } from "./mappers.js";

export class NotionClient {
  private client: Client;
  private config: NotionConfig;

  constructor(notionConfig: NotionConfig) {
    this.config = notionConfig;
    this.client = new Client({ auth: notionConfig.apiKey });
  }

  /** Check if the Notion API connection is working */
  async isConnected(): Promise<boolean> {
    try {
      await this.client.users.me({});
      return true;
    } catch {
      return false;
    }
  }

  // ─── Brews ────────────────────────────────────────────────

  /** Create a brew entry in Notion from shot data */
  async createBrew(brew: BrewData): Promise<string> {
    const properties = brewDataToNotionProperties(brew);

    // If a profile with matching title exists, link it via the Profile relation.
    const profilePageId = await this.findProfilePageByName(brew.profileName);
    if (profilePageId) {
      properties.Profile = { relation: [{ id: profilePageId }] };
    } else if (brew.profileName) {
      console.warn(`No Profiles DB match found for profile name "${brew.profileName}"`);
    }

    const response = await this.client.pages.create({
      parent: { database_id: this.config.brewsDbId },
      properties,
    });
    return response.id;
  }

  /** Find an existing brew by GaggiMate shot ID (dedup check) */
  async findBrewByShotId(shotId: string): Promise<string | null> {
    const response = await this.client.databases.query({
      database_id: this.config.brewsDbId,
      filter: {
        property: "Activity ID",
        rich_text: { equals: shotId },
      },
      page_size: 1,
    });
    return response.results.length > 0 ? response.results[0].id : null;
  }

  /** List brews with optional filters */
  async listBrews(filters?: BrewFilters): Promise<any[]> {
    const filterConditions: any[] = [];

    if (filters?.startDate) {
      filterConditions.push({
        property: "Date",
        date: { on_or_after: filters.startDate },
      });
    }
    if (filters?.endDate) {
      filterConditions.push({
        property: "Date",
        date: { on_or_before: filters.endDate },
      });
    }

    const queryParams: any = {
      database_id: this.config.brewsDbId,
      sorts: [{ property: "Date", direction: "descending" }],
    };

    if (filterConditions.length > 0) {
      queryParams.filter = filterConditions.length === 1
        ? filterConditions[0]
        : { and: filterConditions };
    }

    const response = await this.client.databases.query(queryParams);
    return response.results;
  }

  /** Update a brew entry */
  async updateBrew(pageId: string, properties: Record<string, any>): Promise<void> {
    await this.client.pages.update({
      page_id: pageId,
      properties,
    });
  }

  // ─── Profiles ─────────────────────────────────────────────

  /** Get all profiles with Push Status = "Queued" */
  async getQueuedProfiles(): Promise<Array<{ pageId: string; profileName: string; profileJson: string }>> {
    const response = await this.client.databases.query({
      database_id: this.config.profilesDbId,
      filter: {
        property: "Push Status",
        select: { equals: "Queued" },
      },
    });

    return response.results.map((page: any) => ({
      pageId: page.id,
      profileName: this.extractTitle(page),
      profileJson: this.extractRichText(page, "Profile JSON"),
    }));
  }

  /** Update the Push Status of a profile page */
  async updatePushStatus(
    pageId: string,
    status: PushStatus,
    timestamp?: string,
  ): Promise<void> {
    const properties: Record<string, any> = {
      "Push Status": { select: { name: status } },
    };
    if (timestamp) {
      properties["Last Pushed"] = { date: { start: timestamp } };
    }
    await this.client.pages.update({
      page_id: pageId,
      properties,
    });
  }

  /** Read the Profile JSON property from a profile page */
  async getProfileJSON(pageId: string): Promise<string | null> {
    const page = await this.client.pages.retrieve({ page_id: pageId }) as any;
    return this.extractRichText(page, "Profile JSON") || null;
  }

  /** Check whether a profile with this name already exists in Notion */
  async hasProfileByName(profileName: string): Promise<boolean> {
    const pageId = await this.findProfilePageByName(profileName);
    return pageId !== null;
  }

  /**
   * Import profiles discovered on GaggiMate into Notion.
   * Create-only behavior: existing Notion profiles are never overwritten.
   */
  async importProfilesFromGaggiMate(profiles: any[]): Promise<{ created: number; skipped: number }> {
    const existingNames = await this.listExistingProfileNames();
    let created = 0;
    let skipped = 0;

    for (const profile of profiles) {
      const profileName = typeof profile?.label === "string" ? profile.label.trim() : "";
      const normalizedName = this.normalizeProfileName(profileName);

      if (!normalizedName) {
        skipped += 1;
        continue;
      }

      // Do not overwrite profiles that already exist in Notion.
      if (existingNames.has(normalizedName)) {
        skipped += 1;
        continue;
      }

      const profileJson = JSON.stringify(profile);
      const description = typeof profile?.description === "string" ? profile.description : "";

      await this.client.pages.create({
        parent: { database_id: this.config.profilesDbId },
        properties: {
          "Profile Name": {
            title: [{ text: { content: profileName } }],
          },
          Description: {
            rich_text: this.toRichText(description),
          },
          "Profile Type": {
            select: { name: this.mapProfileType(profile?.type) },
          },
          Source: {
            select: { name: this.mapProfileSource(profile) },
          },
          "Active on Machine": {
            checkbox: Boolean(profile?.selected),
          },
          "Profile JSON": {
            rich_text: this.toRichText(profileJson),
          },
          "Push Status": {
            select: { name: "Draft" },
          },
        },
      });

      existingNames.add(normalizedName);
      created += 1;
    }

    return { created, skipped };
  }

  // ─── Beans ────────────────────────────────────────────────

  /** List beans with optional filters */
  async listBeans(filters?: BeanFilters): Promise<any[]> {
    const filterConditions: any[] = [];

    if (filters?.roaster) {
      filterConditions.push({
        property: "Roaster",
        select: { equals: filters.roaster },
      });
    }
    if (filters?.buyAgain !== undefined) {
      filterConditions.push({
        property: "Buy Again",
        checkbox: { equals: filters.buyAgain },
      });
    }

    const queryParams: any = {
      database_id: this.config.beansDbId,
    };

    if (filterConditions.length > 0) {
      queryParams.filter = filterConditions.length === 1
        ? filterConditions[0]
        : { and: filterConditions };
    }

    const response = await this.client.databases.query(queryParams);
    return response.results;
  }

  /** Get a specific bean page */
  async getBean(pageId: string): Promise<any> {
    return this.client.pages.retrieve({ page_id: pageId });
  }

  // ─── Helpers ──────────────────────────────────────────────

  private extractTitle(page: any): string {
    const titleProp = Object.values(page.properties).find(
      (p: any) => p.type === "title"
    ) as any;
    return titleProp?.title?.[0]?.plain_text || "";
  }

  private extractRichText(page: any, propertyName: string): string {
    const prop = page.properties?.[propertyName];
    if (!prop || prop.type !== "rich_text") return "";
    return prop.rich_text?.map((t: any) => t.plain_text).join("") || "";
  }

  private async findProfilePageByName(profileName: string): Promise<string | null> {
    if (!profileName) return null;
    const requestedName = this.normalizeProfileName(profileName);
    if (!requestedName) return null;

    // Fast path: exact title match.
    const exactMatch = await this.client.databases.query({
      database_id: this.config.profilesDbId,
      filter: {
        property: "Profile Name",
        title: { equals: profileName.trim() },
      },
      page_size: 1,
    });
    if (exactMatch.results.length > 0) {
      return exactMatch.results[0].id;
    }

    // Fallback: scan profile names to allow case/spacing variations.
    const response = await this.client.databases.query({
      database_id: this.config.profilesDbId,
      page_size: 100,
    });

    for (const page of response.results as any[]) {
      const candidateName = this.normalizeProfileName(this.extractTitle(page));
      if (candidateName === requestedName) {
        return page.id;
      }
    }

    return null;
  }

  private normalizeProfileName(name: string): string {
    return name.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private async listExistingProfileNames(): Promise<Set<string>> {
    const names = new Set<string>();
    let cursor: string | undefined;

    do {
      const response = await this.client.databases.query({
        database_id: this.config.profilesDbId,
        start_cursor: cursor,
        page_size: 100,
      });

      for (const page of response.results as any[]) {
        const normalized = this.normalizeProfileName(this.extractTitle(page));
        if (normalized) {
          names.add(normalized);
        }
      }

      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return names;
  }

  private toRichText(value: string): Array<{ text: { content: string } }> {
    // Notion rich_text content has a per-segment limit; split long JSON safely.
    const chunkSize = 1900;
    if (!value) {
      return [{ text: { content: "" } }];
    }

    const chunks: Array<{ text: { content: string } }> = [];
    for (let i = 0; i < value.length; i += chunkSize) {
      chunks.push({ text: { content: value.slice(i, i + chunkSize) } });
    }
    return chunks;
  }

  private mapProfileType(type: unknown): string {
    const normalized = typeof type === "string" ? type.trim().toLowerCase() : "";
    if (normalized.includes("flat")) return "Flat";
    if (normalized.includes("declin")) return "Declining";
    if (normalized.includes("bloom")) return "Blooming";
    if (normalized.includes("lever")) return "Lever";
    if (normalized.includes("turbo")) return "Turbo";
    return "Custom";
  }

  private mapProfileSource(profile: any): string {
    const label = typeof profile?.label === "string" ? profile.label.toLowerCase() : "";
    if (label === "ai profile") return "AI-Generated";
    if (profile?.utility === true) return "Stock";
    return "Custom";
  }
}
