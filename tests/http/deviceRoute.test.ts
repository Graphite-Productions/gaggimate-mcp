import { describe, expect, it, vi } from "vitest";
import { createDeviceRouter } from "../../src/http/routes/device.js";

function getRouteHandler(router: any, path: string, method: "get" | "post"): (req: any, res: any) => Promise<void> {
  const routeLayer = router.stack?.find(
    (layer: any) => layer.route?.path === path && layer.route?.methods?.[method],
  );
  if (!routeLayer) {
    throw new Error(`Could not find ${method.toUpperCase()} ${path} route handler`);
  }
  return routeLayer.route.stack[0].handle;
}

function createResponse(): any {
  const res: any = {
    statusCode: 200,
    jsonBody: undefined,
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((payload: any) => {
    res.jsonBody = payload;
    return res;
  });
  return res;
}

function notionRecord(overrides: Partial<any>): any {
  return {
    pageId: "page-1",
    normalizedName: "profile",
    profileId: null,
    profileJson: "{}",
    pushStatus: "Draft",
    activeOnMachine: true,
    hasProfileImage: false,
    source: "Custom",
    favorite: false,
    selected: false,
    ...overrides,
  };
}

describe("device route profile listing", () => {
  it("merges Notion fallback profiles when device list appears incomplete", async () => {
    const gaggimate = {
      fetchProfiles: vi.fn().mockResolvedValue([
        { id: "device-1", label: "Active Device", selected: true, favorite: false, type: "pro" },
      ]),
      selectProfile: vi.fn(),
      favoriteProfile: vi.fn(),
    };
    const notion = {
      listExistingProfiles: vi.fn().mockResolvedValue({
        byName: new Map(),
        byId: new Map(),
        all: [
          notionRecord({
            pageId: "page-device-1",
            profileId: "device-1",
            profileJson: JSON.stringify({ id: "device-1", label: "Active Device" }),
            pushStatus: "Pushed",
          }),
          notionRecord({
            pageId: "page-device-2",
            profileId: "device-2",
            profileJson: JSON.stringify({ id: "device-2", label: "Backup Profile" }),
            pushStatus: "Pushed",
          }),
        ],
      }),
    };

    const router = createDeviceRouter(gaggimate as any, notion as any);
    const handler = getRouteHandler(router, "/profiles", "get");
    const res = createResponse();

    await handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.source).toBe("device+notion");
    expect(res.jsonBody.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "device-1", source: "device" }),
        expect.objectContaining({ id: "device-2", label: "Backup Profile", source: "notion" }),
      ]),
    );
  });

  it("returns Notion-only fallback when device is unreachable", async () => {
    const gaggimate = {
      fetchProfiles: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      selectProfile: vi.fn(),
      favoriteProfile: vi.fn(),
    };
    const notion = {
      listExistingProfiles: vi.fn().mockResolvedValue({
        byName: new Map(),
        byId: new Map(),
        all: [
          notionRecord({
            pageId: "page-device-3",
            profileId: "device-3",
            profileJson: JSON.stringify({ id: "device-3", label: "Recovery Profile" }),
            pushStatus: "Pushed",
          }),
        ],
      }),
    };

    const router = createDeviceRouter(gaggimate as any, notion as any);
    const handler = getRouteHandler(router, "/profiles", "get");
    const res = createResponse();

    await handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.source).toBe("notion-fallback");
    expect(res.jsonBody.warning).toContain("Device unreachable");
    expect(res.jsonBody.profiles).toEqual([
      expect.objectContaining({ id: "device-3", label: "Recovery Profile", source: "notion" }),
    ]);
  });
});
