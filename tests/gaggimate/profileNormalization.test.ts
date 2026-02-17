import { describe, expect, it } from "vitest";
import { normalizeProfileForGaggiMate } from "../../src/gaggimate/profileNormalization.js";

describe("normalizeProfileForGaggiMate", () => {
  it("fills default valve and pump fields for phases", () => {
    const normalized = normalizeProfileForGaggiMate({
      label: "Defaulted",
      type: "pro",
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    expect(normalized.phases[0]).toEqual(
      expect.objectContaining({
        valve: 1,
        pump: {
          target: "pressure",
          pressure: 9,
          flow: 0,
        },
        temperature: 93,
      }),
    );
  });

  it("preserves explicit phase valve and pump settings", () => {
    const normalized = normalizeProfileForGaggiMate({
      label: "Flow Profile",
      type: "pro",
      temperature: 92,
      phases: [
        {
          name: "Flow Ramp",
          phase: "preinfusion",
          valve: 0,
          duration: 12,
          pump: {
            target: "flow",
            flow: 3.2,
            pressure: 1.5,
          },
        },
      ],
    });

    expect(normalized.phases[0]).toEqual(
      expect.objectContaining({
        phase: "preinfusion",
        valve: 0,
        pump: {
          target: "flow",
          flow: 3.2,
          pressure: 1.5,
        },
      }),
    );
  });

  it("does not mutate the original profile payload", () => {
    const profile = {
      label: "Original",
      type: "pro",
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    };
    const before = JSON.parse(JSON.stringify(profile));

    normalizeProfileForGaggiMate(profile);

    expect(profile).toEqual(before);
    expect(profile.phases[0]).not.toHaveProperty("valve");
    expect(profile.phases[0]).not.toHaveProperty("pump");
  });
});
