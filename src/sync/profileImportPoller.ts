import type { GaggiMateClient } from "../gaggimate/client.js";
import type { NotionClient } from "../notion/client.js";

interface ProfileImportPollerOptions {
  intervalMs: number;
}

export class ProfileImportPoller {
  private gaggimate: GaggiMateClient;
  private notion: NotionClient;
  private options: ProfileImportPollerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(gaggimate: GaggiMateClient, notion: NotionClient, options: ProfileImportPollerOptions) {
    this.gaggimate = gaggimate;
    this.notion = notion;
    this.options = options;
  }

  start(): void {
    if (this.timer) return;
    console.log(`Profile import poller started (every ${this.options.intervalMs}ms)`);
    this.timer = setInterval(() => this.poll(), this.options.intervalMs);
    // Run immediately on start
    this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("Profile import poller stopped");
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const profiles = await this.gaggimate.fetchProfiles();
      if (profiles.length === 0) {
        this.running = false;
        return;
      }

      const result = await this.notion.importProfilesFromGaggiMate(profiles);
      if (result.created > 0 || result.updatedPresent > 0 || result.markedMissing > 0 || result.imagesUploaded > 0) {
        console.log(
          `Profile import: created ${result.created}, updated ${result.updatedPresent}, marked missing ${result.markedMissing}, images ${result.imagesUploaded}, skipped ${result.skipped}`,
        );
      }

      const linkResult = await this.backfillBrewProfileRelations();
      if (linkResult.linked > 0) {
        console.log(
          `Profile import: linked ${linkResult.linked} brew(s) to profiles (scanned ${linkResult.scanned})`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("timeout")) {
        console.warn("Profile import poller: GaggiMate unreachable, will retry next interval");
      } else {
        console.error("Profile import poller error:", error);
      }
    } finally {
      this.running = false;
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
}
