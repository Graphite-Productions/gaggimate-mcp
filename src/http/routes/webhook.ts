import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import type { GaggiMateClient } from "../../gaggimate/client.js";
import type { NotionClient } from "../../notion/client.js";
import { config } from "../../config.js";
import { pushProfileToGaggiMate } from "../../sync/profilePush.js";

export function isWebhookSecretConfigured(secret: string): boolean {
  return secret.trim().length > 0;
}

function toHeaderString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
    return value[0];
  }
  return null;
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildNotionWebhookSignature(payload: string, verificationToken: string): string {
  const digest = createHmac("sha256", verificationToken).update(payload).digest("hex");
  return `sha256=${digest}`;
}

export function isValidNotionWebhookSignature(
  payload: string,
  signatureHeader: string | string[] | undefined,
  verificationToken: string,
): boolean {
  const signature = toHeaderString(signatureHeader);
  if (!signature) {
    return false;
  }

  const expectedSignature = buildNotionWebhookSignature(payload, verificationToken);
  return secureEquals(signature, expectedSignature);
}

export function createWebhookRouter(gaggimate: GaggiMateClient, notion: NotionClient): Router {
  const router = Router();
  let warnedMissingSecret = false;

  router.post("/notion", async (req, res) => {
    try {
      if (typeof req.body?.verification_token === "string") {
        console.log("Notion webhook verification token received. Save this token to WEBHOOK_SECRET.");
        res.json({ ok: true, action: "verification_token_received" });
        return;
      }

      // Handle Notion's verification challenge (initial webhook setup)
      if (req.body?.type === "url_verification") {
        console.log("Notion webhook verification challenge received");
        res.json({ challenge: req.body.challenge });
        return;
      }

      const rawBody = typeof (req as any).rawBody === "string"
        ? (req as any).rawBody
        : JSON.stringify(req.body ?? {});
      if (isWebhookSecretConfigured(config.webhook.secret)) {
        const signature = req.headers["x-notion-signature"];
        const trusted = isValidNotionWebhookSignature(rawBody, signature, config.webhook.secret);
        if (!trusted) {
          console.warn("Webhook signature mismatch — rejecting");
          res.status(401).json({ error: "Invalid webhook signature" });
          return;
        }
      } else if (!warnedMissingSecret) {
        console.warn(
          "WEBHOOK_SECRET is not configured. Accepting unsigned webhook events. Configure WEBHOOK_SECRET when endpoint is public.",
        );
        warnedMissingSecret = true;
      }

      const payload = req.body;
      const eventType = payload?.type;

      // Only process page property changes in the Profiles DB
      if (
        eventType !== "page.property_changed" &&
        eventType !== "page.changed" &&
        eventType !== "page.properties_updated"
      ) {
        res.json({ ok: true, action: "ignored" });
        return;
      }

      console.log(`Webhook received: type=${eventType}, entity=${payload?.entity?.type}`);

      const pageId = payload?.entity?.id || payload?.data?.page_id;
      if (!pageId) {
        res.json({ ok: true, action: "ignored", reason: "no page id" });
        return;
      }

      // Fetch the page and only act when current status is Queued.
      const { profileJson, pushStatus } = await notion.getProfilePushData(pageId);
      if (pushStatus !== "Queued") {
        res.json({ ok: true, action: "ignored", reason: "push status not queued" });
        return;
      }

      if (!profileJson) {
        console.log(`Webhook for page ${pageId}: no Profile JSON found, ignoring`);
        res.json({ ok: true, action: "ignored", reason: "no profile json" });
        return;
      }

      // Attempt to push profile
      await pushProfileToGaggiMate(gaggimate, notion, pageId, profileJson);

      res.json({ ok: true, action: "profile_pushed" });
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Webhook processing failed",
      });
    }
  });

  return router;
}
