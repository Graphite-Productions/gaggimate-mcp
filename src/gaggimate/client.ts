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
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const requestId = generateRequestId();
      let timeoutHandle: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Request timeout: No response from GaggiMate at ${this.wsUrl}`));
        }
      }, this.config.requestTimeout);

      ws.on("open", () => {
        ws.send(JSON.stringify({ tp: "req:profiles:list", rid: requestId }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.tp === "res:profiles:list" && response.rid === requestId) {
            if (!resolved) {
              resolved = true;
              cleanup();
              if (response.error) {
                reject(new Error(`GaggiMate API error: ${response.error}`));
              } else {
                resolve(response.profiles || []);
              }
            }
          }
        } catch (error) {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Failed to parse response: ${error}`));
          }
        }
      });

      ws.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`WebSocket error: ${error.message}`));
        }
      });

      ws.on("close", () => {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(new Error("WebSocket closed unexpectedly"));
        }
      });
    });
  }

  /** Fetch a specific profile by ID via WebSocket */
  async fetchProfile(profileId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const requestId = generateRequestId();
      let timeoutHandle: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Request timeout: No response from GaggiMate at ${this.wsUrl}`));
        }
      }, this.config.requestTimeout);

      ws.on("open", () => {
        ws.send(JSON.stringify({ tp: "req:profiles:load", rid: requestId, id: profileId }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.tp === "res:profiles:load" && response.rid === requestId) {
            if (!resolved) {
              resolved = true;
              cleanup();
              if (response.error) {
                reject(new Error(`GaggiMate API error: ${response.error}`));
              } else {
                resolve(response.profile || null);
              }
            }
          }
        } catch (error) {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Failed to parse response: ${error}`));
          }
        }
      });

      ws.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`WebSocket error: ${error.message}`));
        }
      });

      ws.on("close", () => {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(new Error("WebSocket closed unexpectedly"));
        }
      });
    });
  }

  /** Save a full profile (for pushing arbitrary profiles from Notion) */
  async saveProfile(profile: ProfileData): Promise<any> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const requestId = generateRequestId();
      const normalizedProfile = normalizeProfileForGaggiMate(profile);
      let timeoutHandle: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Request timeout: No response from GaggiMate at ${this.wsUrl}`));
        }
      }, this.config.requestTimeout);

      ws.on("open", () => {
        ws.send(JSON.stringify({ tp: "req:profiles:save", rid: requestId, profile: normalizedProfile }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.tp === "res:profiles:save" && response.rid === requestId) {
            if (!resolved) {
              resolved = true;
              cleanup();
              if (response.error) {
                reject(new Error(`Failed to save profile: ${response.error}`));
              } else {
                resolve(response.profile || { success: true });
              }
            }
          }
        } catch (error) {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Failed to parse response: ${error}`));
          }
        }
      });

      ws.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`WebSocket error: ${error.message}`));
        }
      });

      ws.on("close", () => {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(new Error("WebSocket closed unexpectedly"));
        }
      });
    });
  }

  /** Delete a profile by ID via WebSocket */
  async deleteProfile(profileId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const requestId = generateRequestId();
      let timeoutHandle: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Request timeout: No response from GaggiMate at ${this.wsUrl}`));
        }
      }, this.config.requestTimeout);

      ws.on("open", () => {
        ws.send(JSON.stringify({ tp: "req:profiles:delete", rid: requestId, id: profileId }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.tp === "res:profiles:delete" && response.rid === requestId) {
            if (!resolved) {
              resolved = true;
              cleanup();
              if (response.error) {
                reject(new Error(`Failed to delete profile: ${response.error}`));
              } else {
                resolve();
              }
            }
          }
        } catch (error) {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Failed to parse response: ${error}`));
          }
        }
      });

      ws.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`WebSocket error: ${error.message}`));
        }
      });

      ws.on("close", () => {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(new Error("WebSocket closed unexpectedly"));
        }
      });
    });
  }

  /** Select a profile by ID via WebSocket */
  async selectProfile(profileId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const requestId = generateRequestId();
      let timeoutHandle: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Request timeout: No response from GaggiMate at ${this.wsUrl}`));
        }
      }, this.config.requestTimeout);

      ws.on("open", () => {
        ws.send(JSON.stringify({ tp: "req:profiles:select", rid: requestId, id: profileId }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.tp === "res:profiles:select" && response.rid === requestId) {
            if (!resolved) {
              resolved = true;
              cleanup();
              if (response.error) {
                reject(new Error(`Failed to select profile: ${response.error}`));
              } else {
                resolve();
              }
            }
          }
        } catch (error) {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Failed to parse response: ${error}`));
          }
        }
      });

      ws.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`WebSocket error: ${error.message}`));
        }
      });

      ws.on("close", () => {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(new Error("WebSocket closed unexpectedly"));
        }
      });
    });
  }

  /** Favorite or unfavorite a profile by ID via WebSocket */
  async favoriteProfile(profileId: string, favorite: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const requestId = generateRequestId();
      const reqType = favorite ? "req:profiles:favorite" : "req:profiles:unfavorite";
      const resType = favorite ? "res:profiles:favorite" : "res:profiles:unfavorite";
      let timeoutHandle: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Request timeout: No response from GaggiMate at ${this.wsUrl}`));
        }
      }, this.config.requestTimeout);

      ws.on("open", () => {
        ws.send(JSON.stringify({ tp: reqType, rid: requestId, id: profileId }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.tp === resType && response.rid === requestId) {
            if (!resolved) {
              resolved = true;
              cleanup();
              if (response.error) {
                reject(new Error(`Failed to ${favorite ? "favorite" : "unfavorite"} profile: ${response.error}`));
              } else {
                resolve();
              }
            }
          }
        } catch (error) {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Failed to parse response: ${error}`));
          }
        }
      });

      ws.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`WebSocket error: ${error.message}`));
        }
      });

      ws.on("close", () => {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(new Error("WebSocket closed unexpectedly"));
        }
      });
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
