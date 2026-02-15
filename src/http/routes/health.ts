import { Router } from "express";
import type { GaggiMateClient } from "../../gaggimate/client.js";
import type { NotionClient } from "../../notion/client.js";
import { SyncState } from "../../sync/state.js";
import { config } from "../../config.js";

const startTime = Date.now();

export function createHealthRouter(gaggimate: GaggiMateClient, notion: NotionClient): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const [gaggiReachable, notionConnected] = await Promise.all([
        gaggimate.isReachable(),
        notion.isConnected(),
      ]);

      const syncState = SyncState.load(config.data.dir);

      res.json({
        status: "ok",
        gaggimate: {
          host: gaggimate.host,
          reachable: gaggiReachable,
        },
        notion: {
          connected: notionConnected,
        },
        lastShotSync: syncState.lastSyncTime,
        lastShotId: syncState.lastSyncedShotId,
        totalShotsSynced: syncState.totalShotsSynced,
        uptime: Math.floor((Date.now() - startTime) / 1000),
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return router;
}
