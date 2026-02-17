import { describe, expect, it } from "vitest";
import {
  buildNotionWebhookSignature,
  isValidNotionWebhookSignature,
} from "../../src/http/routes/webhook.js";

describe("Notion webhook signature helpers", () => {
  it("accepts a valid Notion HMAC SHA256 signature", () => {
    const payload = JSON.stringify({
      type: "page.properties_updated",
      entity: { id: "page-1", type: "page" },
    });
    const token = "verification-token";

    const signature = buildNotionWebhookSignature(payload, token);
    const valid = isValidNotionWebhookSignature(payload, signature, token);

    expect(valid).toBe(true);
  });

  it("rejects invalid signatures and missing headers", () => {
    const payload = JSON.stringify({ type: "page.properties_updated" });
    const token = "verification-token";
    const validSignature = buildNotionWebhookSignature(payload, token);

    expect(isValidNotionWebhookSignature(payload, undefined, token)).toBe(false);
    expect(isValidNotionWebhookSignature(payload, "sha256=deadbeef", token)).toBe(false);
    expect(isValidNotionWebhookSignature(payload, `${validSignature}0`, token)).toBe(false);
  });

  it("supports array-shaped header values from Node/Express", () => {
    const payload = JSON.stringify({ type: "page.changed" });
    const token = "verification-token";
    const signature = buildNotionWebhookSignature(payload, token);

    expect(isValidNotionWebhookSignature(payload, [signature], token)).toBe(true);
  });

  it("rejects multi-value signature headers to avoid ambiguity", () => {
    const payload = JSON.stringify({ type: "page.changed" });
    const token = "verification-token";
    const signature = buildNotionWebhookSignature(payload, token);

    expect(isValidNotionWebhookSignature(payload, [signature, signature], token)).toBe(false);
  });
});
