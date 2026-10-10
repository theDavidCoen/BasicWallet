import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { ScrollView, Text } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, EmptyStateCard, ScreenTitle } from "../components/ui";

/** Gate before revealing nsec. */
export function ExportNsecWarningScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ExportNsecWarning">>();
  const afterEnable = route.params?.afterEnable;

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <ScreenTitle>EXPORT NSEC</ScreenTitle>
        <Caption>
          {"Anyone with this secret can spend\n" +
            "and decrypt your backup package.\n\n" +
            "If you enable Nostr or home server backup,\n" +
            "save this nsec offline with your passphrase —\n" +
            "you need both to restore on a new device."}
        </Caption>

        <EmptyStateCard variant="muted">
          {[
            "Screenshots blocked on next screen",
            "Prefer offline / air-gapped copy",
            "Never paste into chat or email",
            ...(afterEnable
              ? ["Also keep your backup passphrase somewhere safe"]
              : []),
          ].map((line) => (
            <Caption
              key={line}
              align="left"
              style={{ textAlign: "left", marginBottom: 10 }}
            >
              {`· ${line}`}
            </Caption>
          ))}
        </EmptyStateCard>

        <Button
          onPress={() =>
            navigation.replace("ExportNsecReveal", {
              afterEnable,
            })
          }
        >
          I understand · Show nsec
        </Button>
      </ScrollView>
    </ScreenChrome>
  );
}
