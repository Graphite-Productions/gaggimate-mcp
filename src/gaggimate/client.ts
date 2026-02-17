import WebSocket from "ws";
import { parseBinaryIndex, indexToShotList } from "../parsers/binaryIndex.js";
import type { ShotListItem } from "../parsers/binaryIndex.js";
import { parseBinaryShot } from "../parsers/binaryShot.js";
import type { ShotData } from "../parsers/binaryShot.js";
import type { GaggiMateConfig, ProfileData } from "./types.js";
import { normalizeProfileForGaggiMate } from "./profileNormalization.js";

function generateRequestId(): string {
  return `bridge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    return name.includes("timeout") || name.includes("abort") || message.includes("timeout") || message.includes("aborted");
  }
  return false;
}

interface WsRequestOptions {
  /** Message type to send (e.g. "req:profiles:list") */
  reqType: string;
  /** Expected response type (e.g. "res:profiles:list") */
  resType: string;
  /** Additional fields to include in the outgoing message */
  payload?: Record<string, any>;
  /** Extract the result value from the response object */
  extractResult: (response: any) => any;
  /** Error prefix for readable error messages */
  errorPrefix: string;
}

export class GaggiMateClient {
  private config: GaggiMateConfig;

  constructor(config: GaggiMateConfig) {
    this.config = config;
  }

  get host(): string {
    return this.config.host;
  }

  private get wsUrl(): string {
    return `${this.config.protocol}://${this.config.host}/ws`;
  }

  private get httpProtocol(): string {
    return this.config.protocol === "wss" ? "https" : "http";
  }

  /**
   * Send a single request/response over a fresh WebSocket connection.
   * Handles connection lifecycle, timeouts, and error reporting.
   */
  private sendWsRequest<T>(options: WsRequestOptions): Promise<T> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const requestId = generateRequestId();
      let timeoutHandle: NodeJS.Timeout | null = null;
      let settled = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          cleanup();
          fn();
        }
      };

      timeoutHandle = setTimeout(() => {
        settle(() => reject(new Error(`Request timeout: No response from GaggiMate at ${this.wsUrl}`)));
      }, this.config.requestTimeout);

      ws.on("open", () => {
        ws.send(JSON.stringify({ tp: options.reqType, rid: requestId, ...options.payload }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.tp === options.resType && response.rid === requestId) {
            settle(() => {
              if (response.error) {
                reject(new Error(`${options.errorPrefix}: ${response.error}`));
              } else {
                resolve(options.extractResult(response));
              }
            });
          }
        } catch (error) {
          settle(() => reject(new Error(`Failed to parse response: ${error}`)));
        }
      });

      ws.on("error", (error) => {
        settle(() => reject(new Error(`WebSocket error: ${error.message}`)));
      });

      ws.on("close", () => {
        settle(() => reject(new Error("WebSocket closed unexpectedly")));
      });
    });
  }

  /** Check if GaggiMate is reachable via HTTP */
  async isReachable(): Promise<boolean> {
    try {
      const url = `${this.httpProtocol}://${this.config.host}/api/history/index.bin`;
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(3000),
      });
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  }

  /** Fetch all profiles from GaggiMate via WebSocket */
  async fetchProfiles(): Promise<any[]> {
    return this.sendWsRequest({
      reqType: "req:profiles:list",
      resType: "res:profiles:list",
      extractResult: (res) => res.profiles || [],
      errorPrefix: "GaggiMate API error",
    });
  }

  /** Fetch a specific profile by ID via WebSocket */
  async fetchProfile(profileId: string): Promise<any> {
    return this.sendWsRequest({
      reqType: "req:profiles:load",
      resType: "res:profiles:load",
      payload: { id: profileId },
      extractResult: (res) => res.profile || null,
      errorPrefix: "GaggiMate API error",
    });
  }

  /** Save a full profile to the device. Normalizes phase defaults before sending. */
  async saveProfile(profile: ProfileData): Promise<any> {
    const normalizedProfile = normalizeProfileForGaggiMate(profile);
    return this.sendWsRequest({
      reqType: "req:profiles:save",
      resType: "res:profiles:save",
      payload: { profile: normalizedProfile },
      extractResult: (res) => res.profile || { success: true },
      errorPrefix: "Failed to save profile",
    });
  }

  /** Delete a profile by ID via WebSocket */
  async deleteProfile(profileId: string): Promise<void> {
    return this.sendWsRequest({
      reqType: "req:profiles:delete",
      resType: "res:profiles:delete",
      payload: { id: profileId },
      extractResult: () => undefined,
      errorPrefix: "Failed to delete profile",
    });
  }

  /** Select a profile by ID via WebSocket */
  async selectProfile(profileId: string): Promise<void> {
    return this.sendWsRequest({
      reqType: "req:profiles:select",
      resType: "res:profiles:select",
      payload: { id: profileId },
      extractResult: () => undefined,
      errorPrefix: "Failed to select profile",
    });
  }

  /** Favorite or unfavorite a profile by ID via WebSocket */
  async favoriteProfile(profileId: string, favorite: boolean): Promise<void> {
    const action = favorite ? "favorite" : "unfavorite";
    return this.sendWsRequest({
      reqType: `req:profiles:${action}`,
      resType: `res:profiles:${action}`,
      payload: { id: profileId },
      extractResult: () => undefined,
      errorPrefix: `Failed to ${action} profile`,
    });
  }

  /** Fetch shot history index from GaggiMate HTTP API */
  async fetchShotHistory(limit?: number, offset?: number): Promise<ShotListItem[]> {
    try {
      const url = `${this.httpProtocol}://${this.config.host}/api/history/index.bin`;
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/octet-stream" },
        signal: AbortSignal.timeout(this.config.requestTimeout),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const indexData = parseBinaryIndex(buffer);
      let shotList = indexToShotList(indexData);

      if (offset !== undefined && offset > 0) {
        shotList = shotList.slice(offset);
      }
      if (limit !== undefined && limit > 0) {
        shotList = shotList.slice(0, limit);
      }

      return shotList;
    } catch (error: any) {
      if (isTimeoutError(error)) {
        throw new Error(`Request timeout: No response from GaggiMate at ${this.config.host}`);
      }
      throw error;
    }
  }

  /** Fetch a specific shot by ID from GaggiMate HTTP API */
  async fetchShot(shotId: string): Promise<ShotData | null> {
    try {
      const paddedId = shotId.padStart(6, "0");
      const url = `${this.httpProtocol}://${this.config.host}/api/history/${paddedId}.slog`;
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/octet-stream" },
        signal: AbortSignal.timeout(this.config.requestTimeout),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return parseBinaryShot(buffer, shotId);
    } catch (error: any) {
      if (isTimeoutError(error)) {
        throw new Error(`Request timeout: No response from GaggiMate at ${this.config.host}`);
      }
      throw error;
    }
  }
}
