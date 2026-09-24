import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { CommonActions, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getStoredActivity,
  recordUnilateralExitActivity,
  resolveActivityRecipients,
  type StoredActivity,
} from "../account/activityStore";
import { findContactByIdentifierValue } from "../contacts/contactStore";
import {
  getTxMeta,
  recordSentFromThisDevice,
  resolveSentWithForActivity,
  applyPendingSendStamps,
  setTxMeta,
} from "../account/txMeta";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { getCachedExitJobs } from "../exit/jobRunner";
import { readRecoveryAddress } from "../exit/recoveryAddress";
import { useSheets } from "../navigation/SheetHost";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { readBackupMeta } from "../nostr/backupPackage";
import { useWallet } from "../wallet/WalletProvider";
import {
  explorerUrlForTxKind,
  formatSatsSigned,
  formatWhen,
  statusLabel,
  type SendRecipientSnapshot,
} from "../wallet/activity";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

function midEllipsis(s: string, left = 10, right = 8): string {
  if (!s || s.length <= left + right + 1) return s || "—";
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function isExitRow(row: StoredActivity | null): boolean {
  if (!row) return false;
  return row.tags.includes("exit") || row.id.startsWith("exit:");
}

/** Bitcoin / Ark txids are 32-byte hex — never confuse with bech32 recovery addresses. */
function looksLikeTxid(raw: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(raw.trim());
}

/** Reject bech32 / invoice-looking strings when falling back beyond strict hex. */
function looksLikeAddressNotTxid(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return (
    t.startsWith("ark") ||
    t.startsWith("bc1") ||
    t.startsWith("tb1") ||
    t.startsWith("bcrt") ||
    t.startsWith("lnbc") ||
    t.startsWith("lntb") ||
    t.includes("recipients")
  );
}

function pickTxid(...candidates: Array<string | undefined | null>): string {
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (looksLikeTxid(t)) return t;
  }
  // Non-hex fallback only for explicit tx fields that are clearly not addresses.
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (
      t &&
      t.length >= 16 &&
      !t.startsWith("pending:") &&
      !t.startsWith("local-") &&
      !t.startsWith("exit:") &&
      !t.startsWith("ln-") &&
      !looksLikeAddressNotTxid(t)
    ) {
      return t;
    }
  }
  return "";
}

