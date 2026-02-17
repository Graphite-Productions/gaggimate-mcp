import type { GaggiMateClient } from "../gaggimate/client.js";
import type { NotionClient } from "../notion/client.js";

export async function syncFavoriteAndSelectedFromNotion(
  gaggimate: GaggiMateClient,
  notion: NotionClient,
  pageId: string,
  profileId: string,
): Promise<void> {
  const { favorite, selected } = await notion.getProfilePreferenceState(pageId);
  await gaggimate.favoriteProfile(profileId, favorite);
  if (selected) {
    await gaggimate.selectProfile(profileId);
  }
}
