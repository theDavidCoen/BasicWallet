import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { Button } from "../components/ui";
import { colors } from "../theme/colors";

function midEllipsis(s: string, left = 12, right = 8): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

export function FundsSentScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "FundsSent">>();
  const { amount, txid, address, rail } = route.params;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>FUNDS SENT</Text>
      <Text style={styles.amount}>−{amount.toLocaleString("en-US")} sats</Text>
      <Text style={styles.caption}>
        {rail === "lightning" ? "Lightning payment sent." : "Arkade payment submitted."}
      </Text>
      {address ? (
        <Text style={styles.meta}>to {midEllipsis(address, 14, 8)}</Text>
      ) : null}
      {txid ? (
        <Text style={styles.meta}>
          {rail === "lightning" ? "hash" : "tx"} {midEllipsis(txid, 12, 8)}
        </Text>
      ) : null}

      <Button
        style={{ marginTop: 36, alignSelf: "stretch" }}
        onPress={() => navigation.replace("Activity")}
      >
        View activity
      </Button>
      <Pressable
        style={styles.secondary}
        onPress={() => navigation.navigate("Home")}
      >
        <Text style={styles.secondaryText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
  },
  amount: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 28,
    color: "#E09090",
    textAlign: "center",
    marginTop: 16,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 14,
  },
  meta: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginTop: 8,
  },
  secondary: {
    alignSelf: "stretch",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  secondaryText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 15,
    color: colors.fg,
  },
});
