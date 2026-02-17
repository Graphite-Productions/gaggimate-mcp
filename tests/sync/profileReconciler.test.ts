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

async function runReconcile(gaggimate: any, notion: any): Promise<void> {
  const reconciler = new ProfileReconciler(gaggimate, notion, { intervalMs: 1000 });
  await (reconciler as any).reconcile();
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

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).toHaveBeenCalledTimes(1);
    expect(notion.updateProfileJson).toHaveBeenCalledWith(
      "queued-page",
      expect.stringContaining("\"id\":\"device-123\""),
    );
    expect(notion.updatePushStatus).toHaveBeenCalledWith("queued-page", "Pushed", expect.any(String), true);
  });

  it("marks queued profile Failed when JSON is invalid", async () => {
    const gaggimate = createMockGaggimate();
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "queued-bad-json",
          normalizedName: "broken",
          profileJson: "{invalid-json",
          pushStatus: "Queued",
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("queued-bad-json", "Failed");
  });

  it("marks queued profile Failed when payload is invalid", async () => {
    const gaggimate = createMockGaggimate();
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "queued-invalid",
          normalizedName: "bad-temp",
          profileJson: JSON.stringify({
            label: "Bad Temp",
            temperature: 40,
            phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
          }),
          pushStatus: "Queued",
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("queued-invalid", "Failed");
  });

  it("re-pushes pushed profile when it is missing on device", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "missing-on-device",
          normalizedName: "missing profile",
          profileId: "profile-id",
          profileJson: JSON.stringify({
            label: "Missing Profile",
            temperature: 93,
            phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
          }),
          pushStatus: "Pushed",
          activeOnMachine: false,
          favorite: true,
          selected: true,
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).toHaveBeenCalledTimes(1);
    expect(gaggimate.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "profile-id", label: "Missing Profile" }),
    );
    expect(gaggimate.favoriteProfile).toHaveBeenCalledWith("profile-id", true);
    expect(gaggimate.selectProfile).toHaveBeenCalledWith("profile-id");
    expect(notion.updatePushStatus).toHaveBeenCalledWith("missing-on-device", "Pushed", expect.any(String), true);
  });

  it("marks pushed profile Failed when missing on device and Notion JSON is invalid", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "pushed-invalid-json",
          normalizedName: "bad",
          profileId: "device-id",
          profileJson: "{bad",
          pushStatus: "Pushed",
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("pushed-invalid-json", "Failed");
  });

  it("reconciles pushed profile drift before favorite and selected sync", async () => {
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

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).toHaveBeenCalledTimes(1);
    expect(gaggimate.favoriteProfile).toHaveBeenCalledWith("device-id", true);
    expect(gaggimate.selectProfile).toHaveBeenCalledWith("device-id");
    expect(notion.updateProfileJson).not.toHaveBeenCalled();

    const saveOrder = gaggimate.saveProfile.mock.invocationCallOrder[0];
    const favoriteOrder = gaggimate.favoriteProfile.mock.invocationCallOrder[0];
    const selectOrder = gaggimate.selectProfile.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(favoriteOrder);
    expect(saveOrder).toBeLessThan(selectOrder);
  });

  it("does not re-push when only favorite and selected differ", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([
      {
        id: "device-id",
        label: "Favorite Sync Profile",
        favorite: false,
        selected: false,
        temperature: 93,
        phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
      },
    ]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "favorite-sync-page",
          normalizedName: "favorite sync profile",
          profileId: "device-id",
          profileJson: JSON.stringify({
            id: "device-id",
            label: "Favorite Sync Profile",
            temperature: 93,
            phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
          }),
          pushStatus: "Pushed",
          favorite: true,
          selected: true,
          activeOnMachine: true,
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(gaggimate.favoriteProfile).toHaveBeenCalledWith("device-id", true);
    expect(gaggimate.selectProfile).toHaveBeenCalledWith("device-id");
  });

  it("does not re-push when only object key order differs", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([
      {
        id: "same-id",
        label: "Same Profile",
        temperature: 93,
        phases: [{ phase: "brew", duration: 30, name: "Extraction" }],
      },
    ]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "same-page",
          normalizedName: "same profile",
          profileId: "same-id",
          profileJson: JSON.stringify({
            label: "Same Profile",
            phases: [{ name: "Extraction", duration: 30, phase: "brew" }],
            temperature: 93,
            id: "same-id",
          }),
          pushStatus: "Pushed",
          activeOnMachine: false,
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("same-page", "Pushed", undefined, true);
  });

  it("does not re-push when device label is mojibake variant of Notion label", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([
      {
        id: "label-id",
        label: "Linea Gesha â Extended Bloom Clarity v3",
        temperature: 93,
        phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
      },
    ]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "label-page",
          normalizedName: "linea gesha — extended bloom clarity v3",
          profileId: "label-id",
          profileJson: JSON.stringify({
            id: "label-id",
            label: "Linea Gesha — Extended Bloom Clarity v3",
            temperature: 93,
            phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
          }),
          pushStatus: "Pushed",
          activeOnMachine: true,
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
  });

  it("deletes archived non-utility profiles and marks inactive", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([{ id: "archived-id", label: "Custom Profile", utility: false }]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "archived-page",
          normalizedName: "custom profile",
          profileId: "archived-id",
          profileJson: JSON.stringify({ id: "archived-id", label: "Custom Profile" }),
          pushStatus: "Archived",
          activeOnMachine: true,
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.deleteProfile).toHaveBeenCalledWith("archived-id");
    expect(notion.updatePushStatus).toHaveBeenCalledWith("archived-page", "Archived", undefined, false);
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

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.deleteProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).not.toHaveBeenCalledWith("archived-page", "Failed");
  });

  it("marks archived profile inactive when already missing on device", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "archived-missing",
          normalizedName: "gone",
          profileId: "gone-id",
          profileJson: JSON.stringify({ id: "gone-id", label: "Gone" }),
          pushStatus: "Archived",
          activeOnMachine: true,
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.deleteProfile).not.toHaveBeenCalled();
    expect(notion.updatePushStatus).toHaveBeenCalledWith("archived-missing", "Archived", undefined, false);
  });

  it("marks profile Failed when archived delete operation fails", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([{ id: "bad-delete-id", label: "Delete Me", utility: false }]);
    gaggimate.deleteProfile.mockRejectedValue(new Error("delete failed"));
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "archived-fail",
          normalizedName: "delete me",
          profileId: "bad-delete-id",
          profileJson: JSON.stringify({ id: "bad-delete-id", label: "Delete Me" }),
          pushStatus: "Archived",
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(notion.updatePushStatus).toHaveBeenCalledWith("archived-fail", "Failed");
  });

  it("imports unmatched device profiles as Draft", async () => {
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

    await runReconcile(gaggimate as any, notion as any);

    expect(notion.createDraftProfile).toHaveBeenCalledTimes(1);
    expect(notion.uploadProfileImage).toHaveBeenCalledTimes(1);
  });

  it("does not import duplicate Draft when Notion already has same profile name", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([
      {
        id: "device-only-id",
        label: "  Duplicate Name  ",
        temperature: 93,
        phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
      },
    ]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "existing-draft",
          normalizedName: "duplicate name",
          pushStatus: "Draft",
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(notion.createDraftProfile).not.toHaveBeenCalled();
  });

  it("skips device operations when conflicting managed records share same profile id", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockResolvedValue([{ id: "shared-id", label: "Shared Profile", utility: false }]);
    const notion = createMockNotion();
    notion.listExistingProfiles.mockResolvedValue({
      byName: new Map(),
      byId: new Map(),
      all: [
        createProfileRecord({
          pageId: "pushed-row",
          normalizedName: "shared profile pushed",
          profileId: "shared-id",
          profileJson: JSON.stringify({
            id: "shared-id",
            label: "Shared Profile",
            temperature: 93,
            phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
          }),
          pushStatus: "Pushed",
          activeOnMachine: true,
        }),
        createProfileRecord({
          pageId: "archived-row",
          normalizedName: "shared profile archived",
          profileId: "shared-id",
          profileJson: JSON.stringify({
            id: "shared-id",
            label: "Shared Profile",
            temperature: 93,
            phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
          }),
          pushStatus: "Archived",
          activeOnMachine: true,
        }),
      ],
    });

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
    expect(gaggimate.deleteProfile).not.toHaveBeenCalled();
  });

  it("backfills brew-profile relations", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchShot.mockResolvedValue({ profileName: "Profile A" });
    const notion = createMockNotion();
    notion.getProfilePageIdByName.mockResolvedValue("profile-page-id");
    notion.listBrewsMissingProfileRelation
      .mockResolvedValueOnce([{ pageId: "brew-page", activityId: "00123" }])
      .mockResolvedValueOnce([]);

    await runReconcile(gaggimate as any, notion as any);

    expect(gaggimate.fetchShot).toHaveBeenCalledWith("00123");
    expect(notion.getProfilePageIdByName).toHaveBeenCalledWith("Profile A");
    expect(notion.setBrewProfileRelation).toHaveBeenCalledWith("brew-page", "profile-page-id");
  });

  it("skips cycle cleanly when device fetch times out", async () => {
    const gaggimate = createMockGaggimate();
    gaggimate.fetchProfiles.mockRejectedValue(new Error("Request timeout: No response"));
    const notion = createMockNotion();

    await runReconcile(gaggimate as any, notion as any);

    expect(notion.listExistingProfiles).not.toHaveBeenCalled();
    expect(notion.createDraftProfile).not.toHaveBeenCalled();
  });
});
