import { describe, expect, it } from "vitest";
import { isConnectivityError, summarizeConnectivityError } from "../../src/utils/connectivity.js";

describe("connectivity helpers", () => {
  it("detects fetch failures with network error causes", () => {
    const error: any = new TypeError("fetch failed");
    error.cause = { code: "EHOSTUNREACH", message: "connect EHOSTUNREACH 192.168.1.100:80" };

    expect(isConnectivityError(error)).toBe(true);
    expect(summarizeConnectivityError(error)).toBe("EHOSTUNREACH");
  });

  it("detects timeout-style connectivity failures", () => {
    const error = new Error("Request timeout: No response from host");
    expect(isConnectivityError(error)).toBe(true);
    expect(summarizeConnectivityError(error)).toBe("timeout");
  });

  it("does not classify unrelated exceptions as connectivity errors", () => {
    const error = new Error("Unexpected JSON parse failure");
    expect(isConnectivityError(error)).toBe(false);
  });
});
