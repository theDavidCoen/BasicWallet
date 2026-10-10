/**
 * Subscribe to Home tour Modal visibility (sync latch in homeTour.ts).
 * Used by Home banners so they stay hidden while the tour is open.
 */

import { useEffect, useState } from "react";
import { isHomeTourUiOpen, subscribeHomeTourUi } from "./homeTour";

export function useHomeTourUiOpen(): boolean {
  const [open, setOpen] = useState(isHomeTourUiOpen);
  useEffect(() => subscribeHomeTourUi(() => setOpen(isHomeTourUiOpen())), []);
  return open;
}
