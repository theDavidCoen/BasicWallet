// MUST polyfill crypto before any @arkade-os/sdk import (Arkade Expo docs).
import * as Crypto from "expo-crypto";

const g = globalThis as typeof globalThis & {
  crypto?: { getRandomValues?: (arr: ArrayBufferView) => ArrayBufferView };
};
if (!g.crypto) {
  g.crypto = {} as NonNullable<typeof g.crypto>;
}
g.crypto!.getRandomValues = ((arr: ArrayBufferView) => {
  return Crypto.getRandomValues(arr as Parameters<typeof Crypto.getRandomValues>[0]);
}) as typeof g.crypto.getRandomValues;

import "react-native-gesture-handler";
import "react-native-reanimated";
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
