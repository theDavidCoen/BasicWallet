/**
 * Share.share that suppresses AppLock re-lock while the OS share sheet is open.
 */

import { Share, type ShareContent, type ShareOptions } from "react-native";
import { beginOsShareSheet, endOsShareSheet } from "./osShareSheet";

export async function shareSafe(
  content: ShareContent,
  options?: ShareOptions,
): Promise<{ action: string; activityType?: string | null } | undefined> {
  beginOsShareSheet();
  try {
    return await Share.share(content, options);
  } finally {
    endOsShareSheet();
  }
}
