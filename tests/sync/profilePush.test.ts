import { describe, it, expect, vi } from "vitest";
import { pushProfileToGaggiMate } from "../../src/sync/profilePush.js";

// Minimal mock types
function createMockGaggiMate() {
  return {
    updateAIProfile: vi.fn().mockResolvedValue({ success: true }),
    saveProfile: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createMockNotion() {
  return {
    updatePushStatus: vi.fn().mockResolvedValue(undefined),
  };
}

describe("pushProfileToGaggiMate", () => {
  it("pushes valid AI profile and sets status to Pushed", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-1", profileJson);

    expect(gaggimate.updateAIProfile).toHaveBeenCalledWith({
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-1", "Pushed", expect.any(String));
  });

  it("pushes named profile using saveProfile", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      label: "My Custom Profile",
      type: "pro",
      temperature: 90,
      phases: [{ name: "Preinfusion", phase: "preinfusion", duration: 8 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-2", profileJson);

    expect(gaggimate.saveProfile).toHaveBeenCalled();
    expect(gaggimate.updateAIProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-2", "Pushed", expect.any(String));
  });

  it("rejects invalid JSON and sets status to Failed", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-3", "not json {{{");

    expect(gaggimate.updateAIProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-3", "Failed");
  });

  it("rejects profile with missing temperature", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-4", profileJson);

    expect(gaggimate.updateAIProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-4", "Failed");
  });

  it("rejects profile with missing phases", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    const profileJson = JSON.stringify({ temperature: 93 });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-5", profileJson);

    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-5", "Failed");
  });

  it("rejects profile with temperature out of range", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    // Too low
    await pushProfileToGaggiMate(
      gaggimate as any, notion as any, "page-6",
      JSON.stringify({ temperature: 50, phases: [{ name: "X", phase: "brew", duration: 10 }] }),
    );
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-6", "Failed");

    // Too high
    await pushProfileToGaggiMate(
      gaggimate as any, notion as any, "page-7",
      JSON.stringify({ temperature: 110, phases: [{ name: "X", phase: "brew", duration: 10 }] }),
    );
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-7", "Failed");
  });

  it("sets status to Failed when GaggiMate push fails", async () => {
    const gaggimate = createMockGaggiMate();
    gaggimate.updateAIProfile.mockRejectedValue(new Error("Connection refused"));
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-8", profileJson);

    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-8", "Failed");
  });
});
