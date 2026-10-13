import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SectionHeader } from "./SectionHeader";

export type SettingsSectionProps = {
  title: string;
  first?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Optional grouping: section header + rows as children. */
export function SettingsSection({ title, first, children, style }: SettingsSectionProps) {
  return (
    <View style={style}>
      <SectionHeader first={first}>{title}</SectionHeader>
      {children}
    </View>
  );
}
