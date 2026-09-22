import { useEffect, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { getMnemonicSource } from "../wallet/mnemonicMeta";
import { RestoreWalletContent } from "./RestoreWalletContent";

/** Full-screen restore (Settings / onboarding). Add-wallet import uses the sheet. */
export function RestoreWalletScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "RestoreWallet">>();
  const mode = route.params?.mode ?? "full";
  const [passkeyInstall, setPasskeyInstall] = useState(false);

  useEffect(() => {
    void getMnemonicSource().then((s) => setPasskeyInstall(s === "passkey-prf"));
  }, []);

  return (
    <ScreenChrome logoScale={0.77}>
      <RestoreWalletContent
        mode={mode}
        passkeyInstall={passkeyInstall}
        onDone={(dest) => {
          if (dest === "Ready") {
            navigation.reset({ index: 0, routes: [{ name: "Ready" }] });
          } else {
            navigation.navigate("Home");
          }
        }}
        onCreateInstead={() => navigation.navigate("OnboardingCreate")}
        onNostrIdentityOnly={() => navigation.navigate("NostrIdentity")}
      />
    </ScreenChrome>
  );
}
