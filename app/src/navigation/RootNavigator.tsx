import {
  NavigationContainer,
  DarkTheme,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useWallet } from "../wallet/WalletProvider";
import type { RootStackParamList } from "./types";
import { OnboardingCreateScreen } from "../screens/OnboardingCreateScreen";
import { TermsOfUseScreen } from "../screens/TermsOfUseScreen";
import { PasskeyProgressScreen } from "../screens/PasskeyProgressScreen";
import { ReadyScreen } from "../screens/ReadyScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { RemoveWalletScreen } from "../screens/RemoveWalletScreen";
import { RemoveLightningWalletScreen } from "../screens/RemoveLightningWalletScreen";
import { AddWalletScreen } from "../screens/AddWalletScreen";
import { ReceiveScreen } from "../screens/ReceiveScreen";
import { SendScreen } from "../screens/SendScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { PairBluetoothScreen } from "../screens/PairBluetoothScreen";
import { ArkadeSettingsScreen } from "../screens/ArkadeSettingsScreen";
import { ArkadeNetworkScreen } from "../screens/ArkadeNetworkScreen";
import { LanguageScreen } from "../screens/LanguageScreen";
import { DisplayCurrenciesScreen } from "../screens/DisplayCurrenciesScreen";
import { FiatModeSettingsScreen } from "../screens/FiatModeSettingsScreen";
import { BitcoinMaxiSettingsScreen } from "../screens/BitcoinMaxiSettingsScreen";
import { DelegatesScreen } from "../screens/DelegatesScreen";
import { ConnectNodeScreen } from "../screens/ConnectNodeScreen";
import { ConnectedNodeScreen } from "../screens/ConnectedNodeScreen";
import { ConnectBtcPayScreen } from "../screens/ConnectBtcPayScreen";
import { ConnectLndHubScreen } from "../screens/ConnectLndHubScreen";
import { NodeStatusScreen } from "../screens/NodeStatusScreen";
import { ExportRecoveryPhraseScreen } from "../screens/ExportRecoveryPhraseScreen";
import { AdvancedBackupScreen } from "../screens/AdvancedBackupScreen";
import { NostrBackupScreen } from "../screens/NostrBackupScreen";
import { HomeServerBackupScreen } from "../screens/HomeServerBackupScreen";
import { BackupRecapScreen } from "../screens/BackupRecapScreen";
import { BackupEnabledSuccessScreen } from "../screens/BackupEnabledSuccessScreen";
import { RestoreWalletScreen } from "../screens/RestoreWalletScreen";
import { NostrIdentityScreen } from "../screens/NostrIdentityScreen";
import { ArchivedWalletsScreen } from "../screens/ArchivedWalletsScreen";
import { ContactsListScreen } from "../screens/ContactsListScreen";
import { ContactEditScreen } from "../screens/ContactEditScreen";
import { ContactShareOfferScreen } from "../screens/ContactShareOfferScreen";
import { PayHubScreen } from "../screens/PayHubScreen";
import { ChatThreadScreen } from "../screens/ChatThreadScreen";
import { ChatAmountScreen } from "../screens/ChatAmountScreen";
import { ExportNsecWarningScreen } from "../screens/ExportNsecWarningScreen";
import { ExportNsecRevealScreen } from "../screens/ExportNsecRevealScreen";
import { GenerateIdentityWarningScreen } from "../screens/GenerateIdentityWarningScreen";
import { ImportNsecWarningScreen } from "../screens/ImportNsecWarningScreen";
import { ResetAppScreen } from "../screens/ResetAppScreen";
import { LogsScreen } from "../screens/LogsScreen";
import { PrivacyScreen } from "../screens/PrivacyScreen";
import { NotificationsSettingsScreen } from "../screens/NotificationsSettingsScreen";
import { CursorAgentSettingsScreen } from "../screens/CursorAgentSettingsScreen";
import { SetAppPinScreen } from "../screens/SetAppPinScreen";
import { bindPushNotificationListeners } from "../notifications";
import { OnboardingSecurityScreen } from "../screens/OnboardingSecurityScreen";
import { ActivityDetailScreen } from "../screens/ActivityDetailScreen";
import { UnilateralExitHubScreen } from "../screens/UnilateralExitHubScreen";
import { UnilateralExitPrepareScreen } from "../screens/UnilateralExitPrepareScreen";
import { UnilateralExitFundScreen } from "../screens/UnilateralExitFundScreen";
import { UnilateralExitExecuteScreen } from "../screens/UnilateralExitExecuteScreen";
import { CollaborativeOffboardScreen } from "../screens/CollaborativeOffboardScreen";
import { ExitRecoveryAddressScreen } from "../screens/ExitRecoveryAddressScreen";
import { AboutScreen } from "../screens/AboutScreen";
import { WalletWarmupScreen } from "../screens/WalletWarmupScreen";
import { BackupReminderBanner } from "./BackupReminderBanner";
import { ChatUnreadBanner } from "./ChatUnreadBanner";
import { ContactShareReminder } from "./ContactShareReminder";
import { RecoveryAddressReminder } from "./RecoveryAddressReminder";
import { SheetHost } from "./SheetHost";
import { AppLockGate } from "../security/AppLockGate";
import { UserPresenceHost } from "../security/UserPresenceHost";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { colors } from "../theme/colors";

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.fg,
    border: colors.border,
    primary: colors.fg,
  },
};