function DetailRow({
  label,
  value,
  copyValue,
  onCopy,
  onChevron,
  chevronLabel = "Open in explorer",
  children,
}: {
  label: string;
  value?: string;
  /** Full string to copy (defaults to value). Empty / "—" → no copy. */
  copyValue?: string;
  onCopy?: (label: string, text: string) => void;
  /** Right › — e.g. open explorer for Txid. */
  onChevron?: () => void;
  chevronLabel?: string;
  children?: ReactNode;
}) {
  const display = value ?? "—";
  const toCopy = (copyValue ?? value ?? "").trim();
  const canCopy =
    Boolean(onCopy) &&
    !children &&
    toCopy.length > 0 &&
    toCopy !== "—";
  const showChevron = Boolean(onChevron);

  const valueBlock = children ?? (
    <Text style={styles.rowValue} numberOfLines={2}>
      {display}
    </Text>
  );

  const main = (
    <>
      <Text style={styles.rowLabel}>{label}</Text>
      {valueBlock}
    </>
  );

  return (
    <View style={styles.row}>
      {canCopy ? (
        <Pressable
          style={({ pressed }) => [
            styles.rowMain,
            pressed && styles.rowPressedInner,
          ]}
          onPress={() => onCopy?.(label, toCopy)}
          accessibilityRole="button"
          accessibilityHint={`Copy ${label}`}
        >
          {main}
        </Pressable>
      ) : (
        <View style={styles.rowMain}>{main}</View>
      )}
      {showChevron ? (
        <Pressable
          style={styles.chevronHit}
          hitSlop={12}
          onPress={onChevron}
          accessibilityRole="link"
          accessibilityLabel={chevronLabel}
        >
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Penpot 01h (Ark/on-chain) · 01i (Lightning). Notes last + Save; red/green amounts. */
export type ActivityDetailViewProps = {
  activityId: string;
  walletId?: string | null;
  /** stack = full screen; sheet = inside Activity bottom sheet */
  presentation?: "stack" | "sheet";
  onBack?: () => void;
};

export function ActivityDetailView({
  activityId,
  walletId: walletIdProp,
  presentation = "stack",
  onBack,
}: ActivityDetailViewProps) {
  const navigation = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();
  const { openSaveToContacts } = useSheets();
  const { selectedWallet, activityEpoch, bumpActivity } = useWallet();
  const network = getNetworkConfig();
  const walletId = walletIdProp ?? selectedWallet?.id ?? null;
  const [row, setRow] = useState<StoredActivity | null>(null);
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sentWith, setSentWith] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!walletId) {
      setError("No wallet");
      setRow(null);
      return;
    }
    const hit = getStoredActivity(network.id, walletId, activityId);
    setRow(hit);
    if (!hit) {
      setError("Activity not found");
      return;
    }
    applyPendingSendStamps(network.id, walletId, [hit]);
    const sentLabel = resolveSentWithForActivity(
      network.id,
      walletId,
      activityId,
      [
        ...hit.txs.map((t) => t.boardingTxid),
        ...hit.txs.map((t) => t.arkTxid),
        ...hit.txs.map((t) => t.commitmentTxid),
      ],
    );
    // Local unilateral exits are always from this device — stamp if missing.
    let resolved = sentLabel;
    if (
      !resolved &&
      (hit.tags.includes("exit") || hit.id.startsWith("exit:")) &&
      hit.amount < 0
    ) {
      recordSentFromThisDevice(network.id, walletId, activityId);
      resolved = resolveSentWithForActivity(
        network.id,
        walletId,
        activityId,
        [],
      );
    }
    const meta = getTxMeta(network.id, walletId, activityId);
    const n = meta?.notes ?? "";
    setNotes(n);
    setSavedNotes(n);
    setSentWith(resolved);
    setError(null);
  }, [walletId, network.id, activityId]);

  useEffect(() => {
    setLoading(true);
    load();
    setLoading(false);
  }, [load, activityEpoch]);

  // Backfill exit rows: keep package recoverable as amount; never replace it
  // with a lower onchain payment. Attach deliveredSats + real sweep txid —
  // scoped to THIS row's sweep tx (or a job whose recoverable matches), never
  // another package's 710 sats pasted onto a later completeUnroll row.
  useEffect(() => {
    if (!walletId || !row || !isExitRow(row)) return;
    let cancelled = false;
    void (async () => {
      const { sumDeliveredToAddress, sweepTxidsFromEvents, findRecoveryPaymentNearAmount } =
        await import("../exit/exitDelivery");
      const jobs = getCachedExitJobs().filter(
        (j) => j.networkId === network.id && j.walletId === walletId,
      );
      const recovery = await readRecoveryAddress(network.id);
      const subtitle = row.subtitle?.trim() ?? "";
      const subtitleLooksFull =
        subtitle.length >= 26 &&
        !subtitle.includes("…") &&
        !subtitle.includes("...");
      let sweepAddress =
        (subtitleLooksFull ? subtitle : "") || recovery || "";

      const rowAmount = Math.abs(row.amount);
      let sweepTxid = pickTxid(...row.txs.map((t) => t.boardingTxid));
      let feeSats = row.txs.find((t) => typeof t.feeSats === "number")?.feeSats;
      let expected = rowAmount;
      let delivered =
        row.txs.find((t) => typeof t.deliveredSats === "number")?.deliveredSats ??
        undefined;

      // Prefer a job that matches this row's recoverable (and txid when known).
      const matched =
        jobs.find(
          (j) =>
            sweepTxid &&
            sweepTxidsFromEvents(j.events).some(
              (id) => id.toLowerCase() === sweepTxid.toLowerCase(),
            ),
        ) ||
        jobs.find(
          (j) =>
            (j.status === "completed" || j.status === "failed") &&
            j.recoveredSats > 0 &&
            Math.abs(j.recoveredSats - rowAmount) <= 1,
        ) ||
        null;

      if (matched) {
        if (!sweepAddress) sweepAddress = matched.sweepAddress;
        if (feeSats == null && matched.fundingRequiredSats > 0) {
          feeSats = matched.fundingRequiredSats;
        }
        if (matched.recoveredSats > expected) {
          expected = matched.recoveredSats;
        }
        const txids = sweepTxidsFromEvents(matched.events);
        if (!sweepTxid && txids.length > 0) {
          sweepTxid = txids[txids.length - 1] ?? "";
        }
        if (txids.length > 0 && sweepAddress) {
          try {
            const paid = await sumDeliveredToAddress({
              esploraUrl: network.esploraUrl,
              sweepAddress,
              txids,
            });
            if (paid > 0) delivered = paid;
          } catch {
            /* keep */
          }
        }
      } else if (sweepAddress) {
        // Standalone / completeUnroll row: resolve THIS payment only.
        try {
          const hit = await findRecoveryPaymentNearAmount({
            esploraUrl: network.esploraUrl,
            sweepAddress,
            targetSats: rowAmount,
            preferTxid: sweepTxid || undefined,
          });
          if (hit) {
            sweepTxid = hit.txid;
            delivered = hit.paid;
          } else if (sweepTxid) {
            const paid = await sumDeliveredToAddress({
              esploraUrl: network.esploraUrl,
              sweepAddress,
              txids: [sweepTxid],
            });
            if (paid > 0) delivered = paid;
          }
        } catch {
          /* keep */
        }
      }

      // Amount stays at package recoverable (expected). Never shrink it to
      // a partial onchain payment.
      if (delivered != null && delivered > expected) {
        expected = delivered;
      }

      const storedBoarding = row.txs.map((t) => t.boardingTxid).find(Boolean) || "";
      const storedLooksLikeAddress =
        Boolean(storedBoarding) && !looksLikeTxid(storedBoarding);
      const storedDelivered = row.txs.find(
        (t) => typeof t.deliveredSats === "number",
      )?.deliveredSats;
      const needsPatch =
        Boolean(sweepAddress) &&
        (Math.abs(row.amount) !== expected ||
          storedLooksLikeAddress ||
          storedDelivered !== delivered ||
          !(sweepTxid && row.txs.some((t) => t.boardingTxid === sweepTxid)) ||
          (feeSats != null && !row.txs.some((t) => t.feeSats === feeSats)) ||
          row.subtitle !== sweepAddress);

      if (!needsPatch || cancelled || !sweepAddress) return;

      const pkgCreatedAt = row.id.startsWith("exit:")
        ? Number(row.id.slice(5)) || Math.floor(row.createdAt / 1000)
        : Math.floor(row.createdAt / 1000);
      recordUnilateralExitActivity(network.id, walletId, {
        packageCreatedAt: pkgCreatedAt,
        recoveredSats: expected,
        deliveredSats: delivered,
        fundingRequiredSats: feeSats,
        sweepAddress,
        sweepTxid: sweepTxid || undefined,
        completedAt: row.createdAt,
      });
      if (!cancelled) bumpActivity();
    })();
    return () => {
      cancelled = true;
    };
  }, [row, walletId, network.id, network.esploraUrl, bumpActivity]);

  const isLn = row?.kind === "lightning";
  const isExit = isExitRow(row);
  const isReceive = (row?.amount ?? 0) > 0;
  const isSend = (row?.amount ?? 0) < 0;

  const primaryIds = useMemo(() => {
    if (!row) {
      return {
        boarding: "",
        commitment: "",
        ark: "",
        any: "",
        preimage: "",
        feeSats: null as number | null,
        deliveredSats: null as number | null,
        explorerKind: "boarding" as "boarding" | "commitment" | "ark",
      };
    }
    const boarding = pickTxid(...row.txs.map((t) => t.boardingTxid));
    const commitment = pickTxid(...row.txs.map((t) => t.commitmentTxid));
    const ark = pickTxid(...row.txs.map((t) => t.arkTxid));
    // Prefer on-tx fields; fall back to activity id when it is the txid itself.
    const any = pickTxid(boarding, ark, commitment, row.id);
    const explorerKind: "boarding" | "commitment" | "ark" =
      any && any === ark
        ? "ark"
        : any && any === commitment
          ? "commitment"
          : any && looksLikeTxid(any) && !boarding && (ark || row.tags.includes("offchain"))
            ? "ark"
            : "boarding";
    const preimage = row.txs.map((t) => t.preimage).find(Boolean) || "";
    const feeHit = row.txs.find((t) => typeof t.feeSats === "number");
    const feeSats =
      feeHit && typeof feeHit.feeSats === "number" ? feeHit.feeSats : null;
    const deliveredHit = row.txs.find((t) => typeof t.deliveredSats === "number");
    const deliveredSats =
      deliveredHit && typeof deliveredHit.deliveredSats === "number"
        ? deliveredHit.deliveredSats
        : null;
    return {
      boarding,
      commitment,
      ark,
      any,
      preimage,
      feeSats,
      deliveredSats,
      explorerKind,
    };
  }, [row]);

  const badgeLabel = useMemo(() => {
    if (!row) return "";
    const dir = isReceive ? "Received" : isSend ? "Sent" : statusLabel(row.status);
    if (isLn) return `${dir} · Lightning`;
    if (row.tags.includes("boarding") || row.tags.includes("batch")) {
      return `${dir} · on-chain`;
    }
    if (isExit) return `${dir} · unilateral exit`;
    if (row.tags.includes("offchain") || primaryIds.ark) return `${dir} · Ark`;
    return `${dir} · on-chain`;
  }, [row, isLn, isReceive, isSend, primaryIds.ark, isExit]);

  const typeLabel = useMemo(() => {
    if (!row) return "—";
    if (isLn) return "Lightning payment";
    if (row.tags.includes("boarding") || row.tags.includes("batch")) return "On-chain deposit";
    if (isExit) return "Unilateral exit";
    if (row.tags.includes("offchain") || primaryIds.ark) return "Ark payment";
    return "On-chain payment";
  }, [row, isLn, primaryIds.ark, isExit]);

  const dirty = notes.trim() !== savedNotes.trim();

  async function onSave() {
    if (!walletId || !row) return;
    Keyboard.dismiss();
    setSaving(true);
    setSaveHint(null);
    try {
      const next = notes.trim() || null;
      // Local write only on this tick — Nostr re-pack is debounced (avoids UI freeze).
      setTxMeta(network.id, walletId, row.id, { notes: next });
      setSavedNotes(notes.trim());
      const backup = await readBackupMeta();
      setSaveHint(
        backup?.enabled && backup.channel === "nostr"
          ? "Saved"
          : "Saved on this device",
      );
    } catch (e) {
      setSaveHint(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function copyText(label: string, value: string) {
    const text = value.trim();
    if (!text || text === "—") {
      setSaveHint(`No ${label} for this transaction`);
      return;
    }
    await Clipboard.setStringAsync(text);
    setSaveHint(`Copied ${label}`);
  }

  const walletLabel = selectedWallet?.label
    ? isLn
      ? `${selectedWallet.label} · Lightning`
      : selectedWallet.label
    : "";
  const toRecipients: SendRecipientSnapshot[] = useMemo(() => {
    if (!row || !walletId) return [];
    const list = resolveActivityRecipients(network.id, walletId, row);
    if (isSend) return list;
    // Inbound: only show when this device recorded a multi-send for the same txid.
    return list.length > 1 ? list : [];
  }, [row, walletId, network.id, isSend]);
  const singleToAddress =
    toRecipients.length === 1
      ? toRecipients[0]!.address
      : "";
  const toDisplay =
    toRecipients.length > 1
      ? ""
      : singleToAddress
        ? midEllipsis(singleToAddress, 10, 8)
        : "—";
  const toCopy =
    toRecipients.length > 1
      ? toRecipients.map((r) => r.address).join("\n")
      : singleToAddress;
  /** Single outbound destination not already in contacts → › opens Save to contacts. */
  const toSaveContactAddress =
    isSend &&
    toRecipients.length === 1 &&
    singleToAddress &&
    !findContactByIdentifierValue(singleToAddress)
      ? singleToAddress
      : null;
  const feeDisplay =
    primaryIds.feeSats != null
      ? `${primaryIds.feeSats.toLocaleString("en-US")} sats`
      : "—";
  const feeCopy =
    primaryIds.feeSats != null ? String(primaryIds.feeSats) : "";
  const dateDisplay = row ? formatWhen(row.createdAt) : "—";
  const amountCopy = row ? String(Math.abs(row.amount)) : "";
  const fiatCopy =
    row?.fiatAmount != null && row.fiatCode
      ? `${row.fiatAmount.toFixed(2)} ${row.fiatCode.toUpperCase()}`
      : "";

  async function openExplorer() {
    if (!row) return;
    const txid = primaryIds.any;
    if (!txid) {
      setSaveHint("No explorer link for this transaction");
      return;
    }
    // Exit / boarding / commitment → mempool.space (or mutinynet.com).
    // Ark offchain → vmempool (arkade.space / explorer.mutinynet.arkade.sh).
    const kind = isExit ? "boarding" : primaryIds.explorerKind;
    const url = explorerUrlForTxKind(network.id, txid, kind);
    if (!url) {
      setSaveHint("No explorer link for this transaction");
      return;
    }
    await Linking.openURL(url);
  }

  // Only when Basic recorded a send on this (or backed-up) device — never invent for LNbits sync.
  const sentWithDisplay = isSend && sentWith ? sentWith : null;

  const main = loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.fg} />
        </View>
      ) : !row ? (
        <Text style={styles.error}>{error ?? "Missing"}</Text>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            presentation === "sheet"
              ? { paddingBottom: Math.max(insets.bottom, 16) + 56 }
              : null,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>TRANSACTION</Text>
          <Pressable
            onPress={() => void copyText("Amount", amountCopy)}
            accessibilityRole="button"
            accessibilityHint="Copy amount"
          >
            <Text
              style={[
                styles.amount,
                isReceive ? styles.pos : isSend ? styles.neg : null,
              ]}
            >
              {formatSatsSigned(row.amount)}
            </Text>
          </Pressable>
          {fiatCopy ? (
            <Pressable
              onPress={() => void copyText("Fiat", fiatCopy)}
              accessibilityRole="button"
            >
              <Text style={styles.fiat}>≈ {fiatCopy}</Text>
            </Pressable>
          ) : (
            <Text style={styles.fiat}> </Text>
          )}
          {isExit ? (
            <Text style={styles.exitHint}>Recoverable (exit package)</Text>
          ) : null}
          <Pressable
            style={styles.badge}
            onPress={() => void copyText("Status", badgeLabel)}
            accessibilityRole="button"
          >
            <Text style={styles.badgeText}>{badgeLabel}</Text>
          </Pressable>

          <DetailRow
            label="Type"
            value={typeLabel}
            onCopy={(l, t) => void copyText(l, t)}
          />
          <DetailRow
            label="Wallet"
            value={walletLabel || "—"}
            copyValue={walletLabel}
            onCopy={(l, t) => void copyText(l, t)}
          />
          {toRecipients.length > 1 ? (
            toRecipients.map((r, i) => (
              <DetailRow
                key={`to-${i}-${r.address}`}
                label={i === 0 ? "To" : `To (${i + 1})`}
                value={`${midEllipsis(r.address, 10, 8)}${
                  r.amount > 0 ? ` · ${r.amount.toLocaleString("en-US")} sats` : ""
                }`}
                copyValue={r.address}
                onCopy={(l, t) => void copyText(l, t)}
              />
            ))
          ) : (
            <DetailRow
              label="To"
              value={toDisplay || "—"}
              copyValue={toCopy}
              onCopy={(l, t) => void copyText(l, t)}
              onChevron={
                toSaveContactAddress
                  ? () => openSaveToContacts(toSaveContactAddress)
                  : undefined
              }
              chevronLabel="Save to contacts"
            />
          )}
          {isExit ? (
            <DetailRow
              label="On-chain delivered"
              value={
                primaryIds.deliveredSats != null
                  ? `${primaryIds.deliveredSats.toLocaleString("en-US")} sats`
                  : "—"
              }
              copyValue={
                primaryIds.deliveredSats != null
                  ? String(primaryIds.deliveredSats)
                  : ""
              }
              onCopy={(l, t) => void copyText(l, t)}
            />
          ) : null}
          {isExit &&
          primaryIds.deliveredSats != null &&
          Math.abs(row.amount) - primaryIds.deliveredSats >
            Math.max(1_000, Math.floor(Math.abs(row.amount) * 0.02)) ? (
            <Text style={styles.underDeliverWarn}>
              Package recoverable is higher than what reached the recovery
              address so far. Open Unilateral Exit again if funds are still
              exiting.
            </Text>
          ) : null}
          {isLn ? (
            <DetailRow
              label="Routing fee"
              value={feeDisplay}
              copyValue={feeCopy}
              onCopy={(l, t) => void copyText(l, t)}
            />
          ) : isExit ? (
            <DetailRow
              label="Exit fees"
              value={feeDisplay}
              copyValue={feeCopy}
              onCopy={(l, t) => void copyText(l, t)}
            />
          ) : (
            <DetailRow
              label="Network fee"
              value={feeDisplay}
              copyValue={feeCopy}
              onCopy={(l, t) => void copyText(l, t)}
            />
          )}
          <DetailRow
            label="Date"
            value={dateDisplay}
            copyValue={dateDisplay}
            onCopy={(l, t) => void copyText(l, t)}
          />

          {isLn ? (
            <>
              <DetailRow
                label="Payment hash"
                value={midEllipsis(primaryIds.any, 10, 8)}
                copyValue={primaryIds.any}
                onCopy={(l, t) => void copyText(l, t)}
              />
              <DetailRow
                label="Preimage"
                value={
                  primaryIds.preimage ? midEllipsis(primaryIds.preimage, 10, 8) : "—"
                }
                copyValue={primaryIds.preimage}
                onCopy={(l, t) => void copyText(l, t)}
              />
            </>
          ) : (
            <DetailRow
              label="Txid"
              value={
                primaryIds.any
                  ? midEllipsis(primaryIds.any, 10, 8)
                  : row.id.startsWith("pending:") || row.id.startsWith("local-send:")
                    ? "Pending…"
                    : "—"
              }
              copyValue={primaryIds.any}
              onCopy={(l, t) => void copyText(l, t)}
              onChevron={
                primaryIds.any ? () => void openExplorer() : undefined
              }
              chevronLabel="Open transaction in explorer"
            />
          )}

          <DetailRow label="Notes">
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add a note…"
              placeholderTextColor={colors.hint}
              multiline
            />
          </DetailRow>

          <Pressable
            style={[ui.primaryBtn, (!dirty || saving) && { opacity: 0.5 }]}
            disabled={!dirty || saving}
            onPress={() => void onSave()}
          >
            {saving ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={ui.primaryBtnText}>Save</Text>
            )}
          </Pressable>
          {saveHint ? <Text style={styles.saveHint}>{saveHint}</Text> : null}

          {isLn ? (
            <View style={styles.actions}>
              <Pressable
                style={styles.actionBtn}
                onPress={() => void copyText("Payment hash", primaryIds.any)}
              >
                <Text style={styles.actionText}>Copy hash</Text>
              </Pressable>
              <Pressable
                style={styles.actionBtn}
                onPress={() => void copyText("Preimage", primaryIds.preimage)}
                disabled={!primaryIds.preimage}
              >
                <Text
                  style={[
                    styles.actionText,
                    !primaryIds.preimage && { opacity: 0.4 },
                  ]}
                >
                  Copy preimage
                </Text>
              </Pressable>
            </View>
          ) : null}
          {sentWithDisplay ? (
            <Text style={styles.sentWithFooter}>Sent with {sentWithDisplay}</Text>
          ) : null}
        </ScrollView>
      );

  if (presentation === "sheet") {
    return (
      <View style={styles.sheetRoot}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          style={styles.sheetBack}
          accessibilityRole="button"
          accessibilityLabel="Back to activity list"
        >
          <Text style={styles.sheetBackText}>‹ Activity</Text>
        </Pressable>
        {main}
      </View>
    );
  }

  return (
    <ScreenChrome
      logoScale={0.77}
      onLogoPress={() => {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: "Home" }],
          }),
        );
      }}
    >
      {main}
    </ScreenChrome>
  );
}

