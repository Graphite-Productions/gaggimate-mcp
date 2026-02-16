import { describe, it, expect } from "vitest";
import { renderProfileChartSvg } from "../../src/visualization/profileChart.js";

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

  it("handles transition on previous phase (fallback)", () => {
    const profile = {
      label: "Fallback Test",
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
          // No transition on this phase - should use previous or default to instant
        },
      ],
    };

    const svg = renderProfileChartSvg(profile);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Preinfusion");
    expect(svg).toContain("Extraction");
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
});
