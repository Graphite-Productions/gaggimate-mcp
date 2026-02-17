import express from "express";
import type { GaggiMateClient } from "../gaggimate/client.js";
import type { NotionClient } from "../notion/client.js";
import { createHealthRouter } from "./routes/health.js";
import { createWebhookRouter } from "./routes/webhook.js";

export function createServer(gaggimate: GaggiMateClient, notion: NotionClient): express.Express {
  const app = express();

  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }));

  app.use("/health", createHealthRouter(gaggimate, notion));
  app.use("/webhook", createWebhookRouter(gaggimate, notion));

  return app;
}
