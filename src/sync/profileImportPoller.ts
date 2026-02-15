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
      if (result.created > 0) {
        console.log(
          `Profile import: created ${result.created} profile(s), skipped ${result.skipped} existing`,
        );
      }
    } catch (error) {
      console.error("Profile import poller error:", error);
    } finally {
      this.running = false;
    }
  }
}
