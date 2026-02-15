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

    const response = await this.client.databases.query({
      database_id: this.config.profilesDbId,
      filter: {
        property: "Profile Name",
        title: { equals: profileName },
      },
      page_size: 1,
    });

    return response.results.length > 0 ? response.results[0].id : null;
  }
}
