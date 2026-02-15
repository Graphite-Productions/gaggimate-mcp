import type { GaggiMateClient } from "../gaggimate/client.js";
import type { NotionClient } from "../notion/client.js";
import { SyncState } from "./state.js";
import { shotToBrewData } from "../notion/mappers.js";
import { transformShotForAI } from "../transformers/shotTransformer.js";

interface ShotPollerOptions {
  intervalMs: number;
  dataDir: string;
  recentShotLookbackCount: number;
  brewTitleTimeZone: string;
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

      // Revisit a small lookback window to hydrate/fix already-synced brews
      // that were first seen while the shot file was still settling.
      const recentLowerBound = Math.max(1, lastId - this.options.recentShotLookbackCount + 1);
      const recentShots = shots
        .filter((s) => {
          const id = parseInt(s.id, 10);
          return id >= recentLowerBound && id <= lastId;
        })
        .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

      const candidateById = new Map<string, (typeof shots)[number]>();
      for (const shot of [...recentShots, ...newShots]) {
        candidateById.set(shot.id, shot);
      }
      const candidateShots = Array.from(candidateById.values())
        .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

      if (candidateShots.length === 0) {
        this.running = false;
        return;
      }

      if (newShots.length > 0) {
        console.log(`Found ${newShots.length} new shot(s) to sync`);
      }
      const syncedIds: string[] = [];

      for (const shotListItem of candidateShots) {
        try {
          // Fetch full shot data
          const shotData = await this.gaggimate.fetchShot(shotListItem.id);
          if (!shotData) {
            console.warn(`Shot ${shotListItem.id}: not found on GaggiMate, skipping`);
            continue;
          }

          const shotNumericId = parseInt(shotListItem.id, 10);
          const isNewShot = shotNumericId > lastId;

          // If shot file is still being written, retry on next interval.
          // Do not advance sync state past this shot ID yet.
          if (isNewShot && shotData.incomplete) {
            console.log(`Shot ${shotListItem.id}: file incomplete, waiting for next poll before syncing`);
            break;
          }

          // Check Notion for existing brew (dedup/upsert)
          const existing = await this.notion.findBrewByShotId(shotListItem.id);

          // Transform to AI-friendly format
          const transformed = transformShotForAI(shotData);

          // Map to brew data and create in Notion
          const brewData = shotToBrewData(shotData, transformed, {
            timeZone: this.options.brewTitleTimeZone,
          });

          // If the shot references a profile that doesn't exist in Notion yet,
          // import profiles from GaggiMate first so the brew relation can link.
          if (brewData.profileName) {
            const profileExists = await this.notion.hasProfileByName(brewData.profileName);
            if (!profileExists) {
              const machineProfiles = await this.gaggimate.fetchProfiles();
              const importResult = await this.notion.importProfilesFromGaggiMate(machineProfiles);
              if (importResult.created > 0) {
                console.log(
                  `Shot ${shotListItem.id}: imported ${importResult.created} profile(s) before brew sync`,
                );
              }
            }
          }

          if (existing) {
            await this.notion.updateBrewFromData(existing, brewData);
            if (isNewShot) {
              state.recordSync(shotListItem.id);
              syncedIds.push(shotListItem.id);
              console.log(`Shot ${shotListItem.id}: updated existing Notion brew as "${brewData.title}"`);
            }
          } else {
            await this.notion.createBrew(brewData);
            if (isNewShot) {
              state.recordSync(shotListItem.id);
              syncedIds.push(shotListItem.id);
            }
            console.log(`Shot ${shotListItem.id}: synced to Notion as "${brewData.title}"`);
          }
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
