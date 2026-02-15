import * as fs from "node:fs";
import * as path from "node:path";

export interface SyncStateData {
  lastSyncedShotId: string | null;
  lastSyncTime: string | null;
  totalShotsSynced: number;
}

const STATE_FILE = "sync-state.json";

export class SyncState {
  lastSyncedShotId: string | null;
  lastSyncTime: string | null;
  totalShotsSynced: number;
  private filePath: string;

  private constructor(data: SyncStateData, filePath: string) {
    this.lastSyncedShotId = data.lastSyncedShotId;
    this.lastSyncTime = data.lastSyncTime;
    this.totalShotsSynced = data.totalShotsSynced;
    this.filePath = filePath;
  }

  static load(dataDir: string): SyncState {
    const filePath = path.join(dataDir, STATE_FILE);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as SyncStateData;
      return new SyncState(data, filePath);
    } catch {
      return new SyncState(
        { lastSyncedShotId: null, lastSyncTime: null, totalShotsSynced: 0 },
        filePath,
      );
    }
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: SyncStateData = {
      lastSyncedShotId: this.lastSyncedShotId,
      lastSyncTime: this.lastSyncTime,
      totalShotsSynced: this.totalShotsSynced,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  recordSync(shotId: string): void {
    this.lastSyncedShotId = shotId;
    this.lastSyncTime = new Date().toISOString();
    this.totalShotsSynced++;
    this.save();
  }
}
