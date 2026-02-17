import type { GaggiMateClient } from "../gaggimate/client.js";
import type { NotionClient } from "../notion/client.js";

export interface ProfilePreferenceState {
  favorite: boolean;
  selected: boolean;
}

export async function syncFavoriteAndSelectedFromNotion(
  gaggimate: GaggiMateClient,
  notion: NotionClient,
  pageId: string,
  profileId: string,
  preferenceState?: ProfilePreferenceState,
): Promise<void> {
  const { favorite, selected } = preferenceState ?? await notion.getProfilePreferenceState(pageId);
  // Both operations are independent — run in parallel to minimize device round-trips.
  const tasks: Promise<void>[] = [gaggimate.favoriteProfile(profileId, favorite)];
  if (selected) {
    tasks.push(gaggimate.selectProfile(profileId));
  }
  await Promise.all(tasks);
}
