import { describe, it, expect } from "vitest";
import { renderProfileChartSvg, buildSeries } from "../../src/visualization/profileChart.js";

/** Find the pressure value at a given time by interpolating between the two nearest sample points. */
function pressureAt(points: Array<{ t: number; v: number }>, time: number): number {
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].t <= time && points[i + 1].t >= time) {
      const span = points[i + 1].t - points[i].t;
      if (span === 0) return points[i].v;
      const frac = (time - points[i].t) / span;
      return points[i].v + (points[i + 1].v - points[i].v) * frac;
    }
  }
  return points[points.length - 1].v;
}

describe("profileChart", () => {
  it("renders SVG for profile with transitions", () => {
    const profile = {
      label: "Test Profile",
      temperature: 93,
      phases: [
        {
          name: "Preinfusion",
          duration: 10,
          pump: { target: "pressure", pressure: 3 },
          transition: { type: "linear", duration: 2 },
        },
        {
          name: "Extraction",
          duration: 30,
          pump: { target: "pressure", pressure: 9 },
          transition: { type: "ease-out", duration: 3 },
        },
      ],
    };

    const svg = renderProfileChartSvg(profile);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Preinfusion");
    expect(svg).toContain("Extraction");
    expect(svg).toContain("Pressure");
    expect(svg).toContain("Flow");
  });

  it("produces curved pressure ramp when transition is linear", () => {
    // Profile: 0 bar -> 9 bar over 5s with 3s linear transition
    const profile = {
      label: "Ramp Test",
      temperature: 93,
      phases: [
        {
          name: "Ramp",
          duration: 5,
          pump: { target: "pressure", pressure: 9 },
          transition: { type: "linear", duration: 3 },
        },
      ],
    };

    const svg = renderProfileChartSvg(profile);
    // The path should have multiple points (not just start and end) for a ramp
    // Pressure path format: M x y L x y L x y ...
    const pathMatch = svg.match(/<path[^>]*d="([^"]+)"/);
    expect(pathMatch).toBeTruthy();
    const pathD = pathMatch![1];
    // Should have multiple L (line) commands - indicates multiple sampled points
    const lineCommands = pathD.match(/L\s+[\d.-]+\s+[\d.-]+/g);
    expect(lineCommands?.length).toBeGreaterThan(5);
  });

  it("no transition on phase means instant (not borrowed from previous)", () => {
    const profile = {
      label: "No-Fallback Test",
      temperature: 93,
      phases: [
        {
          name: "Preinfusion",
          duration: 8,
          pump: { target: "pressure", pressure: 3 },
          transition: { type: "ease-in", duration: 2 },
        },
        {
          name: "Extraction",
          duration: 25,
          pump: { target: "pressure", pressure: 9 },
          // No transition — should be instant, NOT borrowed from Preinfusion
        },
      ],
    };

    const { pressure } = buildSeries(profile);

    // Find the first sample inside the Extraction phase (t > 8)
    const extractionStart = pressure.filter((p) => p.t > 8);
    expect(extractionStart.length).toBeGreaterThan(0);
    // With instant transition, the very first sample after phase start should already be at 9 bar
    expect(extractionStart[0].v).toBe(9);
  });

  it("handles profile from API with Transition (capital T)", () => {
    // Simulate API returning different casing
    const profile = {
      label: "API Profile",
      temperature: 93,
      phases: [
        {
          name: "Brew",
          duration: 30,
          pump: { target: "pressure", pressure: 9 },
          Transition: { type: "linear", duration: 2 }, // Capital T
        },
      ],
    };

    const svg = renderProfileChartSvg(profile);
    expect(svg).toContain("<svg");
    // Should have ramp (multiple path points) when Transition is used
    const pathMatch = svg.match(/<path[^>]*d="([^"]+)"/);
    expect(pathMatch).toBeTruthy();
    const lineCommands = pathMatch![1].match(/L\s+[\d.-]+\s+[\d.-]+/g);
    expect(lineCommands?.length).toBeGreaterThan(5);
  });

  // ─── Curve-shape verification tests ────────────────────────

  it("ease-out midpoint is above linear midpoint", () => {
    // 0→9 bar with 3s ease-out transition
    const easeOutProfile = {
      phases: [
        { name: "A", duration: 5, pump: { pressure: 9 }, transition: { type: "ease-out", duration: 3 } },
      ],
    };
    const linearProfile = {
      phases: [
        { name: "A", duration: 5, pump: { pressure: 9 }, transition: { type: "linear", duration: 3 } },
      ],
    };

    const easeOutSeries = buildSeries(easeOutProfile);
    const linearSeries = buildSeries(linearProfile);

    const midTime = 1.5; // midpoint of 3s transition
    const easeOutMid = pressureAt(easeOutSeries.pressure, midTime);
    const linearMid = pressureAt(linearSeries.pressure, midTime);

    // ease-out progress at 0.5 = 1 - (1-0.5)^2 = 0.75 → 6.75 bar
    // linear progress at 0.5 = 0.5 → 4.5 bar
    expect(easeOutMid).toBeGreaterThan(linearMid + 1);
    expect(easeOutMid).toBeCloseTo(6.75, 0);
    expect(linearMid).toBeCloseTo(4.5, 0);
  });

  it("ease-in midpoint is below linear midpoint", () => {
    // 0→9 bar with 3s ease-in transition
    const easeInProfile = {
      phases: [
        { name: "A", duration: 5, pump: { pressure: 9 }, transition: { type: "ease-in", duration: 3 } },
      ],
    };
    const linearProfile = {
      phases: [
        { name: "A", duration: 5, pump: { pressure: 9 }, transition: { type: "linear", duration: 3 } },
      ],
    };

    const easeInSeries = buildSeries(easeInProfile);
    const linearSeries = buildSeries(linearProfile);

    const midTime = 1.5;
    const easeInMid = pressureAt(easeInSeries.pressure, midTime);
    const linearMid = pressureAt(linearSeries.pressure, midTime);

    // ease-in progress at 0.5 = 0.5^2 = 0.25 → 2.25 bar
    // linear progress at 0.5 = 0.5 → 4.5 bar
    expect(easeInMid).toBeLessThan(linearMid - 1);
    expect(easeInMid).toBeCloseTo(2.25, 0);
  });

  it("ease-in-out midpoint equals linear but quarter-points differ", () => {
    const easeInOutProfile = {
      phases: [
        { name: "A", duration: 4, pump: { pressure: 8 }, transition: { type: "ease-in-out", duration: 4 } },
      ],
    };
    const linearProfile = {
      phases: [
        { name: "A", duration: 4, pump: { pressure: 8 }, transition: { type: "linear", duration: 4 } },
      ],
    };

    const eioSeries = buildSeries(easeInOutProfile);
    const linSeries = buildSeries(linearProfile);

    // At midpoint (t=2), ease-in-out and linear should be ~equal
    const eioMid = pressureAt(eioSeries.pressure, 2);
    const linMid = pressureAt(linSeries.pressure, 2);
    expect(Math.abs(eioMid - linMid)).toBeLessThan(0.5);

    // At 25% (t=1), ease-in-out should be below linear (still in the slow start)
    const eioQ1 = pressureAt(eioSeries.pressure, 1);
    const linQ1 = pressureAt(linSeries.pressure, 1);
    expect(eioQ1).toBeLessThan(linQ1);

    // At 75% (t=3), ease-in-out should be above linear (fast middle, slowing end)
    const eioQ3 = pressureAt(eioSeries.pressure, 3);
    const linQ3 = pressureAt(linSeries.pressure, 3);
    expect(eioQ3).toBeGreaterThan(linQ3);
  });

  it("instant transition produces step function", () => {
    const profile = {
      phases: [
        { name: "A", duration: 5, pump: { pressure: 9 }, transition: { type: "instant", duration: 0 } },
      ],
    };

    const { pressure } = buildSeries(profile);

    // At t=0, value should be 0 (old value)
    expect(pressure[0].v).toBe(0);
    // Very next sample (t=0.25) should already be at target
    const secondPoint = pressure.find((p) => p.t > 0);
    expect(secondPoint).toBeDefined();
    expect(secondPoint!.v).toBe(9);
  });

  it("string values in pump are coerced correctly", () => {
    const profileString = {
      phases: [
        { name: "A", duration: 5, pump: { pressure: "9" as any }, transition: { type: "linear", duration: 3 } },
      ],
    };
    const profileNumber = {
      phases: [
        { name: "A", duration: 5, pump: { pressure: 9 }, transition: { type: "linear", duration: 3 } },
      ],
    };

    const stringSeries = buildSeries(profileString);
    const numberSeries = buildSeries(profileNumber);

    // Both should produce the same pressure series
    expect(stringSeries.pressure.length).toBe(numberSeries.pressure.length);
    for (let i = 0; i < stringSeries.pressure.length; i++) {
      expect(stringSeries.pressure[i].t).toBeCloseTo(numberSeries.pressure[i].t, 6);
      expect(stringSeries.pressure[i].v).toBeCloseTo(numberSeries.pressure[i].v, 6);
    }
  });

  it("string flow values are coerced correctly", () => {
    const profile = {
      phases: [
        { name: "A", duration: 5, pump: { flow: "6" as any }, transition: { type: "linear", duration: 2 } },
      ],
    };

    const { flow } = buildSeries(profile);
    // After the 2s transition, flow should be at 6
    const lastPoint = flow[flow.length - 1];
    expect(lastPoint.v).toBe(6);
  });
});
