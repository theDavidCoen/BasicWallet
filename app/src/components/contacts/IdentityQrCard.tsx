/**
 * Centered square QR card — Nostr Identity + Edit contact.
 * Reuses ExpandableQrCode; EmptyStateCard shell for kit consistency.
 */

import { StyleSheet, View } from "react-native";
import { ExpandableQrCode } from "../ExpandableQrCode";
import { EmptyStateCard } from "../ui";

type Props = {
  value: string;
  /** Inline QR module size (default 168). */
  size?: number;
};

export function IdentityQrCard({ value, size = 168 }: Props) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  return (
    <EmptyStateCard variant="muted" style={styles.card}>
      <View style={styles.inner}>
        <ExpandableQrCode value={trimmed} size={size} />
      </View>
    </EmptyStateCard>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 280,
    marginTop: 12,
    marginBottom: 4,
    padding: 20,
  },
  inner: {
    alignItems: "center",
    justifyContent: "center",
  },
});
