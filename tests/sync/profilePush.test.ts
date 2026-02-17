import { describe, it, expect, vi } from "vitest";
import { pushProfileToGaggiMate } from "../../src/sync/profilePush.js";

function createMockGaggiMate() {
  return {
    saveProfile: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createMockNotion() {
  return {
    updatePushStatus: vi.fn().mockResolvedValue(undefined),
    extractProfileId: vi.fn().mockImplementation((profile: any) => {
      if (typeof profile?.id === "string" && profile.id.trim()) {
        return profile.id;
      }
      return null;
    }),
    updateProfileJson: vi.fn().mockResolvedValue(undefined),
    getProfileMeta: vi.fn().mockResolvedValue({ name: "Profile", source: null }),
    findAndArchiveSiblings: vi.fn().mockResolvedValue(0),
  };
}

describe("pushProfileToGaggiMate", () => {
  it("pushes valid profile and sets status to Pushed with Active on Machine", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      label: "My Profile",
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-1", profileJson);

    expect(gaggimate.saveProfile).toHaveBeenCalledTimes(1);
    const pushedProfile = gaggimate.saveProfile.mock.calls[0][0];
    expect(pushedProfile.phases[0]).toEqual(
      expect.objectContaining({
        valve: 1,
        pump: {
          target: "pressure",
          pressure: 9,
          flow: 0,
        },
      }),
    );
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-1", "Pushed", expect.any(String), true);
  });

  it("writes back assigned profile ID when save response contains id", async () => {
    const gaggimate = createMockGaggiMate();
    gaggimate.saveProfile.mockResolvedValue({ id: "device-123" });
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      label: "My Profile",
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-2", profileJson);

    expect(notion.updateProfileJson).toHaveBeenCalledTimes(1);
    expect(notion.updateProfileJson).toHaveBeenCalledWith(
      "page-2",
      expect.stringContaining("\"id\":\"device-123\""),
    );
  });

  it("does not write back ID when profile already has id", async () => {
    const gaggimate = createMockGaggiMate();
    gaggimate.saveProfile.mockResolvedValue({ id: "device-123" });
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      id: "already-present",
      label: "My Profile",
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-3", profileJson);

    expect(notion.updateProfileJson).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON and sets status to Failed", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-4", "not json {{{");

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-4", "Failed");
  });

  it("rejects profile with missing temperature", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-5", profileJson);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-5", "Failed");
  });

  it("rejects profile with non-numeric temperature", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      temperature: "93",
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-5b", profileJson);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-5b", "Failed");
  });

  it("rejects profile with missing phases", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    const profileJson = JSON.stringify({ temperature: 93 });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-6", profileJson);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-6", "Failed");
  });

  it("rejects profile with temperature out of range", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();

    await pushProfileToGaggiMate(
      gaggimate as any,
      notion as any,
      "page-7",
      JSON.stringify({ temperature: 50, phases: [{ name: "X", phase: "brew", duration: 10 }] }),
    );
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-7", "Failed");

    await pushProfileToGaggiMate(
      gaggimate as any,
      notion as any,
      "page-8",
      JSON.stringify({ temperature: 110, phases: [{ name: "X", phase: "brew", duration: 10 }] }),
    );
    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-8", "Failed");
  });

  it("sets status to Failed when saveProfile fails", async () => {
    const gaggimate = createMockGaggiMate();
    gaggimate.saveProfile.mockRejectedValue(new Error("Connection refused"));
    const notion = createMockNotion();

    const profileJson = JSON.stringify({
      label: "My Profile",
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-9", profileJson);

    expect(notion.updatePushStatus).toHaveBeenCalledWith("page-9", "Failed");
  });

  it("does not auto-archive siblings for AI-generated profiles", async () => {
    const gaggimate = createMockGaggiMate();
    const notion = createMockNotion();
    notion.getProfileMeta.mockResolvedValue({ name: "AI Profile v2", source: "AI-Generated" });

    const profileJson = JSON.stringify({
      label: "AI Profile v2",
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    await pushProfileToGaggiMate(gaggimate as any, notion as any, "page-10", profileJson);

    expect(notion.findAndArchiveSiblings).not.toHaveBeenCalled();
    expect(notion.getProfileMeta).not.toHaveBeenCalled();
  });
});