export function ActivityDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "ActivityDetail">>();
  const { selectedWallet } = useWallet();
  return (
    <ActivityDetailView
      presentation="stack"
      activityId={route.params.activityId}
      walletId={route.params.walletId ?? selectedWallet?.id}
    />
  );
}

const styles = StyleSheet.create({
  sheetRoot: { flex: 1 },
  sheetBack: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingRight: 12,
    marginBottom: 4,
  },
  sheetBackText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
    textAlign: "center",
    marginTop: 4,
  },
  saveHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    marginTop: 10,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: "#E07070",
    textAlign: "center",
  },
  scroll: { paddingBottom: 40 },
  sentWithFooter: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginTop: 28,
    marginBottom: 8,
  },
  amount: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 24,
    color: colors.fg,
    textAlign: "center",
    marginTop: 12,
  },
  pos: { color: "#8FDF8F" },
  neg: { color: "#E09090" },
  fiat: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    marginTop: 6,
    minHeight: 18,
  },
  exitHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    textAlign: "center",
    marginTop: 4,
  },
  underDeliverWarn: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: "#E09090",
    marginTop: 10,
    lineHeight: 16,
  },
  badge: {
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#1A1A1A",
  },
  badgeText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
  },
  row: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#333333",
    borderRadius: 10,
    backgroundColor: colors.bg,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  rowMain: {
    flex: 1,
    paddingVertical: 8,
    paddingRight: 8,
  },
  rowPressedInner: {
    opacity: 0.85,
  },
  rowPressed: {
    borderColor: colors.fg,
    opacity: 0.92,
  },
  rowLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: "#8C8C8C",
    marginBottom: 4,
  },
  rowValue: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
    color: colors.fg,
  },
  chevronHit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  chevron: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 28,
    color: colors.fg,
    lineHeight: 32,
  },
  notesInput: {
    marginTop: 2,
    minHeight: 56,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    textAlignVertical: "top",
    padding: 0,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  actionText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
});