export function RootNavigator() {
  const { ready, hasWallet, sessionPhase } = useWallet();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  useEffect(() => {
    if (!ready || !hasWallet) return;
    return bindPushNotificationListeners(navigationRef);
  }, [ready, hasWallet, navigationRef]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.fg} />
      </View>
    );
  }

  // One AppLockGate for the whole session — remounting around warmup caused a
  // second biometric prompt when switching to Home.
  return (
    <AppLockGate>
      <UserPresenceHost />
      {hasWallet && sessionPhase === "warming" ? (
        <WalletWarmupScreen />
      ) : (
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <SheetHost>
            <BackupReminderBanner navigationRef={navigationRef} />
            <ChatUnreadBanner navigationRef={navigationRef} />
            <RecoveryAddressReminder navigationRef={navigationRef} />
            <ContactShareReminder navigationRef={navigationRef} />
            <Stack.Navigator
              initialRouteName={hasWallet ? "Home" : "OnboardingCreate"}
              screenOptions={{ headerShown: false, animation: "fade" }}
            >
            <Stack.Screen name="OnboardingCreate" component={OnboardingCreateScreen} />
            <Stack.Screen name="OnboardingSecurity" component={OnboardingSecurityScreen} />
            <Stack.Screen name="TermsOfUse" component={TermsOfUseScreen} />
            <Stack.Screen name="PasskeyProgress" component={PasskeyProgressScreen} />
            <Stack.Screen name="AdvancedBackup" component={AdvancedBackupScreen} />
            <Stack.Screen name="NostrBackup" component={NostrBackupScreen} />
            <Stack.Screen name="HomeServerBackup" component={HomeServerBackupScreen} />
            <Stack.Screen name="BackupRecap" component={BackupRecapScreen} />
            <Stack.Screen name="BackupEnabledSuccess" component={BackupEnabledSuccessScreen} />
            <Stack.Screen name="RestoreWallet" component={RestoreWalletScreen} />
            <Stack.Screen name="Ready" component={ReadyScreen} />
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="RemoveWallet" component={RemoveWalletScreen} />
            <Stack.Screen name="RemoveLightningWallet" component={RemoveLightningWalletScreen} />
            <Stack.Screen name="AddWallet" component={AddWalletScreen} />
            <Stack.Screen name="Receive" component={ReceiveScreen} />
            <Stack.Screen name="Send" component={SendScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="PairBluetooth" component={PairBluetoothScreen} />
            <Stack.Screen name="ArkadeSettings" component={ArkadeSettingsScreen} />
            <Stack.Screen name="ArkadeNetwork" component={ArkadeNetworkScreen} />
            <Stack.Screen name="Language" component={LanguageScreen} />
            <Stack.Screen name="DisplayCurrencies" component={DisplayCurrenciesScreen} />
            <Stack.Screen name="BitcoinMaxiSettings" component={BitcoinMaxiSettingsScreen} />
            <Stack.Screen name="FiatModeSettings" component={FiatModeSettingsScreen} />
            <Stack.Screen name="Delegates" component={DelegatesScreen} />
            <Stack.Screen name="ConnectedNode" component={ConnectedNodeScreen} />
            <Stack.Screen name="ConnectNode" component={ConnectNodeScreen} />
            <Stack.Screen name="ConnectBtcPay" component={ConnectBtcPayScreen} />
            <Stack.Screen name="ConnectLndHub" component={ConnectLndHubScreen} />
            <Stack.Screen name="NodeStatus" component={NodeStatusScreen} />
            <Stack.Screen name="Privacy" component={PrivacyScreen} />
            <Stack.Screen name="Notifications" component={NotificationsSettingsScreen} />
            <Stack.Screen name="CursorAgentSettings" component={CursorAgentSettingsScreen} />
            <Stack.Screen name="SetAppPin" component={SetAppPinScreen} />
            <Stack.Screen name="ExportRecoveryPhrase" component={ExportRecoveryPhraseScreen} />
            <Stack.Screen name="NostrIdentity" component={NostrIdentityScreen} />
            <Stack.Screen name="ArchivedWallets" component={ArchivedWalletsScreen} />
            <Stack.Screen name="Contacts" component={ContactsListScreen} />
            <Stack.Screen name="ContactEdit" component={ContactEditScreen} />
            <Stack.Screen name="ContactShareOffer" component={ContactShareOfferScreen} />
            <Stack.Screen name="PayHub" component={PayHubScreen} />
            <Stack.Screen name="ChatThread" component={ChatThreadScreen} />
            <Stack.Screen name="ChatAmount" component={ChatAmountScreen} />
            <Stack.Screen name="ExportNsecWarning" component={ExportNsecWarningScreen} />
            <Stack.Screen name="ExportNsecReveal" component={ExportNsecRevealScreen} />
            <Stack.Screen name="GenerateIdentityWarning" component={GenerateIdentityWarningScreen} />
            <Stack.Screen name="ImportNsecWarning" component={ImportNsecWarningScreen} />
            <Stack.Screen name="ResetApp" component={ResetAppScreen} />
            <Stack.Screen name="Logs" component={LogsScreen} />
            <Stack.Screen name="UnilateralExitHub" component={UnilateralExitHubScreen} />
            <Stack.Screen
              name="UnilateralExitPrepare"
              component={UnilateralExitPrepareScreen}
            />
            <Stack.Screen
              name="UnilateralExitFund"
              component={UnilateralExitFundScreen}
            />
            <Stack.Screen
              name="UnilateralExitExecute"
              component={UnilateralExitExecuteScreen}
            />
            <Stack.Screen
              name="CollaborativeOffboard"
              component={CollaborativeOffboardScreen}
            />
            <Stack.Screen
              name="ExitRecoveryAddress"
              component={ExitRecoveryAddressScreen}
            />
            <Stack.Screen name="About" component={AboutScreen} />
            <Stack.Screen
              name="ActivityDetail"
              component={ActivityDetailScreen}
              options={{ animation: "slide_from_right" }}
            />
            </Stack.Navigator>
          </SheetHost>
        </NavigationContainer>
      )}
    </AppLockGate>
  );
}
