import type { GaggiMateClient } from "../gaggimate/client.js";
import type { NotionClient } from "../notion/client.js";
import { pushProfileToGaggiMate } from "./profilePush.js";

interface ProfilePollerOptions {
  intervalMs: number;
}

export class ProfilePoller {
  private gaggimate: GaggiMateClient;
  private notion: NotionClient;
  private options: ProfilePollerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(gaggimate: GaggiMateClient, notion: NotionClient, options: ProfilePollerOptions) {
    this.gaggimate = gaggimate;
    this.notion = notion;
    this.options = options;
  }

  start(): void {
    if (this.timer) return;
    console.log(`Profile poller started (every ${this.options.intervalMs}ms)`);
    this.timer = setInterval(() => this.poll(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("Profile poller stopped");
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const queued = await this.notion.getQueuedProfiles();
      if (queued.length === 0) {
        this.running = false;
        return;
      }

      console.log(`Found ${queued.length} queued profile(s) to push`);

      for (const profile of queued) {
        try {
          await pushProfileToGaggiMate(
            this.gaggimate,
            this.notion,
            profile.pageId,
            profile.profileJson,
          );
        } catch (error) {
          console.error(`Profile ${profile.pageId}: poll-push failed:`, error);
        }
      }
    } catch (error) {
      // Notion API error — log and retry next interval
      console.error("Profile poller error:", error);
    } finally {
      this.running = false;
    }
  }
}
