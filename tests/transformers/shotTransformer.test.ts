import { describe, it, expect } from "vitest";
import { transformShotForAI } from "../../src/transformers/shotTransformer.js";
import type { ShotData } from "../../src/parsers/binaryShot.js";

function createMockShot(overrides: Partial<ShotData> = {}): ShotData {
  return {
    id: "42",
    version: 4,
    fieldsMask: 0b111111,
    sampleCount: 3,
    sampleInterval: 100,
    profileId: "test-profile",
    profileName: "Test Profile",
    timestamp: 1707900000,
    rating: 0,
    duration: 30000, // 30 seconds
    weight: 36.5,
    phases: [],
    incomplete: false,
    samples: [
      { t: 0, tt: 93.0, ct: 92.0, tp: 9.0, cp: 1.0, fl: 0, pf: 0, v: 0, systemInfo: { raw: 0, shotStartedVolumetric: false, currentlyVolumetric: false, bluetoothScaleConnected: true, volumetricAvailable: false, extendedRecording: false } },
      { t: 15000, tt: 93.0, ct: 92.5, tp: 9.0, cp: 8.5, fl: 2.0, pf: 1.5, v: 10.0 },
      { t: 30000, tt: 93.0, ct: 93.0, tp: 9.0, cp: 9.0, fl: 2.5, pf: 2.0, v: 36.5 },
    ],
    ...overrides,
  };
}

describe("transformShotForAI", () => {
  it("transforms basic shot metadata", () => {
    const shot = createMockShot();
    const result = transformShotForAI(shot);

    expect(result.metadata.shot_id).toBe("42");
    expect(result.metadata.profile_name).toBe("Test Profile");
    expect(result.metadata.duration_seconds).toBe(30);
    expect(result.metadata.final_weight_grams).toBe(36.5);
    expect(result.metadata.sample_count).toBe(3);
    expect(result.metadata.bluetooth_scale_connected).toBe(true);
    expect(result.metadata.volumetric_mode).toBe(false);
  });

  it("calculates temperature summary", () => {
    const shot = createMockShot();
    const result = transformShotForAI(shot);

    expect(result.summary.temperature.min_celsius).toBe(92.0);
    expect(result.summary.temperature.max_celsius).toBe(93.0);
    expect(result.summary.temperature.average_celsius).toBeCloseTo(92.5, 1);
  });

  it("calculates pressure summary", () => {
    const shot = createMockShot();
    const result = transformShotForAI(shot);

    expect(result.summary.pressure.max_bar).toBe(9.0);
    expect(result.summary.pressure.min_bar).toBe(1.0);
  });

  it("includes full curve when requested", () => {
    const shot = createMockShot();

    const withoutCurve = transformShotForAI(shot, false);
    expect(withoutCurve.full_curve).toBeUndefined();

    const withCurve = transformShotForAI(shot, true);
    expect(withCurve.full_curve).toBeDefined();
    expect(withCurve.full_curve).toHaveLength(3);
  });

  it("creates single phase when no phases defined", () => {
    const shot = createMockShot({ phases: [] });
    const result = transformShotForAI(shot);

    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].name).toBe("extraction");
    expect(result.phases[0].phase_number).toBe(0);
  });

  it("handles shot with phases", () => {
    const shot = createMockShot({
      phases: [
        { sampleIndex: 0, phaseNumber: 0, phaseName: "Preinfusion" },
        { sampleIndex: 1, phaseNumber: 1, phaseName: "Extraction" },
      ],
    });
    const result = transformShotForAI(shot);

    expect(result.phases).toHaveLength(2);
    expect(result.phases[0].name).toBe("Preinfusion");
    expect(result.phases[1].name).toBe("Extraction");
  });

  it("converts timestamp to ISO string", () => {
    const shot = createMockShot({ timestamp: 1707900000 });
    const result = transformShotForAI(shot);

    expect(result.metadata.timestamp).toBe(new Date(1707900000 * 1000).toISOString());
  });
});
