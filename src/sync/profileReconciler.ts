import type { GaggiMateClient } from "../gaggimate/client.js";
import type { ExistingProfileRecord, NotionClient } from "../notion/client.js";

interface ProfileReconcilerOptions {
  intervalMs: number;
}

export class ProfileReconciler {
  private gaggimate: GaggiMateClient;
  private notion: NotionClient;
  private options: ProfileReconcilerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(gaggimate: GaggiMateClient, notion: NotionClient, options: ProfileReconcilerOptions) {
    this.gaggimate = gaggimate;
    this.notion = notion;
    this.options = options;
  }

  start(): void {
    if (this.timer) return;
    console.log(`Profile reconciler started (every ${this.options.intervalMs}ms)`);
    this.timer = setInterval(() => this.reconcile(), this.options.intervalMs);
    this.reconcile();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("Profile reconciler stopped");
  }

  private async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      let deviceProfiles: any[];
      try {
        deviceProfiles = await this.gaggimate.fetchProfiles();
      } catch (error) {
        if (this.isTimeoutError(error)) {
          console.warn("Profile reconciler: GaggiMate unreachable, will retry next interval");
        } else {
          console.error("Profile reconciler: failed to fetch device profiles:", error);
        }
        return;
      }

      const notionIndex = await this.notion.listExistingProfiles();
      const deviceById = new Map<string, any>();
      for (const deviceProfile of deviceProfiles) {
        const profileId = this.notion.extractProfileId(deviceProfile);
        if (profileId) {
          deviceById.set(profileId, deviceProfile);
        }
      }

      const knownNotionNames = new Set<string>(
        notionIndex.all
          .map((record) => record.normalizedName)
          .filter((name) => name.length > 0),
      );

      const matchedDeviceIds = new Set<string>();
      const matchedDeviceNames = new Set<string>();
      const conflictingManagedIds = this.findConflictingManagedIds(notionIndex.all);
      const warnedConflictingIds = new Set<string>();

      for (const notionProfile of notionIndex.all) {
        if (notionProfile.profileId) {
          matchedDeviceIds.add(notionProfile.profileId);
        }
        if (notionProfile.normalizedName) {
          matchedDeviceNames.add(notionProfile.normalizedName);
        }

        if (
          notionProfile.profileId &&
          conflictingManagedIds.has(notionProfile.profileId) &&
          this.isManagedStatus(notionProfile.pushStatus)
        ) {
          if (!warnedConflictingIds.has(notionProfile.profileId)) {
            console.warn(
              `Profile reconciler: conflicting managed records share device id ${notionProfile.profileId}; skipping device operations until resolved in Notion`,
            );
            warnedConflictingIds.add(notionProfile.profileId);
          }
          continue;
        }

        try {
          await this.processNotionProfile(notionProfile, deviceById, matchedDeviceIds, matchedDeviceNames);
        } catch (error) {
          console.error(`Profile reconciler: failed to process page ${notionProfile.pageId}:`, error);
        }
      }

      for (const deviceProfile of deviceProfiles) {
        const deviceId = this.notion.extractProfileId(deviceProfile);
        const normalizedName = this.normalizeDeviceProfileName(deviceProfile);

        if (deviceId && matchedDeviceIds.has(deviceId)) {
          continue;
        }
        if (normalizedName && (matchedDeviceNames.has(normalizedName) || knownNotionNames.has(normalizedName))) {
          continue;
        }
        if (!normalizedName) {
          continue;
        }

        const profileName = this.profileLabel(deviceProfile);
        if (!profileName) {
          continue;
        }

        try {
          const pageId = await this.notion.createDraftProfile(deviceProfile);
          if (deviceId) {
            matchedDeviceIds.add(deviceId);
          }
          matchedDeviceNames.add(normalizedName);
          knownNotionNames.add(normalizedName);

          await this.notion.uploadProfileImage(pageId, profileName, deviceProfile, JSON.stringify(deviceProfile));
          console.log(`Profile reconciler: imported device profile "${profileName}" as Draft`);
        } catch (error) {
          console.error(`Profile reconciler: failed to import profile "${profileName}" as Draft:`, error);
        }
      }

