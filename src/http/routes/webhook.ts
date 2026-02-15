import { Router } from "express";
import type { GaggiMateClient } from "../../gaggimate/client.js";
import type { NotionClient } from "../../notion/client.js";
import { config } from "../../config.js";
import { pushProfileToGaggiMate } from "../../sync/profilePush.js";

export function createWebhookRouter(gaggimate: GaggiMateClient, notion: NotionClient): Router {
  const router = Router();

  router.post("/notion", async (req, res) => {
    try {
      // Handle Notion's verification challenge (initial webhook setup)
      if (req.body?.type === "url_verification") {
        console.log("Notion webhook verification challenge received");
        res.json({ challenge: req.body.challenge });
        return;
      }

      // Verify webhook secret if configured
      if (config.webhook.secret) {
        const signature = req.headers["x-notion-signature"];
        if (!signature || signature !== config.webhook.secret) {
          console.warn("Webhook signature mismatch — rejecting");
          res.status(401).json({ error: "Invalid webhook signature" });
          return;
        }
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
