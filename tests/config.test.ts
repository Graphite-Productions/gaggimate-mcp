import { describe, it, expect } from "vitest";

describe("config", () => {
  it("exports a config object with expected shape", async () => {
    // Dynamically import to avoid side effects from dotenv in other tests
    const { config } = await import("../src/config.js");

    expect(config).toHaveProperty("gaggimate");
    expect(config).toHaveProperty("notion");
    expect(config).toHaveProperty("webhook");
    expect(config).toHaveProperty("sync");
    expect(config).toHaveProperty("http");
    expect(config).toHaveProperty("data");

    // Check defaults
    expect(config.gaggimate.protocol).toBe("ws");
    expect(config.gaggimate.requestTimeout).toBe(5000);
    expect(config.http.port).toBe(3000);
    expect(config.sync.intervalMs).toBe(30000);
    expect(config.sync.profilePollIntervalMs).toBe(3000);
    expect(config.sync.profileImportEnabled).toBe(true);
    expect(config.sync.profileImportIntervalMs).toBe(60000);
  });
});
