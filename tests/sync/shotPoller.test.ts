import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ShotPoller } from "../../src/sync/shotPoller.js";

function createMockShotData() {
  return {
    id: "1",
    version: 4,
    fieldsMask: 0,
    sampleCount: 1,
    sampleInterval: 100,
    profileId: "profile-1",
    profileName: "Device Profile",
    timestamp: 1707900000,
    rating: 0,
    duration: 28000,
    weight: 36,
    samples: [
      {
        t: 0,
        tt: 93,
        ct: 93,
        cp: 9,
        pf: 1.2,
        v: 0,
        systemInfo: {
          bluetoothScaleConnected: true,
          shotStartedVolumetric: false,
        },
      },
    ],
    phases: [],
    incomplete: false,
  };
}

describe("ShotPoller", () => {
  it("re-checks profile existence before creating Draft import", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "shot-poller-test-"));

    const gaggimate = {
      fetchShotHistory: vi.fn().mockResolvedValue([{ id: "1" }]),
      fetchShot: vi.fn().mockResolvedValue(createMockShotData()),
      fetchProfiles: vi.fn().mockResolvedValue([{ label: "Device Profile", id: "profile-1" }]),
      uploadBrewChart: vi.fn(),
    };

    const notion = {
      findBrewByShotId: vi.fn().mockResolvedValue(null),
      hasProfileByName: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      normalizeProfileName: vi.fn().mockImplementation((name: string) => name.trim().toLowerCase()),
      createDraftProfile: vi.fn().mockResolvedValue("profile-page"),
      uploadProfileImage: vi.fn().mockResolvedValue(true),
      createBrew: vi.fn().mockResolvedValue("brew-page"),
      updateBrewFromData: vi.fn(),
      setBrewShotJson: vi.fn().mockResolvedValue(undefined),
      brewHasProfileImage: vi.fn().mockResolvedValue(true),
      uploadBrewChart: vi.fn().mockResolvedValue(true),
    };

    try {
      const poller = new ShotPoller(gaggimate as any, notion as any, {
        intervalMs: 1000,
        dataDir,
        recentShotLookbackCount: 5,
        brewTitleTimeZone: "America/Los_Angeles",
      });

      await (poller as any).poll();

      expect(notion.hasProfileByName).toHaveBeenCalledTimes(2);
      expect(notion.createDraftProfile).not.toHaveBeenCalled();
      expect(notion.createBrew).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("treats EHOSTUNREACH as connectivity issue and skips noisy fatal errors", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "shot-poller-test-"));
    const networkError: any = new TypeError("fetch failed");
    networkError.cause = { code: "EHOSTUNREACH", message: "connect EHOSTUNREACH 192.168.68.51:80" };

    const gaggimate = {
      fetchShotHistory: vi.fn().mockRejectedValue(networkError),
      fetchShot: vi.fn(),
      fetchProfiles: vi.fn(),
      uploadBrewChart: vi.fn(),
    };

    const notion = {
      findBrewByShotId: vi.fn(),
      hasProfileByName: vi.fn(),
      normalizeProfileName: vi.fn(),
      createDraftProfile: vi.fn(),
      uploadProfileImage: vi.fn(),
      createBrew: vi.fn(),
      updateBrewFromData: vi.fn(),
      setBrewShotJson: vi.fn(),
      brewHasProfileImage: vi.fn(),
      uploadBrewChart: vi.fn(),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const poller = new ShotPoller(gaggimate as any, notion as any, {
        intervalMs: 1000,
        dataDir,
        recentShotLookbackCount: 5,
        brewTitleTimeZone: "America/Los_Angeles",
      });

      await (poller as any).poll();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("GaggiMate unreachable"));
      expect(errorSpy).not.toHaveBeenCalledWith("Shot poller error:", expect.anything());
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
