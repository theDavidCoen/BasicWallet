/**
 * Settings → Exit hub: job progress cards + CTA into wizard (not inline steps).
 */

import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import {
  completeUnrolledExitSweep,
  summarizeLocalVtxos,
  summarizeUnrolledVtxos,
  syncRecoveryExitActivities,
} from "../exit/runExit";
import { hasExitPackage, readExitPackageMeta } from "../exit/packageStore";
import type { ExitPackageMeta } from "../exit/packageStore";
import { readRecoveryAddress } from "../exit/recoveryAddress";
import { requireExitAuth } from "../exit/gates";
import { continueExitForWallet } from "../exit/jobRunner";
import { useExitJobs } from "../exit/ExitJobsProvider";
import {
  csvLockSummaryFromEvents,
  dedupeExitEventsForDisplay,
  exitJobCaption,
  formatExitEventLine,
} from "../exit/exitProgressCopy";
import type { ExitJobRecord } from "../exit/jobStore";
import { getOpenWallet } from "../wallet/hdWallet";
import { useWallet } from "../wallet/WalletProvider";
import { AdaptiveText, useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

function JobCard({
  job,
  networkId,
  tipHeight,
  onStop,
  onResume,
}: {
  job: ExitJobRecord;
  networkId: ReturnType<typeof getNetworkConfig>["id"];
  tipHeight: number | null;
  onStop: () => void;
  onResume: () => void;
}) {
  const { t } = useI18n();
  const statusLabel =
    job.status === "running"
      ? t("exit.statusRunning")
      : job.status === "stopped"
        ? t("exit.statusPaused")
        : job.status === "failed"
          ? t("exit.statusFailed")
          : job.status === "completed"
            ? t("exit.statusDone")
            : job.status;
  const csv =
    job.status === "running" || job.status === "stopped"
      ? csvLockSummaryFromEvents(
          job.events,
          {
            networkId,
            tipHeight,
          },
          t,
        )
      : null;
  const progress = dedupeExitEventsForDisplay(job.events, 12);
  return (
    <View style={ui.cardMuted}>
      <Text style={styles.cardLabel}>
        {t("exit.jobExitStatus", {
          status: statusLabel,
          sats: job.recoveredSats.toLocaleString("en-US"),
        })}
      </Text>
      <Text style={styles.cardBody}>
        {t("exit.sweepTo", { addr: job.sweepAddress.slice(0, 18) })}
      </Text>
      {csv ? (
        <View style={styles.csvBox}>
          <Text style={styles.csvHeadline}>{csv.headline}</Text>
          <Text style={styles.csvDetail}>{csv.detail}</Text>
        </View>
      ) : null}
      {job.lastError ? (
        <Text style={styles.err}>{job.lastError}</Text>
      ) : null}
      {progress.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.progressLabel}>{t("exit.progress")}</Text>
          {progress.map((ev, i) => (
            <Text
              key={`${ev.stepIndex}-${i}-${ev.status}-${ev.txid ?? ""}`}
              style={styles.event}
            >
              {formatExitEventLine(ev, t)}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={[styles.cardBody, { marginTop: 8 }]}>
          {job.status === "running" ? t("exit.starting") : t("exit.noEventsYet")}
        </Text>
      )}
      {job.status === "running" ? (
        <Pressable style={ui.secondaryBtn} onPress={onStop}>
          <AdaptiveText style={ui.secondaryBtnText} baseFontSize={15}>
            {t("exit.stopResumeLater")}
          </AdaptiveText>
        </Pressable>
      ) : null}
      {job.status === "stopped" ? (
        <Pressable style={ui.primaryBtn} onPress={onResume}>
          <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>
            {t("exit.resume")}
          </AdaptiveText>
        </Pressable>
      ) : null}
      {job.status === "failed" ? (
        <Pressable style={ui.primaryBtn} onPress={onResume}>
          <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>
            {t("exit.retryExit")}
          </AdaptiveText>
        </Pressable>
      ) : null}
    </View>
  );
}

function PendingSweepCard({
  sats,
  count,
  recovery,
  sweeping,
  onSweep,
}: {
  sats: number;
  count: number;
  recovery: string | null;
  sweeping: boolean;
  onSweep: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={ui.cardMuted}>
      <Text style={styles.cardLabel}>
        {t("exit.remainingOnchain", { sats: sats.toLocaleString("en-US") })}
      </Text>
      <Text style={styles.cardBody}>
        {t("exit.pendingSweepBody", {
          sats: sats.toLocaleString("en-US"),
          count,
          plural: count === 1 ? "" : "s",
        })}
      </Text>
      {recovery ? (
        <Text style={[styles.cardBody, { color: colors.caption }]}>
          {t("exit.sweepTo", { addr: recovery.slice(0, 18) })}
        </Text>
      ) : (
        <Text style={[styles.cardBody, { color: colors.caption }]}>
          {t("exit.setRecoveryFirst")}
        </Text>
      )}
      <Pressable
        style={[ui.primaryBtn, sweeping && { opacity: 0.6 }]}
        disabled={sweeping}
        onPress={onSweep}
      >
        {sweeping ? (
          <ActivityIndicator color="#000" />
        ) : (
          <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>
            {t("exit.exitRemainingFunds")}
          </AdaptiveText>
        )}
      </Pressable>
    </View>
  );
}

export function UnilateralExitHubScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const network = getNetworkConfig();
  const { selectedWallet, wallet, bumpActivity } = useWallet();
  const {
    hubJobs,
    activeJobs,
    stopJob,
    resumeJob,
    refresh,
    pendingSweep,
    setPendingSweep,
    refreshPendingSweep,
  } = useExitJobs();
  const [busy, setBusy] = useState(true);
  const [continuing, setContinuing] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [vtxoLine, setVtxoLine] = useState("…");
  const [pkgMeta, setPkgMeta] = useState<ExitPackageMeta | null>(null);
  const [hasPkg, setHasPkg] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [tipHeight, setTipHeight] = useState<number | null>(null);
  const [, setTick] = useState(0);
  /** After a successful leftover sweep, skip idle→step1 redirect. */
  const skipIdleRedirectRef = useRef(false);

  const isArkade = selectedWallet?.kind === "arkade";
  const hasActive = activeJobs.length > 0;
  const unrolledSats = pendingSweep.sats;
  const unrolledCount = pendingSweep.count;
  const hasPendingSweep = unrolledSats > 0 && unrolledCount > 0;
  const needsCsvTip = hubJobs.some((j) =>
    j.events.some((e) => e.status === "waiting_csv" && e.maturesAtHeight != null),
  );
  const needsCsvClock = hubJobs.some((j) =>
    j.events.some((e) => e.status === "waiting_csv"),
  );

  // Idle (no open jobs, no draft, no pending onchain sweep) → wizard step 1.
  useFocusEffect(
    useCallback(() => {
      if (busy) return;
      if (skipIdleRedirectRef.current) return;
      if (activeJobs.length > 0 || hubJobs.length > 0 || hasPkg || hasPendingSweep) {
        return;
      }
      navigation.replace("ExitRecoveryAddress", { from: "exit" });
    }, [
      busy,
      activeJobs.length,
      hubJobs.length,
      hasPkg,
      hasPendingSweep,
      navigation,
    ]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        setBusy(true);
        try {
          const rec = await readRecoveryAddress(network.id);
          if (!cancelled) setRecovery(rec);
          if (!selectedWallet || selectedWallet.kind !== "arkade") {
            if (!cancelled) {
              setVtxoLine(t("exit.selectArkadeWallet"));
              setHasPkg(false);
              setPkgMeta(null);
              setPendingSweep({ sats: 0, count: 0 });
            }
            return;
          }
          const w = wallet ?? getOpenWallet();
          if (w) {
            const sum = await summarizeLocalVtxos(w);
            const unrolled = await refreshPendingSweep();
            if (rec) {
              const added = await syncRecoveryExitActivities({
                networkId: network.id,
                walletId: selectedWallet.id,
                sweepAddress: rec,
              });
              if (added > 0) bumpActivity();
            }
            if (!cancelled) {
              setVtxoLine(
                sum.count === 0
                  ? t("exit.noLocalVtxos")
                  : t("exit.vtxoLine", {
                      count: sum.count,
                      sats: sum.totalSats.toLocaleString("en-US"),
                    }),
              );
              void unrolled;
            }
          } else if (!cancelled) {
            setVtxoLine(t("exit.openWalletVtxos"));
            setPendingSweep({ sats: 0, count: 0 });
          }
          const pkg = await hasExitPackage(network.id, selectedWallet.id);
          const meta = await readExitPackageMeta(network.id, selectedWallet.id);
          if (!cancelled) {
            setHasPkg(pkg);
            setPkgMeta(meta);
          }
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [
      selectedWallet,
      wallet,
      network.id,
      refreshPendingSweep,
      setPendingSweep,
      bumpActivity,
    ]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!needsCsvClock) return;
      const clock = setInterval(() => setTick((n) => n + 1), 15_000);
      return () => clearInterval(clock);
    }, [needsCsvClock]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!needsCsvTip) return;
      let cancelled = false;
      const pull = async () => {
        try {
          const res = await fetch(`${network.esploraUrl}/blocks/tip/height`);
          if (!res.ok) return;
          const h = Number(await res.text());
          if (!cancelled && Number.isFinite(h)) setTipHeight(h);
        } catch {
          /* tip optional */
        }
      };
      void pull();
      const tipPoll = setInterval(() => void pull(), 30_000);
      return () => {
        cancelled = true;
        clearInterval(tipPoll);
      };
    }, [needsCsvTip, network.esploraUrl]),
  );

  function continueDraftExit() {
    if (!selectedWallet || selectedWallet.kind !== "arkade") return;
    void (async () => {
      const auth = await requireExitAuth(t("exit.confirmContinueExit"));
      if (!auth.ok) {
        Alert.alert(t("exit.cancelled"), auth.reason);
        return;
      }
      setContinuing(true);
      try {
        await continueExitForWallet({
          networkId: network.id,
          walletId: selectedWallet.id,
        });
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : t("common.unknownError");
        if (msg.startsWith("PACKAGE_DONE:")) {
          Alert.alert(
            t("exit.packageFinishedTitle"),
            hasPendingSweep
              ? t("exit.packageFinishedPartial", {
                  sats: unrolledSats.toLocaleString("en-US"),
                })
              : t("exit.packageFinishedFull"),
          );
        } else {
          Alert.alert(t("exit.couldNotContinueExit"), msg);
        }
      } finally {
        setContinuing(false);
      }
    })();
  }

  function exitRemainingFunds() {
    if (!recovery) {
      navigation.navigate("ExitRecoveryAddress", { from: "exit" });
      return;
    }
    if (!selectedWallet || selectedWallet.kind !== "arkade") return;

    void (async () => {
      const auth = await requireExitAuth(t("exit.confirmSweepRemaining"));
      if (!auth.ok) {
        Alert.alert(t("exit.cancelled"), auth.reason);
        return;
      }
      setSweeping(true);
      try {
        const w = wallet ?? getOpenWallet();
        const unrolled = w
          ? await summarizeUnrolledVtxos(w)
          : { count: 0, totalSats: 0 };
        if (unrolled.count > 0) {
          const result = await completeUnrolledExitSweep({
            networkId: network.id,
            walletId: selectedWallet.id,
            sweepAddress: recovery,
          });
          skipIdleRedirectRef.current = true;
          setPendingSweep({ sats: 0, count: 0 });
          bumpActivity();
          Alert.alert(
            t("exit.sweepBroadcastTitle"),
            t("exit.sweepBroadcastBody", {
              sats: result.deliveredSats.toLocaleString("en-US"),
              count: result.vtxoCount,
              plural: result.vtxoCount === 1 ? "" : "s",
              txid: result.txid.slice(0, 18),
            }),
            [
              {
                text: t("exit.ok"),
                onPress: () => {
                  navigation.navigate("Home");
                },
              },
            ],
          );
          await refresh();
          return;
        }
        navigation.navigate("UnilateralExitPrepare");
      } catch (e) {
        const msg = e instanceof Error ? e.message : t("common.unknownError");
        if (msg.startsWith("NO_UNROLLED:")) {
          navigation.navigate("UnilateralExitPrepare");
          return;
        }
        Alert.alert(t("exit.couldNotSweep"), msg);
      } finally {
        setSweeping(false);
      }
    })();
  }

  function startWizard() {
    if (!recovery) {
      navigation.navigate("ExitRecoveryAddress", { from: "exit" });
      return;
    }
    navigation.navigate("UnilateralExitPrepare");
  }

  const caption = hasPendingSweep
    ? t("exit.captionPendingSweep")
    : !hasActive && hasPkg
      ? t("exit.captionPreparedPackage")
      : exitJobCaption(hubJobs, t);

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={ui.title}>{t("exit.title")}</Text>
        <Text style={ui.caption}>{caption}</Text>

        {hasPendingSweep ? (
          <View style={{ marginTop: 8 }}>
            <PendingSweepCard
              sats={unrolledSats}
              count={unrolledCount}
              recovery={recovery}
              sweeping={sweeping}
              onSweep={exitRemainingFunds}
            />
          </View>
        ) : null}

        {hubJobs.length > 0 ? (
          <View style={{ marginTop: 8, gap: 12 }}>
            {hubJobs.map((job) => (
              <JobCard
                key={job.jobId}
                job={job}
                networkId={network.id}
                tipHeight={tipHeight}
                onStop={() => void stopJob(job.jobId)}
                onResume={() => void resumeJob(job.jobId)}
              />
            ))}
          </View>
        ) : null}

        <View style={[ui.cardMuted, { marginTop: 16 }]}>
          <Text style={styles.cardLabel}>{t("exit.localReadiness", { network: network.label })}</Text>
          {busy ? (
            <ActivityIndicator color={colors.fg} style={{ marginTop: 8 }} />
          ) : (
            <>
              <Text style={styles.cardBody}>{vtxoLine}</Text>
              <Text style={styles.cardBody}>
                {recovery
                  ? t("exit.recoveryShort", { addr: recovery.slice(0, 14) })
                  : t("exit.noRecoveryYet")}
              </Text>
              <Text style={styles.cardBody}>
                {hasPkg && pkgMeta
                  ? t("exit.draftPackageReady", {
                      auto: pkgMeta.source === "auto" ? t("exit.draftAuto") : "",
                      sats: pkgMeta.recoveredSats.toLocaleString("en-US"),
                    })
                  : t("exit.noDraftPackage")}
              </Text>
            </>
          )}
        </View>

        {!isArkade ? (
          <Text style={[ui.hint, { marginTop: 20 }]}>
            {t("exit.switchArkadeHint")}
          </Text>
        ) : (
          <>
            {!hasActive && hasPkg ? (
              <Pressable
                style={[ui.primaryBtn, continuing && { opacity: 0.6 }]}
                disabled={continuing}
                onPress={continueDraftExit}
              >
                {continuing ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>{t("exit.continueExit")}</AdaptiveText>
                )}
              </Pressable>
            ) : null}

            <Pressable
              style={
                hasActive || (!hasPkg && !hasPendingSweep)
                  ? ui.primaryBtn
                  : ui.secondaryBtn
              }
              onPress={startWizard}
            >
              <AdaptiveText
                style={
                  hasActive || (!hasPkg && !hasPendingSweep)
                    ? ui.primaryBtnText
                    : ui.secondaryBtnText
                }
                baseFontSize={15}
              >
                {hasActive
                  ? t("exit.startAnother")
                  : t("exit.prepareNewPackage")}
              </AdaptiveText>
            </Pressable>

            <Pressable
              style={ui.secondaryBtn}
              onPress={() => navigation.navigate("Home")}
            >
              <AdaptiveText style={ui.secondaryBtnText} baseFontSize={15}>{t("exit.home")}</AdaptiveText>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 48 },
  cardLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 8,
  },
  cardBody: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    lineHeight: 20,
    marginTop: 4,
  },
  csvBox: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  csvHeadline: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
    color: colors.fg,
    lineHeight: 20,
  },
  csvDetail: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    lineHeight: 18,
    marginTop: 4,
  },
  progressLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginBottom: 4,
  },
  event: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    lineHeight: 16,
    marginTop: 4,
  },
  err: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: "#E07070",
    marginTop: 8,
    lineHeight: 18,
  },
});
