import { Router } from "express";
import type { GaggiMateClient } from "../../gaggimate/client.js";
import type { NotionClient } from "../../notion/client.js";

interface DeviceProfileView {
  id: string | null;
  label: string;
  favorite: boolean;
  selected: boolean;
  type: string | null;
  utility: boolean;
  source: "device" | "notion";
}

function toDeviceProfileView(profile: any): DeviceProfileView {
  return {
    id: typeof profile?.id === "string" && profile.id.trim() ? profile.id : null,
    label: typeof profile?.label === "string" ? profile.label : "",
    favorite: Boolean(profile?.favorite),
    selected: Boolean(profile?.selected),
    type: typeof profile?.type === "string" ? profile.type : null,
    utility: Boolean(profile?.utility),
    source: "device",
  };
}

function parseNotionProfileJsonLabel(profileJson: string): string | null {
  if (!profileJson?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(profileJson);
    if (typeof parsed?.label === "string" && parsed.label.trim()) {
      return parsed.label.trim();
    }
  } catch {
    // no-op
  }
  return null;
}

async function listNotionSelectableProfiles(notion: NotionClient): Promise<DeviceProfileView[]> {
  const notionIndex = await notion.listExistingProfiles();
  const byId = new Map<string, DeviceProfileView>();

  for (const record of notionIndex.all) {
    if (!record.profileId || !record.profileId.trim()) {
      continue;
    }
    if (record.pushStatus === "Archived") {
      continue;
    }
    if (byId.has(record.profileId)) {
      continue;
    }

    byId.set(record.profileId, {
      id: record.profileId,
      label: parseNotionProfileJsonLabel(record.profileJson) || record.normalizedName || record.profileId,
      favorite: record.favorite,
      selected: record.selected,
      type: null,
      utility: false,
      source: "notion",
    });
  }

  return Array.from(byId.values());
}

function mergeDeviceAndNotionProfiles(
  deviceProfiles: DeviceProfileView[],
  notionProfiles: DeviceProfileView[],
): DeviceProfileView[] {
  const merged = [...deviceProfiles];
  const knownIds = new Set(
    deviceProfiles
      .map((profile) => profile.id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
  );

  for (const notionProfile of notionProfiles) {
    if (!notionProfile.id || knownIds.has(notionProfile.id)) {
      continue;
    }
    merged.push(notionProfile);
  }

  return merged;
}

/**
 * Device control API — allows switching profiles and managing settings through the bridge
 * when the GaggiMate web portal is not directly accessible (e.g. remote via Tailscale).
 */
export function createDeviceRouter(gaggimate: GaggiMateClient, notion: NotionClient): Router {
  const router = Router();
  const DEVICE_PROFILES_CACHE_TTL_MS = 1500;
  const NOTION_FALLBACK_CACHE_TTL_MS = 15_000;
  let cachedDeviceProfiles: { expiresAt: number; profiles: DeviceProfileView[] } | null = null;
  let cachedNotionProfiles: { expiresAt: number; profiles: DeviceProfileView[] } | null = null;
  let inFlightDeviceProfiles: Promise<DeviceProfileView[]> | null = null;
  let inFlightNotionProfiles: Promise<DeviceProfileView[]> | null = null;

  const invalidateDeviceProfileCache = () => {
    cachedDeviceProfiles = null;
  };

  const loadDeviceProfiles = async (): Promise<DeviceProfileView[]> => {
    const now = Date.now();
    if (cachedDeviceProfiles && cachedDeviceProfiles.expiresAt > now) {
      return cachedDeviceProfiles.profiles;
    }
    if (inFlightDeviceProfiles) {
      return inFlightDeviceProfiles;
    }

    inFlightDeviceProfiles = gaggimate.fetchProfiles()
      .then((profiles) => {
        const mappedProfiles = (profiles || []).map((profile: any) => toDeviceProfileView(profile));
        cachedDeviceProfiles = {
          expiresAt: Date.now() + DEVICE_PROFILES_CACHE_TTL_MS,
          profiles: mappedProfiles,
        };
        return mappedProfiles;
      })
      .finally(() => {
        inFlightDeviceProfiles = null;
      });

    return inFlightDeviceProfiles;
  };

  const loadNotionFallbackProfiles = async (): Promise<DeviceProfileView[]> => {
    const now = Date.now();
    if (cachedNotionProfiles && cachedNotionProfiles.expiresAt > now) {
      return cachedNotionProfiles.profiles;
    }
    if (inFlightNotionProfiles) {
      return inFlightNotionProfiles;
    }

    inFlightNotionProfiles = listNotionSelectableProfiles(notion)
      .then((profiles) => {
        cachedNotionProfiles = {
          expiresAt: Date.now() + NOTION_FALLBACK_CACHE_TTL_MS,
          profiles,
        };
        return profiles;
      })
      .finally(() => {
        inFlightNotionProfiles = null;
      });

    return inFlightNotionProfiles;
  };

  /** List all profiles on the device */
  router.get("/profiles", async (_req, res) => {
    const notionFallbackPromise = loadNotionFallbackProfiles().catch((error) => {
      console.warn("Device route: failed to load Notion profile fallback:", error);
      return [] as DeviceProfileView[];
    });

    try {
      const deviceProfiles = await loadDeviceProfiles();
      const notionFallbackProfiles = await notionFallbackPromise;
      const mergedProfiles = mergeDeviceAndNotionProfiles(deviceProfiles, notionFallbackProfiles);

      res.json({
        profiles: mergedProfiles,
        source: notionFallbackProfiles.length > 0 ? "device+notion" : "device",
      });
    } catch (error) {
      const notionFallbackProfiles = await notionFallbackPromise;
      if (notionFallbackProfiles.length > 0) {
        res.json({
          profiles: notionFallbackProfiles,
          source: "notion-fallback",
          warning: "Device unreachable; showing Notion-managed profile IDs",
        });
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(502).json({
        error: "Device unreachable",
        detail: message,
      });
    }
  });

  /** Select a profile by ID (makes it the active profile on the machine) */
  router.post("/profiles/:id/select", async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Profile ID required" });
      return;
    }
    try {
      await gaggimate.selectProfile(id);
      invalidateDeviceProfileCache();
      res.json({ ok: true, selected: id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(502).json({
        error: "Select failed",
        detail: message,
      });
    }
  });

  /** Set favorite state for a profile */
  router.post("/profiles/:id/favorite", async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Profile ID required" });
      return;
    }
    const favorite = req.body?.favorite !== false;
    try {
      await gaggimate.favoriteProfile(id, favorite);
      invalidateDeviceProfileCache();
      res.json({ ok: true, favorite });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(502).json({
        error: "Favorite update failed",
        detail: message,
      });
    }
  });

  /** Unfavorite a profile (convenience for favorite=false) */
  router.post("/profiles/:id/unfavorite", async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Profile ID required" });
      return;
    }
    try {
      await gaggimate.favoriteProfile(id, false);
      invalidateDeviceProfileCache();
      res.json({ ok: true, favorite: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(502).json({
        error: "Unfavorite failed",
        detail: message,
      });
    }
  });

  return router;
}
