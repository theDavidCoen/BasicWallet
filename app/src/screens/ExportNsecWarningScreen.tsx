import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { ui } from "../theme/ui";

/** Penpot 05i — gate before revealing nsec. */
export function ExportNsecWarningScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ExportNsecWarning">>();
  const afterEnable = route.params?.afterEnable;

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={ui.title}>EXPORT NSEC</Text>
        <Text style={ui.caption}>
          Anyone with this secret can spend{"\n"}
          and decrypt your backup package.
          {"\n\n"}
          If you enable Nostr or home server backup,{"\n"}
          save this nsec offline with your passphrase —{"\n"}
          you need both to restore on a new device.
        </Text>

        <View style={ui.cardMuted}>
          {[
            "Screenshots blocked on next screen",
            "Prefer offline / air-gapped copy",
            "Never paste into chat or email",
            ...(afterEnable
              ? ["Also keep your backup passphrase somewhere safe"]
              : []),
          ].map((line) => (
            <Text key={line} style={[ui.caption, { textAlign: "left", marginBottom: 10 }]}>
              · {line}
            </Text>
          ))}
        </View>

        <Pressable
          style={ui.primaryBtn}
          onPress={() =>
            navigation.replace("ExportNsecReveal", {
              afterEnable,
            })
          }
        >
          <Text style={ui.primaryBtnText}>I understand · Show nsec</Text>
        </Pressable>
      </ScrollView>
    </ScreenChrome>
  );
}
