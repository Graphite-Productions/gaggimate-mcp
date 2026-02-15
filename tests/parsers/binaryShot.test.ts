import { describe, it, expect } from "vitest";
import { parseBinaryShot } from "../../src/parsers/binaryShot.js";
import { createShotBuffer } from "../fixtures/createFixtures.js";

describe("parseBinaryShot", () => {
  it("parses a valid v4 shot file with samples", () => {
    // Fields mask: T(0), TT(1), CT(2), TP(3), CP(4), FL(5) = 0b111111 = 63
    const fieldsMask = 0b111111;
    const timestamp = 1707900000;

    const buffer = createShotBuffer({
      version: 4,
      sampleInterval: 100,
      fieldsMask,
      duration: 30000,
      timestamp,
      profileId: "test-profile",
      profileName: "Test Profile",
      weight: 380, // 38.0g
      samples: [
        // T(tick), TT(target temp), CT(current temp), TP(target pressure), CP(current pressure), FL(flow)
        [0, 930, 920, 90, 10, 0],     // tick=0, TT=93.0°C, CT=92.0°C, TP=9.0bar, CP=1.0bar, FL=0
        [10, 930, 925, 90, 85, 50],    // tick=10, CT=92.5°C, CP=8.5bar, FL=0.50ml/s
        [20, 930, 928, 90, 88, 100],   // tick=20, CT=92.8°C, CP=8.8bar, FL=1.00ml/s
      ],
    });

    const result = parseBinaryShot(buffer, "1");

    expect(result.id).toBe("1");
    expect(result.version).toBe(4);
    expect(result.sampleInterval).toBe(100);
    expect(result.duration).toBe(30000);
    expect(result.timestamp).toBe(timestamp);
    expect(result.profileId).toBe("test-profile");
    expect(result.profileName).toBe("Test Profile");
    expect(result.weight).toBeCloseTo(38.0, 1);
    expect(result.sampleCount).toBe(3);
    expect(result.incomplete).toBe(false);

    // Check first sample
    expect(result.samples[0].tt).toBeCloseTo(93.0, 1);
    expect(result.samples[0].ct).toBeCloseTo(92.0, 1);
    expect(result.samples[0].cp).toBeCloseTo(1.0, 1);

    // Check last sample
    expect(result.samples[2].ct).toBeCloseTo(92.8, 1);
    expect(result.samples[2].cp).toBeCloseTo(8.8, 1);
  });

  it("handles zero weight as null", () => {
    const buffer = createShotBuffer({
      version: 4,
      fieldsMask: 0b000001, // just T field
      weight: 0,
      samples: [[0], [10]],
    });

    const result = parseBinaryShot(buffer, "2");
    expect(result.weight).toBeNull();
  });

  it("throws on invalid magic number", () => {
    const buffer = Buffer.alloc(128);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, 0xdeadbeef, true);

    expect(() => parseBinaryShot(buffer, "1")).toThrow("Invalid shot magic");
  });

  it("throws on buffer too small", () => {
    const buffer = Buffer.alloc(64); // too small for v4 header
    expect(() => parseBinaryShot(buffer, "1")).toThrow("too small");
  });

  it("parses a shot with no samples", () => {
    const buffer = createShotBuffer({
      version: 4,
      fieldsMask: 0b000001,
      duration: 0,
      samples: [],
    });

    const result = parseBinaryShot(buffer, "3");
    expect(result.sampleCount).toBe(0);
    expect(result.samples).toHaveLength(0);
  });
});
