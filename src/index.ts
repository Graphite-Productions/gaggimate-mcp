import { config } from "./config.js";
import { GaggiMateClient } from "./gaggimate/client.js";
import { createServer } from "./http/server.js";
import { ShotPoller } from "./sync/shotPoller.js";
import { ProfilePoller } from "./sync/profilePoller.js";
import { ProfileImportPoller } from "./sync/profileImportPoller.js";
import { NotionClient } from "./notion/client.js";

async function main() {
  console.log("GaggiMate Notion Bridge starting...");
  console.log(`  GaggiMate: ${config.gaggimate.protocol}://${config.gaggimate.host}`);
  console.log(`  HTTP port: ${config.http.port}`);
  console.log(`  Sync interval: ${config.sync.intervalMs}ms`);
  console.log(`  Polling fallback: ${config.sync.pollingFallback}`);
  console.log(`  Profile import: ${config.sync.profileImportEnabled}`);

  // Initialize clients
  const gaggimate = new GaggiMateClient(config.gaggimate);
  const notion = new NotionClient(config.notion);

  // Start HTTP server
  const app = createServer(gaggimate, notion);
  app.listen(config.http.port, () => {
    console.log(`HTTP server listening on port ${config.http.port}`);
  });

  // Start shot poller
  const shotPoller = new ShotPoller(gaggimate, notion, {
    intervalMs: config.sync.intervalMs,
    dataDir: config.data.dir,
  });
  shotPoller.start();

  // Start profile polling fallback
  let profilePoller: ProfilePoller | null = null;
  if (config.sync.pollingFallback) {
    profilePoller = new ProfilePoller(gaggimate, notion, {
      intervalMs: config.sync.profilePollIntervalMs,
    });
    profilePoller.start();
  }

  let profileImportPoller: ProfileImportPoller | null = null;
  if (config.sync.profileImportEnabled) {
    profileImportPoller = new ProfileImportPoller(gaggimate, notion, {
      intervalMs: config.sync.profileImportIntervalMs,
    });
    profileImportPoller.start();
  }

  // Handle shutdown
  const shutdown = () => {
    console.log("Shutting down...");
    shotPoller.stop();
    if (profilePoller) {
      profilePoller.stop();
    }
    if (profileImportPoller) {
      profileImportPoller.stop();
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
