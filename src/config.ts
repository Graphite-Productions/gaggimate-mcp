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
    profileImportEnabled: process.env.PROFILE_IMPORT_ENABLED !== "false",
    profileImportIntervalMs: Number(process.env.PROFILE_IMPORT_INTERVAL_MS) || 60000,
    recentShotLookbackCount: Number(process.env.RECENT_SHOT_LOOKBACK_COUNT) || 5,
  },
  time: {
    brewTitleTimeZone: process.env.BREW_TITLE_TIMEZONE || process.env.TZ || "UTC",
  },
  http: {
    port: Number(process.env.HTTP_PORT) || 3000,
  },
  data: {
    dir: process.env.DATA_DIR || "./data",
  },
} as const;
