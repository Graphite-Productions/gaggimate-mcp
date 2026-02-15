import { Client } from "@notionhq/client";
import type { NotionConfig, BrewData, PushStatus, BrewFilters, BeanFilters } from "./types.js";
import { brewDataToNotionProperties } from "./mappers.js";
import { renderProfileChartSvg } from "../visualization/profileChart.js";

export class NotionClient {
  private client: Client;
  private config: NotionConfig;
  private imageUploadDisabledReason: string | null = null;

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

  /** Set the Profile relation on an existing brew page */
  async setBrewProfileRelation(brewPageId: string, profilePageId: string): Promise<void> {
    await this.client.pages.update({
      page_id: brewPageId,
      properties: {
        Profile: { relation: [{ id: profilePageId }] },
      },
    });
  }

  /** List brews where Profile relation is empty, including Activity ID for lookup */
  async listBrewsMissingProfileRelation(limit = 100): Promise<Array<{ pageId: string; activityId: string | null }>> {
    const results: Array<{ pageId: string; activityId: string | null }> = [];
    let cursor: string | undefined;

    while (results.length < limit) {
      const pageSize = Math.min(100, limit - results.length);
      const response = await this.client.databases.query({
        database_id: this.config.brewsDbId,
        filter: {
          property: "Profile",
          relation: { is_empty: true },
        },
        start_cursor: cursor,
        page_size: pageSize,
      });

      for (const page of response.results as any[]) {
        const activityId = this.extractBrewActivityId(page);
        results.push({
          pageId: page.id,
          activityId,
        });
      }

      if (!response.has_more || !response.next_cursor) {
        break;
      }
      cursor = response.next_cursor;
    }

    return results;
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

  /** Resolve a profile page ID by profile name */
  async getProfilePageIdByName(profileName: string): Promise<string | null> {
    return this.findProfilePageByName(profileName);
  }

  /**
   * Import profiles discovered on GaggiMate into Notion.
   * Non-destructive reconciliation:
   * - Create missing machine profiles in Notion
   * - Mark machine-present profiles as Pushed + Active on Machine
   * - Mark machine-missing profiles as Active on Machine = false
   * - Never delete Notion profiles
   */
  async importProfilesFromGaggiMate(profiles: any[]): Promise<{
    created: number;
    updatedPresent: number;
    markedMissing: number;
    imagesUploaded: number;
    skipped: number;
  }> {
    const existingProfiles = await this.listExistingProfiles();
    const machineNames = new Set<string>();
    let created = 0;
    let updatedPresent = 0;
    let markedMissing = 0;
    let imagesUploaded = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const profile of profiles) {
      const profileName = typeof profile?.label === "string" ? profile.label.trim() : "";
      const normalizedName = this.normalizeProfileName(profileName);

      if (!normalizedName) {
        skipped += 1;
        continue;
      }

      machineNames.add(normalizedName);
      const existing = existingProfiles.get(normalizedName);

      if (existing) {
        // Ensure machine-present profiles are clearly marked as present/pushed.
        const needsUpdate = existing.pushStatus !== "Pushed" || existing.activeOnMachine !== true;
        if (needsUpdate) {
          await this.client.pages.update({
            page_id: existing.pageId,
            properties: {
              "Push Status": { select: { name: "Pushed" } },
              "Last Pushed": { date: { start: now } },
              "Active on Machine": { checkbox: true },
            },
          });
          updatedPresent += 1;
        } else {
          skipped += 1;
        }

        if (!existing.hasProfileImage) {
          const uploaded = await this.uploadProfileImage(existing.pageId, profileName, profile);
          if (uploaded) {
            imagesUploaded += 1;
          }
        }
        continue;
      }

      const profileJson = JSON.stringify(profile);
      const description = typeof profile?.description === "string" ? profile.description : "";

      const createdPage = await this.client.pages.create({
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
            checkbox: true,
          },
          "Profile JSON": {
            rich_text: this.toRichText(profileJson),
          },
          "Push Status": {
            select: { name: "Pushed" },
          },
          "Last Pushed": {
            date: { start: now },
          },
        },
      });

