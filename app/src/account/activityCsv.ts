/**
 * Export activity rows as CSV and open the OS share sheet (share / save).
 */

import { Share } from "react-native";
import type { ArkadeNetworkId } from "../config/network";
import { statusLabel, type ActivityRow } from "../wallet/activity";
import { getTxMeta } from "./txMeta";
import type { StoredActivity } from "./activityStore";

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoWhen(ms: number): string {
  if (!ms || ms <= 0) return "";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "";
  }
}

/** Build CSV text (UTF-8) for the given activity rows. */
export function buildActivityCsv(
  networkId: ArkadeNetworkId,
  rows: StoredActivity[] | ActivityRow[],
): string {
  const header = [
    "date_iso",
    "title",
    "amount_sats",
    "status",
    "subtitle",
    "tags",
    "fiat_amount",
    "fiat_code",
    "notes",
    "category",
    "sent_with",
    "activity_id",
    "wallet_id",
    "network",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    const walletId = "walletId" in row ? row.walletId : "";
    const meta = walletId ? getTxMeta(networkId, walletId, row.id) : null;
    const fiatAmount =
      "fiatAmount" in row && row.fiatAmount != null ? row.fiatAmount : null;
    const fiatCode =
      "fiatCode" in row && row.fiatCode ? row.fiatCode.toUpperCase() : "";
    lines.push(
      [
        csvEscape(isoWhen(row.createdAt)),
        csvEscape(meta?.name?.trim() || row.title),
        csvEscape(row.amount),
        csvEscape(statusLabel(row.status)),
        csvEscape(row.subtitle),
        csvEscape(row.tags.join("|")),
        csvEscape(fiatAmount != null ? fiatAmount.toFixed(2) : ""),
        csvEscape(fiatCode),
        csvEscape(meta?.notes ?? ""),
        csvEscape(meta?.category ?? ""),
        csvEscape(meta?.sentWith ?? ""),
        csvEscape(row.id),
        csvEscape(walletId),
        csvEscape(networkId),
      ].join(","),
    );
  }
  // UTF-8 BOM for Excel-friendly open on Windows.
  return `\uFEFF${lines.join("\n")}\n`;
}

export async function shareActivityCsv(opts: {
  networkId: ArkadeNetworkId;
  rows: StoredActivity[];
  walletLabel?: string;
}): Promise<void> {
  if (opts.rows.length === 0) {
    throw new Error("No activity to export");
  }
  const csv = buildActivityCsv(opts.networkId, opts.rows);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeLabel = (opts.walletLabel || "wallet")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 32);
  const filename = `basic-activity-${safeLabel}-${stamp}.csv`;

  await Share.share({
    message: csv,
    title: filename,
  });
}
