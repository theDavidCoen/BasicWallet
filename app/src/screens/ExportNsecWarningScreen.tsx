import { useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { ui } from "../theme/ui";

/** Penpot 05i — gate before revealing nsec. */
export function ExportNsecWarningScreen() {
  const navigation = useNavigation<RootNav>();

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={ui.title}>EXPORT NSEC</Text>
        <Text style={ui.caption}>
          Anyone with this secret can spend{"\n"}and decrypt your backup package.
        </Text>

        <View style={ui.cardMuted}>
          {[
            "Screenshots blocked on next screen",
            "Prefer offline / air-gapped copy",
            "Never paste into chat or email",
          ].map((line) => (
            <Text key={line} style={[ui.caption, { textAlign: "left", marginBottom: 10 }]}>
              · {line}
            </Text>
          ))}
        </View>

        <Pressable
          style={ui.primaryBtn}
          onPress={() => navigation.replace("ExportNsecReveal")}
        >
          <Text style={ui.primaryBtnText}>I understand · Show nsec</Text>
        </Pressable>
      </ScrollView>
    </ScreenChrome>
  );
}