      const uploaded = await this.uploadProfileImage(createdPage.id, profileName, profile);
      if (uploaded) {
        imagesUploaded += 1;
      }
      created += 1;
    }

    // Keep historical profiles, but mark ones no longer on machine as inactive.
    for (const [name, existing] of existingProfiles.entries()) {
      if (machineNames.has(name)) continue;
      if (existing.activeOnMachine === true) {
        await this.client.pages.update({
          page_id: existing.pageId,
          properties: {
            "Active on Machine": { checkbox: false },
          },
        });
        markedMissing += 1;
      }
    }

    return { created, updatedPresent, markedMissing, imagesUploaded, skipped };
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

  private async listExistingProfiles(): Promise<Map<string, { pageId: string; pushStatus: string | null; activeOnMachine: boolean | null; hasProfileImage: boolean }>> {
    const profiles = new Map<string, { pageId: string; pushStatus: string | null; activeOnMachine: boolean | null; hasProfileImage: boolean }>();
    let cursor: string | undefined;

    do {
      const response = await this.client.databases.query({
        database_id: this.config.profilesDbId,
        start_cursor: cursor,
        page_size: 100,
      });

      for (const page of response.results as any[]) {
        const normalized = this.normalizeProfileName(this.extractTitle(page));
        if (!normalized) continue;
        const pushStatusProp = page.properties?.["Push Status"];
        const activeOnMachineProp = page.properties?.["Active on Machine"];
        const profileImageProp = page.properties?.["Profile Image"];
        profiles.set(normalized, {
          pageId: page.id,
          pushStatus: pushStatusProp?.type === "select" ? pushStatusProp.select?.name || null : null,
          activeOnMachine: activeOnMachineProp?.type === "checkbox" ? Boolean(activeOnMachineProp.checkbox) : null,
          hasProfileImage: profileImageProp?.type === "files" ? Array.isArray(profileImageProp.files) && profileImageProp.files.length > 0 : false,
        });
      }

      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return profiles;
  }

  private extractBrewActivityId(page: any): string | null {
    const activityIdProp = page.properties?.["Activity ID"];
    if (activityIdProp?.type === "rich_text") {
      const value = activityIdProp.rich_text?.map((t: any) => t.plain_text).join("") || "";
      if (value.trim()) return value.trim();
    }

    // Fallback for legacy rows without Activity ID:
    // infer shot ID from Brew title like "#027 - Feb 14 PM".
    const brewTitleProp = page.properties?.Brew;
    if (brewTitleProp?.type === "title") {
      const title = brewTitleProp.title?.map((t: any) => t.plain_text).join("") || "";
      const match = title.match(/^#0*([0-9]+)/);
      if (match?.[1]) return match[1];
    }

    return null;
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

  private async uploadProfileImage(pageId: string, profileName: string, profile: any): Promise<boolean> {
    if (this.imageUploadDisabledReason) {
      return false;
    }

    try {
      const svg = renderProfileChartSvg(profile);
      const fileUpload = await this.createNotionFileUpload(`${this.sanitizeFileName(profileName)}.svg`, "image/svg+xml");
      await this.sendFileUpload(fileUpload.uploadUrl, `${this.sanitizeFileName(profileName)}.svg`, "image/svg+xml", svg);
      await this.attachProfileImage(pageId, fileUpload.id);
      return true;
    } catch (error) {
      console.warn(`Profile "${profileName}": failed to upload Profile Image`, error);
      if (error instanceof Error && error.message.includes("(401)")) {
        this.imageUploadDisabledReason = "notion-file-upload-auth-failed";
        console.warn("Disabling Profile Image uploads for this process after 401 responses from Notion file upload API.");
      }
      return false;
    }
  }

  private async createNotionFileUpload(filename: string, contentType: string): Promise<{ id: string; uploadUrl: string }> {
    const response = await this.client.request<any>({
      path: "file_uploads",
      method: "post",
      body: {
        mode: "single_part",
        filename,
        content_type: contentType,
      },
    });

    const id = typeof response?.id === "string" ? response.id : "";
    const uploadUrl = typeof response?.upload_url === "string" ? response.upload_url : "";

    if (!id || !uploadUrl) {
      throw new Error("Notion file upload init failed: missing id or upload_url");
    }

    return { id, uploadUrl };
  }

  private async sendFileUpload(uploadUrl: string, filename: string, contentType: string, content: string): Promise<void> {
    const formData = new FormData();
    formData.append("file", new Blob([content], { type: contentType }), filename);

    const response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Notion-Version": "2022-06-28",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Notion file upload send failed (${response.status}): ${body}`);
    }
  }

  private async attachProfileImage(pageId: string, fileUploadId: string): Promise<void> {
    await this.client.request({
      path: `pages/${pageId}`,
      method: "patch",
      body: {
        properties: {
          "Profile Image": {
            files: [
              {
                type: "file_upload",
                file_upload: { id: fileUploadId },
              },
            ],
          },
        },
      },
    });
  }

  private sanitizeFileName(value: string): string {
    const normalized = value.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-_]/g, "").toLowerCase();
    return normalized || "profile";
  }
}
