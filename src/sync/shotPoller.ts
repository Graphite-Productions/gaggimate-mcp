import type { GaggiMateClient } from "../gaggimate/client.js";
import type { NotionClient } from "../notion/client.js";
import { SyncState } from "./state.js";
import { shotToBrewData } from "../notion/mappers.js";
import { transformShotForAI } from "../transformers/shotTransformer.js";

interface ShotPollerOptions {
  intervalMs: number;
  dataDir: string;
}

export class ShotPoller {
  private gaggimate: GaggiMateClient;
  private notion: NotionClient;
  private options: ShotPollerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(gaggimate: GaggiMateClient, notion: NotionClient, options: ShotPollerOptions) {
    this.gaggimate = gaggimate;
    this.notion = notion;
    this.options = options;
  }

  start(): void {
    if (this.timer) return;
    console.log(`Shot poller started (every ${this.options.intervalMs}ms)`);
    this.timer = setInterval(() => this.poll(), this.options.intervalMs);
    // Run immediately on start
    this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("Shot poller stopped");
  }

  private async poll(): Promise<void> {
    // Prevent overlapping polls
    if (this.running) return;
    this.running = true;

    try {
      const state = SyncState.load(this.options.dataDir);

      // Fetch shot history (sorted most recent first by indexToShotList)
      const shots = await this.gaggimate.fetchShotHistory();
      if (shots.length === 0) {
        this.running = false;
        return;
      }

      // Find new shots: shots with ID > lastSyncedShotId
      const lastId = state.lastSyncedShotId ? parseInt(state.lastSyncedShotId, 10) : 0;
      const newShots = shots
        .filter((s) => parseInt(s.id, 10) > lastId)
        .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10)); // Process oldest first

      if (newShots.length === 0) {
        this.running = false;
        return;
      }

      console.log(`Found ${newShots.length} new shot(s) to sync`);
      const syncedIds: string[] = [];

      for (const shotListItem of newShots) {
        try {
          // Check Notion for existing brew (dedup)
          const existing = await this.notion.findBrewByShotId(shotListItem.id);
          if (existing) {
            console.log(`Shot ${shotListItem.id}: already in Notion, skipping`);
            state.recordSync(shotListItem.id);
            syncedIds.push(shotListItem.id);
            continue;
          }

          // Fetch full shot data
          const shotData = await this.gaggimate.fetchShot(shotListItem.id);
          if (!shotData) {
            console.warn(`Shot ${shotListItem.id}: not found on GaggiMate, skipping`);
            continue;
          }

          // Transform to AI-friendly format
          const transformed = transformShotForAI(shotData);

          // Map to brew data and create in Notion
          const brewData = shotToBrewData(shotData, transformed);
          await this.notion.createBrew(brewData);

          state.recordSync(shotListItem.id);
          syncedIds.push(shotListItem.id);
          console.log(`Shot ${shotListItem.id}: synced to Notion as "${brewData.title}"`);
        } catch (error) {
          // Per-shot failure isolation — log and continue
          console.error(`Shot ${shotListItem.id}: sync failed:`, error);
        }
      }

      if (syncedIds.length > 0) {
        console.log(`Synced ${syncedIds.length} new shot(s) (IDs: ${syncedIds.join(", ")})`);
      }
    } catch (error) {
      // Top-level failure — GaggiMate unreachable or other fatal error
      if (error instanceof Error && error.message.includes("timeout")) {
        console.warn("Shot poller: GaggiMate unreachable, will retry next interval");
      } else {
        console.error("Shot poller error:", error);
      }
    } finally {
      this.running = false;
    }
  }
}
