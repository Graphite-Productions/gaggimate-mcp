import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ShotPoller } from "../../src/sync/shotPoller.js";
import { ShotCache } from "../../src/sync/shotCache.js";

function mockGaggiMate() {
  return {
    fetchShotHistory: vi.fn().mockResolvedValue([
      { id: "041", incomplete: false },
      { id: "042", incomplete: false },
    ]),
    fetchShot: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        incomplete: false,
        samples: [{ time: 0, pressure: 9, flow: 2, temp: 93, weight: 0 }],
        metadata: { brew_time_s: 28, peak_pressure_bar: 9.1 },
      })
    ),
  };
}

// Mock transformShotForAI to just pass through
vi.mock("../../src/transformers/shotTransformer.js", () => ({
  transformShotForAI: (data: any) => ({
    id: data.id,
    metadata: data.metadata,
    profile_name: data.profile_name || null,
    samples: data.samples,
  }),
}));

describe("ShotPoller (cache-based)", () => {
  let tmpDir: string;
  let cache: ShotCache;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poller-test-"));
    cache = new ShotCache(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("polls shots and writes them to cache", async () => {
    const gaggimate = mockGaggiMate();
    const poller = new ShotPoller(gaggimate as any, cache, {
      intervalMs: 30000,
      dataDir: tmpDir,
    });

    await poller.pollOnce();

    expect(cache.read("041")).not.toBeNull();
    expect(cache.read("042")).not.toBeNull();
    expect(poller.syncState.lastSyncedShotId).toBe("042");
  });

  it("skips already-cached shots", async () => {
    const gaggimate = mockGaggiMate();
    const poller = new ShotPoller(gaggimate as any, cache, {
      intervalMs: 30000,
      dataDir: tmpDir,
    });

    await poller.pollOnce();
    gaggimate.fetchShot.mockClear();

    await poller.pollOnce();
    // Should not re-fetch already-cached shots
    expect(gaggimate.fetchShot.mock.calls.length).toBe(0);
  });

  it("skips incomplete shots", async () => {
    const gaggimate = mockGaggiMate();
    gaggimate.fetchShotHistory.mockResolvedValue([
      { id: "043", incomplete: true },
    ]);
    const poller = new ShotPoller(gaggimate as any, cache, {
      intervalMs: 30000,
      dataDir: tmpDir,
    });

    await poller.pollOnce();

    expect(cache.read("043")).toBeNull();
    expect(gaggimate.fetchShot).not.toHaveBeenCalled();
  });

  it("skips polling during connectivity cooldown", async () => {
    const networkError: any = new TypeError("fetch failed");
    networkError.cause = { code: "EHOSTUNREACH" };

    const gaggimate = mockGaggiMate();
    gaggimate.fetchShotHistory.mockRejectedValueOnce(networkError);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const poller = new ShotPoller(gaggimate as any, cache, {
        intervalMs: 30000,
        dataDir: tmpDir,
        connectivityCooldownMs: 60000,
      });

      // First poll: device unreachable, enters cooldown
      await poller.pollOnce();
      expect(gaggimate.fetchShotHistory).toHaveBeenCalledTimes(1);

      // Second poll: cooldown active, should not call fetchShotHistory
      await poller.pollOnce();
      expect(gaggimate.fetchShotHistory).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("handles per-shot fetch errors without stopping", async () => {
    const gaggimate = mockGaggiMate();
    gaggimate.fetchShot
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValueOnce({
        id: "042",
        incomplete: false,
        samples: [{ time: 0, pressure: 9, flow: 2, temp: 93, weight: 0 }],
        metadata: { brew_time_s: 30 },
      });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const poller = new ShotPoller(gaggimate as any, cache, {
        intervalMs: 30000,
        dataDir: tmpDir,
      });

      await poller.pollOnce();

      // Shot 041 failed but 042 should still be cached
      expect(cache.read("041")).toBeNull();
      expect(cache.read("042")).not.toBeNull();
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
