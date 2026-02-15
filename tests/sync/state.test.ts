import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SyncState } from "../../src/sync/state.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("SyncState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-state-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns default state when no file exists", () => {
    const state = SyncState.load(tmpDir);
    expect(state.lastSyncedShotId).toBeNull();
    expect(state.lastSyncTime).toBeNull();
    expect(state.totalShotsSynced).toBe(0);
  });

  it("persists and loads state", () => {
    const state = SyncState.load(tmpDir);
    state.recordSync("42");

    // Load from file again
    const loaded = SyncState.load(tmpDir);
    expect(loaded.lastSyncedShotId).toBe("42");
    expect(loaded.lastSyncTime).not.toBeNull();
    expect(loaded.totalShotsSynced).toBe(1);
  });

  it("increments totalShotsSynced with each recordSync", () => {
    const state = SyncState.load(tmpDir);
    state.recordSync("1");
    state.recordSync("2");
    state.recordSync("3");

    const loaded = SyncState.load(tmpDir);
    expect(loaded.totalShotsSynced).toBe(3);
    expect(loaded.lastSyncedShotId).toBe("3");
  });

  it("creates the data directory if it doesn't exist", () => {
    const nested = path.join(tmpDir, "nested", "dir");
    const state = SyncState.load(nested);
    state.recordSync("1");

    expect(fs.existsSync(path.join(nested, "sync-state.json"))).toBe(true);
  });

  it("handles corrupted state file gracefully", () => {
    fs.writeFileSync(path.join(tmpDir, "sync-state.json"), "not valid json");
    const state = SyncState.load(tmpDir);
    expect(state.lastSyncedShotId).toBeNull();
    expect(state.totalShotsSynced).toBe(0);
  });
});
