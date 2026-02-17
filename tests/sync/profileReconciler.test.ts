import { describe, expect, it, vi } from "vitest";
import { ProfileReconciler } from "../../src/sync/profileReconciler.js";
import type { ExistingProfileRecord } from "../../src/notion/client.js";

function createProfileRecord(overrides: Partial<ExistingProfileRecord>): ExistingProfileRecord {
  return {
    pageId: "page-1",
    normalizedName: "profile",
    profileId: null,
    profileJson: "{}",
    pushStatus: "Draft",
    activeOnMachine: null,
    hasProfileImage: false,
    source: null,
    favorite: false,
    selected: false,
    ...overrides,
  };
}

function createMockGaggimate() {
  return {
    fetchProfiles: vi.fn().mockResolvedValue([]),
    saveProfile: vi.fn().mockResolvedValue({}),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    favoriteProfile: vi.fn().mockResolvedValue(undefined),
    selectProfile: vi.fn().mockResolvedValue(undefined),
    fetchShot: vi.fn().mockResolvedValue(null),
  };
}

function createMockNotion() {
  return {
    listExistingProfiles: vi.fn().mockResolvedValue({ byName: new Map(), byId: new Map(), all: [] }),
    extractProfileId: vi.fn().mockImplementation((profile: any) => {
      if (typeof profile?.id === "string" && profile.id.trim()) {
        return profile.id;
      }
      return null;
    }),
    normalizeProfileName: vi.fn().mockImplementation((name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()),
    updatePushStatus: vi.fn().mockResolvedValue(undefined),
    updateProfileJson: vi.fn().mockResolvedValue(undefined),
    getProfileMeta: vi.fn().mockResolvedValue({ name: "Profile", source: null }),
    findAndArchiveSiblings: vi.fn().mockResolvedValue(0),
    createDraftProfile: vi.fn().mockResolvedValue("new-page"),
    uploadProfileImage: vi.fn().mockResolvedValue(true),
    listBrewsMissingProfileRelation: vi.fn().mockResolvedValue([]),
    getProfilePageIdByName: vi.fn().mockResolvedValue(null),
    setBrewProfileRelation: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ProfileReconciler", () => {
  it("pushes queued profile and writes back assigned id", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.saveProfile.mockResolvedValue({ id: "device-123" });
    const notion = createMockNotion();

    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "queued-page",
          normalizedName: "queued profile",
          profileJson: JSON.stringify({
            label: "Queued Profile",
            temperature: 93,
            phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
          }),
          pushStatus: "Queued",
        }),
      ],
    });

    const reconciler = new ProfileReconciler(gaggimate as any, notion as any, { intervalMs: 1000 });
    await (reconciler as any).reconcile();

    expect(gaggimate.saveProfile).toHaveBeenCalledTimes(1);
    expect(notion.updateProfileJson).toHaveBeenCalledWith(
      "queued-page",
      expect.stringContaining("\"id\":\"device-123\""),
    );
    expect(notion.updatePushStatus).toHaveBeenCalledWith("queued-page", "Pushed", expect.any(String), true);
  });

  it("does not delete archived utility profiles", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([{ id: "flush-id", label: "Flush", utility: true }]);
    const notion = createMockNotion();

    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "archived-page",
          normalizedName: "flush",
          profileId: "flush-id",
          profileJson: JSON.stringify({ id: "flush-id", label: "Flush", utility: true }),
          pushStatus: "Archived",
          activeOnMachine: true,
        }),
      ],
    });

    const reconciler = new ProfileReconciler(gaggimate as any, notion as any, { intervalMs: 1000 });
    await (reconciler as any).reconcile();

    expect(gaggimate.deleteProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).not.toHaveBeenCalledWith("archived-page", "Failed");
  });

  it("imports unmatched device profiles as drafts", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([
      {
        id: "device-only-id",
        label: "Device Only",
        temperature: 93,
        phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
      },
    ]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({ byName: new Map(), byId: new Map(), all: [] });

    const reconciler = new ProfileReconciler(gaggimate as any, notion as any, { intervalMs: 1000 });
    await (reconciler as any).reconcile();

    expect(notion.createDraftProfile).toHaveBeenCalledTimes(1);
    expect(notion.uploadProfileImage).toHaveBeenCalledTimes(1);
  });

  it("reconciles pushed profile drift before favorite/selected sync", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([
      {
        id: "device-id",
        label: "Drifted Profile",
        favorite: false,
        selected: false,
        temperature: 90,
        phases: [{ name: "Extraction", phase: "brew", duration: 25 }],
      },
    ]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map([["device-id", createProfileRecord({})]]),
      all: [
        createProfileRecord({
          pageId: "pushed-page",
          normalizedName: "drifted profile",
          profileId: "device-id",
          profileJson: JSON.stringify({
            id: "device-id",
            label: "Drifted Profile",
            favorite: true,
            selected: true,
            temperature: 93,
            phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
          }),
          pushStatus: "Pushed",
          activeOnMachine: true,
          favorite: true,
          selected: true,
        }),
      ],
    });

    const reconciler = new ProfileReconciler(gaggimate as any, notion as any, { intervalMs: 1000 });
    await (reconciler as any).reconcile();

    expect(gaggimate.saveProfile).toHaveBeenCalledTimes(1);
    expect(gaggimate.favoriteProfile).toHaveBeenCalledWith("device-id", true);
    expect(gaggimate.selectProfile).toHaveBeenCalledWith("device-id");

    const saveOrder = gaggimate.saveProfile.mock.invocationCallOrder[0];
    const favoriteOrder = gaggimate.favoriteProfile.mock.invocationCallOrder[0];
    const selectOrder = gaggimate.selectProfile.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(favoriteOrder);
    expect(saveOrder).toBeLessThan(selectOrder);
  });
});
