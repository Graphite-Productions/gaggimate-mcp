import { config } from "./config.js";
import { GaggiMateClient } from "./gaggimate/client.js";
import { createServer } from "./http/server.js";
import { ShotPoller } from "./sync/shotPoller.js";
import { ProfileReconciler } from "./sync/profileReconciler.js";
import { NotionClient } from "./notion/client.js";

async function main() {
  console.log("GaggiMate Notion Bridge starting...");
  console.log(`  GaggiMate: ${config.gaggimate.protocol}://${config.gaggimate.host}`);
  console.log(`  HTTP port: ${config.http.port}`);
  console.log(`  Shot sync interval: ${config.sync.intervalMs}ms`);
  console.log(`  Profile reconciler: ${config.sync.profileReconcileEnabled}`);
  if (config.sync.profileReconcileEnabled) {
    console.log(`  Profile reconcile interval: ${config.sync.profileReconcileIntervalMs}ms`);
    console.log(`  Profile delete enabled: ${config.sync.profileReconcileDeleteEnabled}`);
    console.log(`  Profile delete limit per reconcile: ${config.sync.profileReconcileDeleteLimitPerRun}`);
    console.log(`  Profile save limit per reconcile: ${config.sync.profileReconcileSaveLimitPerRun}`);
  }
  console.log(`  Brew title time zone: ${config.time.brewTitleTimeZone}`);

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
    recentShotLookbackCount: config.sync.recentShotLookbackCount,
    brewTitleTimeZone: config.time.brewTitleTimeZone,
  });
  shotPoller.start();

  // Start profile reconciler
  let profileReconciler: ProfileReconciler | null = null;
  if (config.sync.profileReconcileEnabled) {
    profileReconciler = new ProfileReconciler(gaggimate, notion, {
      intervalMs: config.sync.profileReconcileIntervalMs,
      deleteEnabled: config.sync.profileReconcileDeleteEnabled,
      maxDeletesPerRun: config.sync.profileReconcileDeleteLimitPerRun,
      maxSavesPerRun: config.sync.profileReconcileSaveLimitPerRun,
    });
    profileReconciler.start();
  }

  // Handle shutdown
  const shutdown = () => {
    console.log("Shutting down...");
    shotPoller.stop();
    if (profileReconciler) {
      profileReconciler.stop();
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
