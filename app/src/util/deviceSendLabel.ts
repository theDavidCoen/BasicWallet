/**
 * Human label for “Sent with …” on tx details (sends only).
 * Prefer brand + marketing model; fall back to model code / OS family.
 */

import { Platform } from "react-native";
import * as Device from "expo-device";

function titleCaseBrand(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (s.toLowerCase() === "iphone") return "iPhone";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function combineBrandModel(brand: string, model: string): string {
  const b = brand.trim();
  const m = model.trim();
  if (b && m) {
    const modelBare = m.toLowerCase().startsWith(b.toLowerCase()) ? m.slice(b.length).trim() : m;
    return modelBare ? `${b} ${modelBare}` : b;
  }
  return m || b;
}

/**
 * e.g. "Samsung SM-S942B", "iPhone 17 Pro", "iPhone".
 * iOS marketing names come from expo-device (native); needs a build that links it.
 */
export function deviceSendLabel(): string {
  const modelName = Device.modelName?.trim() || "";

  if (Platform.OS === "ios") {
    // expo-device maps machine id → "iPhone 17 Pro", etc.
    if (modelName) return modelName;
    const id = typeof Device.modelId === "string" ? Device.modelId.trim() : "";
    if (id) return id; // e.g. iPhone17,1 until map updates
    return "iPhone";
  }

  if (Platform.OS === "android") {
    const c = Platform.constants as { Brand?: string; Model?: string; Manufacturer?: string };
    const brand = titleCaseBrand(Device.brand || c.Brand || c.Manufacturer || "");
    const model = modelName || (c.Model || "").trim();
    const combined = combineBrandModel(brand, model);
    if (combined) return combined;
    return "Android";
  }

  return modelName || Platform.OS;
}

export function sentWithFooter(): string {
  return `Sent with ${deviceSendLabel()}`;
}
