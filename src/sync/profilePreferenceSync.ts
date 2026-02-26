import type { GaggiMateClient } from "../gaggimate/client.js";
import type { NotionClient } from "../notion/client.js";

export interface ProfilePreferenceState {
  favorite: boolean;
  selected: boolean;
}

export interface ProfilePreferenceSyncOptions {
  syncFavoriteToDevice?: boolean;
  syncSelectedToDevice?: boolean;
}

export async function syncFavoriteAndSelectedFromNotion(
  gaggimate: GaggiMateClient,
  notion: NotionClient,
  pageId: string,
  profileId: string,
  preferenceState?: ProfilePreferenceState,
  options?: ProfilePreferenceSyncOptions,
): Promise<void> {
  const { favorite, selected } = preferenceState ?? await notion.getProfilePreferenceState(pageId);
  // Both operations are independent — run in parallel to minimize device round-trips.
  const tasks: Promise<void>[] = [];
  if (options?.syncFavoriteToDevice !== false) {
    tasks.push(gaggimate.favoriteProfile(profileId, favorite));
  }
  if (options?.syncSelectedToDevice !== false && selected) {
    tasks.push(gaggimate.selectProfile(profileId));
  }
  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}
