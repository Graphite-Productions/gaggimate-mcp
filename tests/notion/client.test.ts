import { describe, expect, it, vi } from "vitest";
import { NotionClient } from "../../src/notion/client.js";

function createNotionClient() {
  const notion = new NotionClient({
    apiKey: "ntn_test",
    beansDbId: "beans-db",
    brewsDbId: "brews-db",
    profilesDbId: "profiles-db",
  });

  const mockClient = {
    pages: {
      create: vi.fn(),
      update: vi.fn(),
      retrieve: vi.fn(),
    },
    databases: {
      query: vi.fn(),
    },
    request: vi.fn(),
  };

  (notion as any).client = mockClient;
  return { notion, mockClient };
}

function titleProperty(value: string) {
  return {
    type: "title",
    title: [{ plain_text: value }],
  };
}

function richTextProperty(value: string) {
  return {
    type: "rich_text",
    rich_text: [{ plain_text: value }],
  };
}

describe("NotionClient profile helpers", () => {
  it("normalizeProfileName repairs mojibake profile labels", () => {
    const { notion } = createNotionClient();

    const normalized = notion.normalizeProfileName("Linea Gesha â Extended Bloom Clarity v3");
    expect(normalized).toBe("linea gesha — extended bloom clarity v3");
  });

  it("createDraftProfile creates Draft profile with machine state fields", async () => {
    const { notion, mockClient } = createNotionClient();
    mockClient.pages.create.mockResolvedValue({ id: "new-page-id" });

    const pageId = await notion.createDraftProfile({
      id: "device-id",
      label: "Device Profile",
      type: "pro",
      description: "from device",
      favorite: true,
      selected: false,
      temperature: 93,
      phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
    });

    expect(pageId).toBe("new-page-id");
    expect(mockClient.pages.create).toHaveBeenCalledTimes(1);

    const args = mockClient.pages.create.mock.calls[0][0];
    expect(args.parent).toEqual({ database_id: "profiles-db" });
    expect(args.properties["Push Status"]).toEqual({ select: { name: "Draft" } });
    expect(args.properties["Active on Machine"]).toEqual({ checkbox: true });
    expect(args.properties.Favorite).toEqual({ checkbox: true });
    expect(args.properties.Selected).toEqual({ checkbox: false });
  });

  it("updatePushStatus includes Active on Machine when provided", async () => {
    const { notion, mockClient } = createNotionClient();
    mockClient.pages.update.mockResolvedValue({});

    await notion.updatePushStatus("page-id", "Pushed", "2026-02-17T00:00:00.000Z", true);

    expect(mockClient.pages.update).toHaveBeenCalledTimes(1);
    expect(mockClient.pages.update).toHaveBeenCalledWith({
      page_id: "page-id",
      properties: {
        "Push Status": { select: { name: "Pushed" } },
        "Last Pushed": { date: { start: "2026-02-17T00:00:00.000Z" } },
        "Active on Machine": { checkbox: true },
      },
    });
  });

  it("listExistingProfiles extracts favorite/selected and excludes archived from lookup maps", async () => {
    const { notion, mockClient } = createNotionClient();
    mockClient.databases.query.mockResolvedValue({
      results: [
        {
          id: "pushed-page",
          properties: {
            "Profile Name": titleProperty("Pushed One"),
            "Profile JSON": richTextProperty("{\"id\":\"device-id\"}"),
            "Push Status": { type: "select", select: { name: "Pushed" } },
            "Active on Machine": { type: "checkbox", checkbox: true },
            "Profile Image": { type: "files", files: [] },
            Source: { type: "select", select: { name: "Custom" } },
            Favorite: { type: "checkbox", checkbox: true },
            Selected: { type: "checkbox", checkbox: true },
          },
        },
        {
          id: "archived-page",
          properties: {
            "Profile Name": titleProperty("Archived One"),
            "Profile JSON": richTextProperty("{\"id\":\"archived-id\"}"),
            "Push Status": { type: "select", select: { name: "Archived" } },
            "Active on Machine": { type: "checkbox", checkbox: false },
            "Profile Image": { type: "files", files: [] },
            Source: { type: "select", select: { name: "Custom" } },
            Favorite: { type: "checkbox", checkbox: false },
            Selected: { type: "checkbox", checkbox: false },
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    const existing = await notion.listExistingProfiles();

    expect(existing.all).toHaveLength(2);
    const pushed = existing.byId.get("device-id");
    expect(pushed).toBeDefined();
    expect(pushed?.favorite).toBe(true);
    expect(pushed?.selected).toBe(true);

    expect(existing.byName.has("archived one")).toBe(false);
    expect(existing.byId.has("archived-id")).toBe(false);
  });
});
