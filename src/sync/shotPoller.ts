import type { GaggiMateClient } from "../gaggimate/client.js";
import type { ShotCache } from "./shotCache.js";
import { SyncState } from "./state.js";
import { transformShotForAI } from "../transformers/shotTransformer.js";
import { isConnectivityError, summarizeConnectivityError } from "../utils/connectivity.js";

interface ShotPollerOptions {
  intervalMs: number;
  dataDir: string;
  connectivityCooldownMs?: number;
}

export class ShotPoller {
  private gaggimate: GaggiMateClient;
  private cache: ShotCache;
  private options: ShotPollerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private connectivityWarningActive = false;
  private connectivityCooldownUntil = 0;
  private readonly connectivityCooldownMs: number;
  private cooldownLogMutedUntil = 0;
  private readonly COOLDOWN_LOG_INTERVAL_MS = 60_000;
  private state: SyncState;

  constructor(gaggimate: GaggiMateClient, cache: ShotCache, options: ShotPollerOptions) {
    this.gaggimate = gaggimate;
    this.cache = cache;
    this.options = options;
    this.connectivityCooldownMs = options.connectivityCooldownMs ?? 180_000;
    this.state = SyncState.load(options.dataDir);
  }

  get syncState(): SyncState {
    return this.state;
  }

  start(): void {
    if (this.timer) return;
    console.log(`Shot poller started (every ${this.options.intervalMs}ms)`);
    this.timer = setInterval(() => this.poll(), this.options.intervalMs);
    this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("Shot poller stopped");
  }

  /** Public for tests and manual trigger. */
  async pollOnce(): Promise<void> {
    return this.poll();
  }

  private warnConnectivityIssue(error: unknown): void {
    const summary = summarizeConnectivityError(error);
    if (!this.connectivityWarningActive) {
      console.warn(`Shot poller: GaggiMate unreachable (${summary}), will retry next interval`);
      this.connectivityWarningActive = true;
    }
    this.connectivityCooldownUntil = Math.max(
      this.connectivityCooldownUntil,
      Date.now() + this.connectivityCooldownMs,
    );
  }

  private clearConnectivityWarning(): void {
    if (this.connectivityWarningActive) {
      console.log("Shot poller: GaggiMate connectivity restored");
      this.connectivityWarningActive = false;
    }
    this.connectivityCooldownUntil = 0;
    this.cooldownLogMutedUntil = 0;
  }

  private async poll(): Promise<void> {
    if (this.running) {
      return;
    }
    if (Date.now() < this.connectivityCooldownUntil) {
      const now = Date.now();
      if (now >= this.cooldownLogMutedUntil) {
        const remainingSeconds = Math.ceil(Math.max(0, this.connectivityCooldownUntil - now) / 1000);
        console.log(`Shot poller: connectivity cooldown active (${remainingSeconds}s remaining), skipping`);
        this.cooldownLogMutedUntil = now + this.COOLDOWN_LOG_INTERVAL_MS;
      }
      return;
    }

    this.running = true;
    let syncedCount = 0;

    try {
      const shots = await this.gaggimate.fetchShotHistory();
      this.clearConnectivityWarning();
      if (shots.length === 0) return;

      const lastId = this.state.lastSyncedShotId ? parseInt(this.state.lastSyncedShotId, 10) : 0;

      // Find new completed shots
      const newShots = shots
        .filter((s) => parseInt(s.id, 10) > lastId && !s.incomplete)
        .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

      if (newShots.length === 0) return;
      console.log(`Found ${newShots.length} new shot(s) to cache`);

      for (const shotListItem of newShots) {
        try {
          // Skip if already cached
          if (this.cache.read(shotListItem.id) !== null) {
            this.state.lastSyncedShotId = shotListItem.id;
            this.state.lastSyncTime = new Date().toISOString();
            this.state.totalShotsSynced++;
            continue;
          }

          const shotData = await this.gaggimate.fetchShot(shotListItem.id);
          if (!shotData) {
            console.warn(`Shot ${shotListItem.id}: not found on GaggiMate, skipping`);
            continue;
          }

          if (shotData.incomplete) {
            console.log(`Shot ${shotListItem.id}: file incomplete, waiting for next poll`);
            break;
          }

          // Transform and write to local cache
          const transformed = transformShotForAI(shotData, true);
          this.cache.write(shotListItem.id, transformed);

          // Update sync state
          this.state.lastSyncedShotId = shotListItem.id;
          this.state.lastSyncTime = new Date().toISOString();
          this.state.totalShotsSynced++;
          this.state.save();
          syncedCount++;

          console.log(`Shot ${shotListItem.id}: cached locally`);
        } catch (error) {
          if (isConnectivityError(error)) {
            this.warnConnectivityIssue(error);
            break;
          }
          console.error(`Shot ${shotListItem.id}: cache failed:`, error);
        }
      }

      if (syncedCount > 0) {
        console.log(`Cached ${syncedCount} new shot(s)`);
      }
    } catch (error) {
      if (isConnectivityError(error)) {
        this.warnConnectivityIssue(error);
      } else {
        console.error("Shot poller error:", error);
      }
    } finally {
      this.running = false;
    }
  }
}
