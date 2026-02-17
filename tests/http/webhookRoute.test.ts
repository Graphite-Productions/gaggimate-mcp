import { describe, expect, it, vi } from "vitest";
import { config } from "../../src/config.js";
import {
  buildNotionWebhookSignature,
  createWebhookRouter,
  isWebhookSecretConfigured,
  resolveWebhookProfileAction,
} from "../../src/http/routes/webhook.js";

function getNotionWebhookHandler(router: any): (req: any, res: any) => Promise<void> {
  const routeLayer = router.stack?.find(
    (layer: any) => layer.route?.path === "/notion" && layer.route?.methods?.post,
  );
  if (!routeLayer) {
    throw new Error("Could not find POST /notion route handler");
  }
  return routeLayer.route.stack[0].handle;
}

function createSignedRequest(body: any): any {
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (isWebhookSecretConfigured(config.webhook.secret)) {
    headers["x-notion-signature"] = buildNotionWebhookSignature(rawBody, config.webhook.secret);
  }

  return {
    body,
    headers,
    rawBody,
  };
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

function createMockGaggimate() {
  return {
    saveProfile: vi.fn().mockResolvedValue({ id: "device-queued" }),
    favoriteProfile: vi.fn().mockResolvedValue(undefined),
    selectProfile: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockNotion() {
  return {
    getProfilePushData: vi.fn(),
    getProfilePreferenceState: vi.fn(),
    extractProfileIdFromJson: vi.fn(),
    extractProfileId: vi.fn().mockImplementation((profile: any) => {
      if (typeof profile?.id === "string" && profile.id.trim()) {
        return profile.id;
      }
      return null;
    }),
    updateProfileJson: vi.fn().mockResolvedValue(undefined),
    updatePushStatus: vi.fn().mockResolvedValue(undefined),
  };
}

describe("webhook route status handling", () => {
  it("resolves status actions with status dominance", () => {
    expect(resolveWebhookProfileAction("Queued")).toBe("push_queued");
    expect(resolveWebhookProfileAction("Pushed")).toBe("sync_pushed_preferences");
    expect(resolveWebhookProfileAction("Archived")).toBe("ignore");
    expect(resolveWebhookProfileAction("Draft")).toBe("ignore");
    expect(resolveWebhookProfileAction("Failed")).toBe("ignore");
    expect(resolveWebhookProfileAction(null)).toBe("ignore");
  });

  it("syncs favorite and selected in background for Pushed profiles", async () => {
    const gaggimate = createMockGaggimate();
    const notion = createMockNotion();
    notion.getProfilePushData.mockResolvedValue({
      profileJson: JSON.stringify({ id: "device-123", label: "Profile" }),
      pushStatus: "Pushed",
    });
    notion.extractProfileIdFromJson.mockReturnValue("device-123");
    notion.getProfilePreferenceState.mockResolvedValue({ favorite: true, selected: true });

    const router = createWebhookRouter(gaggimate as any, notion as any);
    const handler = getNotionWebhookHandler(router);
    const req = createSignedRequest({
      type: "page.properties_updated",
      entity: { type: "page", id: "page-1" },
    });
    const res = createResponse();

    await handler(req, res);

    // Handler responds immediately with "accepted"
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ ok: true, action: "accepted" });

    // Wait for background processing to complete (mocks resolve on microtask ticks)
    await vi.waitFor(() => {
      expect(gaggimate.favoriteProfile).toHaveBeenCalledWith("device-123", true);
    });
    expect(gaggimate.selectProfile).toHaveBeenCalledWith("device-123");
    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
  });

  it("ignores Archived status even if profile is selected/favorited", async () => {
    const gaggimate = createMockGaggimate();
    const notion = createMockNotion();
    notion.getProfilePushData.mockResolvedValue({
      profileJson: JSON.stringify({ id: "device-archived", label: "Archived" }),
      pushStatus: "Archived",
    });

    const router = createWebhookRouter(gaggimate as any, notion as any);
    const handler = getNotionWebhookHandler(router);
    const req = createSignedRequest({
      type: "page.properties_updated",
      entity: { type: "page", id: "page-archived" },
    });
    const res = createResponse();

    await handler(req, res);

    // Responds immediately; background processing fetches push data then ignores
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ ok: true, action: "accepted" });

    // Wait for background to complete, then verify no device calls were made
    await vi.waitFor(() => {
      expect(notion.getProfilePushData).toHaveBeenCalledTimes(1);
    });
    expect(notion.extractProfileIdFromJson).not.toHaveBeenCalled();
    expect(notion.getProfilePreferenceState).not.toHaveBeenCalled();
    expect(gaggimate.favoriteProfile).not.toHaveBeenCalled();
    expect(gaggimate.selectProfile).not.toHaveBeenCalled();
    expect(gaggimate.saveProfile).not.toHaveBeenCalled();
  });

  it("still pushes queued profiles in background", async () => {
    const gaggimate = createMockGaggimate();
    const notion = createMockNotion();
    notion.getProfilePushData.mockResolvedValue({
      profileJson: JSON.stringify({
        label: "Queued Profile",
        temperature: 93,
        phases: [{ name: "Extraction", phase: "brew", duration: 30 }],
      }),
      pushStatus: "Queued",
    });
    notion.getProfilePreferenceState.mockResolvedValue({ favorite: false, selected: false });

    const router = createWebhookRouter(gaggimate as any, notion as any);
    const handler = getNotionWebhookHandler(router);
    const req = createSignedRequest({
      type: "page.properties_updated",
      entity: { type: "page", id: "page-queued" },
    });
    const res = createResponse();

    await handler(req, res);

    // Responds immediately
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ ok: true, action: "accepted" });

    // Wait for background push to complete
    await vi.waitFor(() => {
      expect(notion.updatePushStatus).toHaveBeenCalledWith("page-queued", "Pushed", expect.any(String), true);
    });
    expect(gaggimate.saveProfile).toHaveBeenCalledTimes(1);
  });
});
