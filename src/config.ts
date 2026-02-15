import "dotenv/config";

export const config = {
  gaggimate: {
    host: process.env.GAGGIMATE_HOST || "localhost",
    protocol: (process.env.GAGGIMATE_PROTOCOL || "ws") as "ws" | "wss",
    requestTimeout: Number(process.env.REQUEST_TIMEOUT) || 5000,
  },
  notion: {
    apiKey: process.env.NOTION_API_KEY || "",
    beansDbId: process.env.NOTION_BEANS_DB_ID || "",
    brewsDbId: process.env.NOTION_BREWS_DB_ID || "",
    profilesDbId: process.env.NOTION_PROFILES_DB_ID || "",
  },
  webhook: {
    secret: process.env.WEBHOOK_SECRET || "",
  },
  sync: {
    intervalMs: Number(process.env.SYNC_INTERVAL_MS) || 30000,
    pollingFallback: process.env.POLLING_FALLBACK !== "false",
    profilePollIntervalMs: Number(process.env.PROFILE_POLL_INTERVAL_MS) || 3000,
  },
  http: {
    port: Number(process.env.HTTP_PORT) || 3000,
  },
  data: {
    dir: process.env.DATA_DIR || "./data",
  },
} as const;
