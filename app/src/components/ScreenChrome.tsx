import { useNavigation } from "@react-navigation/native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootNav } from "../navigation/types";
import { colors } from "../theme/colors";
import { BasicLogo } from "./BasicLogo";

type Props = {
  children: ReactNode;
  /** Secondary screens use smaller logo (Penpot ~0.77). */
  logoScale?: number;
  /** Top-left wallet switcher avatar (Home). */
  avatar?: ReactNode;
  /** Top-right chrome (e.g. mutinynet active). */
  headerRight?: ReactNode;
  /** Long-press empty chrome → Settings (Home). */
  onLongPressEmpty?: () => void;
  /** Override logo tap (default → Home). */
  onLogoPress?: () => void;
};

/**
 * Penpot chrome: logo centered top; tap logo → Home.
 * No text “← Back” — system back / logo.
 */
export function ScreenChrome({
  children,
  logoScale = 0.77,
  avatar,
  headerRight,
  onLongPressEmpty,
  onLogoPress,
}: Props) {
  const navigation = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();

  const goHome = () => {
    onLogoPress?.();
    navigation.navigate("Home");
  };

  const body = (
    <View style={styles.body} pointerEvents="box-none">
      {children}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 12) + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.header}>
        <View style={[styles.headerSide, styles.headerLeft]}>{avatar ?? null}</View>
        <BasicLogo onPress={goHome} scale={logoScale} />
        <View style={[styles.headerSide, styles.headerRight]}>{headerRight ?? null}</View>
      </View>
      {onLongPressEmpty ? (
        <Pressable
          style={styles.flex}
          delayLongPress={450}
          onLongPress={onLongPressEmpty}
          accessible={false}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

export function WalletAvatar({ label = "P", onPress }: { label?: string; onPress?: () => void }) {
  const inner = (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{label}</Text>
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel="Wallet switcher">
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    minHeight: 48,
  },
  headerSide: {
    flex: 1,
    minWidth: 40,
  },
  headerLeft: {
    alignItems: "flex-start",
  },
  headerRight: {
    alignItems: "flex-end",
  },
  flex: { flex: 1 },
  body: { flex: 1 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
  },
});
