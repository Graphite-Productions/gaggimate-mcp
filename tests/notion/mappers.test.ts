import { describe, it, expect } from "vitest";
import { shotToBrewData, brewDataToNotionProperties } from "../../src/notion/mappers.js";
import type { ShotData } from "../../src/parsers/binaryShot.js";
import type { TransformedShot } from "../../src/transformers/shotTransformer.js";

function createMockShotData(): ShotData {
  return {
    id: "47",
    version: 4,
    fieldsMask: 0,
    sampleCount: 0,
    sampleInterval: 100,
    profileId: "profile-123",
    profileName: "Classic 9-bar",
    timestamp: 1707900000,
    rating: 0,
    duration: 28000,
    weight: 36.0,
    samples: [],
    phases: [],
    incomplete: false,
  };
}

function createMockTransformed(): TransformedShot {
  return {
    metadata: {
      shot_id: "47",
      profile_name: "Classic 9-bar",
      profile_id: "profile-123",
      timestamp: "2024-02-14T10:00:00.000Z",
      duration_seconds: 28,
      final_weight_grams: 36.0,
      sample_count: 100,
      sample_interval_ms: 100,
      bluetooth_scale_connected: true,
      volumetric_mode: false,
    },
    summary: {
      temperature: { min_celsius: 91.5, max_celsius: 93.2, average_celsius: 92.4, target_average: 93.0 },
      pressure: { min_bar: 0.5, max_bar: 9.1, average_bar: 7.8, peak_time_seconds: 12.5 },
      flow: { total_volume_ml: 42.3, average_flow_rate_ml_s: 1.8, peak_flow_ml_s: 2.5, time_to_first_drip_seconds: 6.2 },
      extraction: { extraction_time_seconds: 28, preinfusion_time_seconds: 5.5, main_extraction_seconds: 22.5 },
    },
    phases: [],
  };
}

describe("shotToBrewData", () => {
  it("maps shot data to brew data with correct title format", () => {
    const shot = createMockShotData();
    const transformed = createMockTransformed();
    const brew = shotToBrewData(shot, transformed);

    expect(brew.activityId).toBe("47");
    expect(brew.title).toMatch(/^#047 - /);
    expect(brew.title).toContain("Feb 14");
    expect(brew.date).toBe("2024-02-14T10:00:00.000Z");
    expect(brew.brewTime).toBe(28);
    expect(brew.yieldOut).toBe(36.0);
    expect(brew.brewTemp).toBeCloseTo(92.4, 1);
    expect(brew.peakPressure).toBeCloseTo(9.1, 1);
    expect(brew.preinfusionTime).toBeCloseTo(5.5, 1);
    expect(brew.totalVolume).toBeCloseTo(42.3, 1);
    expect(brew.profileName).toBe("Classic 9-bar");
    expect(brew.source).toBe("Auto");
  });

  it("zero-pads shot number in title", () => {
    const shot = createMockShotData();
    shot.id = "3";
    const transformed = createMockTransformed();
    transformed.metadata.shot_id = "3";
    const brew = shotToBrewData(shot, transformed);

    expect(brew.title).toMatch(/^#003/);
  });

  it("handles null weight", () => {
    const shot = createMockShotData();
    shot.weight = null;
    const transformed = createMockTransformed();
    transformed.metadata.final_weight_grams = null;
    const brew = shotToBrewData(shot, transformed);

    expect(brew.yieldOut).toBeNull();
  });
});

describe("brewDataToNotionProperties", () => {
  it("creates correct Notion property structure", () => {
    const brew = shotToBrewData(createMockShotData(), createMockTransformed());
    const props = brewDataToNotionProperties(brew);

    // Title
    expect(props.Brew.title[0].text.content).toContain("#047");

    // Activity ID for dedup
    expect(props["Activity ID"].rich_text[0].text.content).toBe("47");

    // Date
    expect(props.Date.date.start).toBe("2024-02-14T10:00:00.000Z");

    // Numbers
    expect(props["Brew Time"].number).toBe(28);
    expect(props["Brew Temp"].number).toBeCloseTo(92.4, 1);
    expect(props["Peak Pressure"].number).toBeCloseTo(9.1, 1);

    // Yield Out should be present (weight is not null)
    expect(props["Yield Out"].number).toBe(36.0);

    // Source
    expect(props.Source.select.name).toBe("Auto");
  });

  it("omits Yield Out when weight is null", () => {
    const shot = createMockShotData();
    shot.weight = null;
    const transformed = createMockTransformed();
    transformed.metadata.final_weight_grams = null;
    const brew = shotToBrewData(shot, transformed);
    const props = brewDataToNotionProperties(brew);

    expect(props["Yield Out"]).toBeUndefined();
  });
});