      const backfillResult = await this.backfillBrewProfileRelations();
      if (backfillResult.linked > 0) {
        console.log(
          `Profile reconciler: linked ${backfillResult.linked} brew(s) to profiles (scanned ${backfillResult.scanned})`,
        );
      }
    } catch (error) {
      console.error("Profile reconciler error:", error);
    } finally {
      this.running = false;
    }
  }

  private async processNotionProfile(
    notionProfile: ExistingProfileRecord,
    deviceById: Map<string, any>,
    matchedDeviceIds: Set<string>,
    matchedDeviceNames: Set<string>,
  ): Promise<void> {
    switch (notionProfile.pushStatus) {
      case "Queued":
        await this.handleQueuedProfile(notionProfile, matchedDeviceIds, matchedDeviceNames);
        break;
      case "Pushed":
        await this.handlePushedProfile(notionProfile, deviceById);
        break;
      case "Archived":
        await this.handleArchivedProfile(notionProfile, deviceById);
        break;
      case "Draft":
      case "Failed":
      default:
        break;
    }
  }

  private async handleQueuedProfile(
    notionProfile: ExistingProfileRecord,
    matchedDeviceIds: Set<string>,
    matchedDeviceNames: Set<string>,
  ): Promise<void> {
    const parsedProfile = this.parseProfileJson(notionProfile.profileJson);
    if (!parsedProfile) {
      console.error(`Profile ${notionProfile.pageId}: invalid JSON`);
      await this.notion.updatePushStatus(notionProfile.pageId, "Failed");
      return;
    }

    if (!this.isValidPushProfile(parsedProfile)) {
      console.error(`Profile ${notionProfile.pageId}: missing or invalid temperature/phases`);
      await this.notion.updatePushStatus(notionProfile.pageId, "Failed");
      return;
    }

    if (!parsedProfile.id && notionProfile.profileId) {
      parsedProfile.id = notionProfile.profileId;
    }

    try {
      const savedResult = await this.gaggimate.saveProfile(parsedProfile);
      const savedId = this.notion.extractProfileId(savedResult) || this.notion.extractProfileId(parsedProfile);
      if (savedId && parsedProfile.id !== savedId) {
        parsedProfile.id = savedId;
        await this.notion.updateProfileJson(notionProfile.pageId, JSON.stringify(parsedProfile));
      }

      if (savedId) {
        matchedDeviceIds.add(savedId);
      }
      const normalizedSavedName = this.normalizeDeviceProfileName(parsedProfile);
      if (normalizedSavedName) {
        matchedDeviceNames.add(normalizedSavedName);
      }

      const now = new Date().toISOString();
      await this.notion.updatePushStatus(notionProfile.pageId, "Pushed", now, true);
      console.log(`Profile ${notionProfile.pageId}: pushed to device`);
    } catch (error) {
      console.error(`Profile ${notionProfile.pageId}: push failed:`, error);
      await this.notion.updatePushStatus(notionProfile.pageId, "Failed");
    }
  }

  private async handlePushedProfile(
    notionProfile: ExistingProfileRecord,
    deviceById: Map<string, any>,
  ): Promise<void> {
    const deviceId = notionProfile.profileId;
    if (!deviceId) {
      return;
    }

    const deviceProfile = deviceById.get(deviceId);
    if (!deviceProfile) {
      const notionProfileJson = this.parseProfileJson(notionProfile.profileJson);
      if (!notionProfileJson) {
        console.error(`Profile ${notionProfile.pageId}: invalid JSON, cannot re-push missing profile`);
        await this.notion.updatePushStatus(notionProfile.pageId, "Failed");
        return;
      }

      notionProfileJson.id = deviceId;
      try {
        await this.gaggimate.saveProfile(notionProfileJson);
        await this.applyFavoriteAndSelectedSync(notionProfile, notionProfileJson);
        const now = new Date().toISOString();
        await this.notion.updatePushStatus(notionProfile.pageId, "Pushed", now, true);
        console.log(`Profile ${notionProfile.pageId}: re-pushed missing device profile`);
      } catch (error) {
        console.error(`Profile ${notionProfile.pageId}: failed to re-push missing profile:`, error);
        await this.notion.updatePushStatus(notionProfile.pageId, "Failed");
      }
      return;
    }

    const notionProfileJson = this.parseProfileJson(notionProfile.profileJson);
    if (!notionProfileJson) {
      console.error(`Profile ${notionProfile.pageId}: invalid JSON, cannot reconcile drift`);
      await this.notion.updatePushStatus(notionProfile.pageId, "Failed");
      return;
    }

    const needsRepush = !this.areProfilesEquivalent(notionProfileJson, deviceProfile);
    if (needsRepush) {
      notionProfileJson.id = deviceId;
      try {
        await this.gaggimate.saveProfile(notionProfileJson);
        console.log(`Profile ${notionProfile.pageId}: reconciled device profile from Notion JSON`);
      } catch (error) {
        console.error(`Profile ${notionProfile.pageId}: failed to reconcile profile drift:`, error);
        await this.notion.updatePushStatus(notionProfile.pageId, "Failed");
        return;
      }
    }

    await this.applyFavoriteAndSelectedSync(notionProfile, deviceProfile);

    if (notionProfile.activeOnMachine !== true) {
      await this.notion.updatePushStatus(notionProfile.pageId, "Pushed", undefined, true);
    }
  }

  private async handleArchivedProfile(
    notionProfile: ExistingProfileRecord,
    deviceById: Map<string, any>,
  ): Promise<void> {
    // Safety: archived rows that are already marked inactive are treated as
    // historical/unmanaged and should not trigger destructive device deletes.
    if (notionProfile.activeOnMachine === false) {
      return;
    }

    const deviceId = notionProfile.profileId;
    if (!deviceId) {
      await this.notion.updatePushStatus(notionProfile.pageId, "Archived", undefined, false);
      return;
    }

    const deviceProfile = deviceById.get(deviceId);
    if (!deviceProfile) {
      await this.notion.updatePushStatus(notionProfile.pageId, "Archived", undefined, false);
      return;
    }

    if (this.isUtilityProfile(deviceProfile)) {
      console.log(`Profile ${notionProfile.pageId}: skipping delete for utility profile`);
      return;
    }

    try {
      await this.gaggimate.deleteProfile(deviceId);
      await this.notion.updatePushStatus(notionProfile.pageId, "Archived", undefined, false);
      console.log(`Profile ${notionProfile.pageId}: deleted from device`);
    } catch (error) {
      console.error(`Profile ${notionProfile.pageId}: delete failed:`, error);
      await this.notion.updatePushStatus(notionProfile.pageId, "Failed");
    }
  }

  private async applyFavoriteAndSelectedSync(notionProfile: ExistingProfileRecord, profileOnDevice: any): Promise<void> {
    const deviceId = this.notion.extractProfileId(profileOnDevice) || notionProfile.profileId;
    if (!deviceId) {
      return;
    }

    const deviceFavorite = Boolean(profileOnDevice?.favorite);
    if (deviceFavorite !== notionProfile.favorite) {
      try {
        await this.gaggimate.favoriteProfile(deviceId, notionProfile.favorite);
      } catch (error) {
        console.warn(`Profile ${notionProfile.pageId}: favorite sync failed:`, error);
      }
    }

    if (notionProfile.selected) {
      try {
        await this.gaggimate.selectProfile(deviceId);
      } catch (error) {
        console.warn(`Profile ${notionProfile.pageId}: select sync failed:`, error);
      }
    }
  }

  private async backfillBrewProfileRelations(): Promise<{ scanned: number; linked: number }> {
    let scanned = 0;
    let linked = 0;
    const maxRowsPerRun = 1000;

    while (scanned < maxRowsPerRun) {
      const remaining = maxRowsPerRun - scanned;
      const candidates = await this.notion.listBrewsMissingProfileRelation(Math.min(100, remaining));
      if (candidates.length === 0) {
        break;
      }

      scanned += candidates.length;
      for (const brew of candidates) {
        try {
          if (!brew.activityId) {
            continue;
          }

          const shot = await this.gaggimate.fetchShot(brew.activityId);
          if (!shot?.profileName) {
            continue;
          }

          const profilePageId = await this.notion.getProfilePageIdByName(shot.profileName);
          if (!profilePageId) {
            continue;
          }

          await this.notion.setBrewProfileRelation(brew.pageId, profilePageId);
          linked += 1;
        } catch (error) {
          console.error(`Brew ${brew.pageId}: profile backfill failed:`, error);
        }
      }

      if (candidates.length < 100) {
        break;
      }
    }

    return { scanned, linked };
  }

  private isUtilityProfile(profile: any): boolean {
    if (profile?.utility === true) {
      return true;
    }

    const normalizedLabel = this.normalizeDeviceProfileName(profile);
    return normalizedLabel === "flush" || normalizedLabel === "descale";
  }

  private areProfilesEquivalent(first: any, second: any): boolean {
    const desired = this.normalizeForCompare(first);
    const actual = this.normalizeForCompare(second);
    return this.isSubsetMatch(desired, actual);
  }

  private normalizeForCompare(value: any): any {
    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeForCompare(entry));
    }
    if (typeof value === "string") {
      return this.normalizeTextForCompare(value);
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    const sorted: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      // Favorite/Selected are synced via Notion checkboxes, not Profile JSON.
      if (key === "favorite" || key === "selected") {
        continue;
      }
      const normalizedChild = this.normalizeForCompare(value[key]);
      if (normalizedChild !== undefined) {
        sorted[key] = normalizedChild;
      }
    }
    return sorted;
  }

  private isSubsetMatch(desired: any, actual: any): boolean {
    if (Array.isArray(desired)) {
      if (!Array.isArray(actual) || desired.length !== actual.length) {
        return false;
      }
      for (let i = 0; i < desired.length; i += 1) {
        if (!this.isSubsetMatch(desired[i], actual[i])) {
          return false;
        }
      }
      return true;
    }

    if (desired && typeof desired === "object") {
      if (!actual || typeof actual !== "object") {
        return false;
      }

      for (const [key, desiredValue] of Object.entries(desired)) {
        if (!this.isSubsetMatch(desiredValue, actual[key])) {
          return false;
        }
      }

      return true;
    }

    return desired === actual;
  }

  private normalizeTextForCompare(value: string): string {
    const repaired = this.repairMojibake(value);
    return repaired
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Repairs common UTF-8 -> Latin-1 mojibake so comparison logic
   * does not churn when firmware/UI round-trips mangled text.
   */
  private repairMojibake(value: string): string {
    if (!/(Ã.|â[\u0080-\u00BF])/u.test(value)) {
      return value;
    }

    try {
      const repaired = Buffer.from(value, "latin1").toString("utf8");
      if (!repaired || repaired.includes("\uFFFD")) {
        return value;
      }
      return repaired;
    } catch {
      return value;
    }
  }

  private findConflictingManagedIds(records: ExistingProfileRecord[]): Set<string> {
    const pagesByDeviceId = new Map<string, Set<string>>();

    for (const record of records) {
      if (!record.profileId || !this.isManagedStatus(record.pushStatus)) {
        continue;
      }

      if (!pagesByDeviceId.has(record.profileId)) {
        pagesByDeviceId.set(record.profileId, new Set<string>());
      }
      pagesByDeviceId.get(record.profileId)!.add(record.pageId);
    }

    const conflictingIds = new Set<string>();
    for (const [deviceId, pageIds] of pagesByDeviceId.entries()) {
      if (pageIds.size > 1) {
        conflictingIds.add(deviceId);
      }
    }
    return conflictingIds;
  }

  private isManagedStatus(status: string | null): boolean {
    return status === "Queued" || status === "Pushed" || status === "Archived";
  }

  private parseProfileJson(profileJson: string): any | null {
    if (!profileJson || !profileJson.trim()) {
      return null;
    }

    try {
      return JSON.parse(profileJson);
    } catch {
      return null;
    }
  }

  private isValidPushProfile(profile: any): boolean {
    if (typeof profile?.temperature !== "number") {
      return false;
    }
    if (profile.temperature < 60 || profile.temperature > 100) {
      return false;
    }
    if (!Array.isArray(profile?.phases) || profile.phases.length === 0) {
      return false;
    }
    return true;
  }

  private profileLabel(profile: any): string {
    if (typeof profile?.label !== "string") {
      return "";
    }
    return profile.label.trim();
  }

  private normalizeDeviceProfileName(profile: any): string {
    const profileLabel = this.profileLabel(profile);
    if (!profileLabel) {
      return "";
    }
    return this.notion.normalizeProfileName(profileLabel);
  }

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    return name.includes("timeout") || name.includes("abort") || message.includes("timeout") || message.includes("aborted");
  }
}
