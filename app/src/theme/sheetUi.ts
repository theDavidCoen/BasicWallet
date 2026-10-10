/**
 * Shared InteractiveBottomSheet content tokens — match Wallets modal.
 * Do not add extra horizontal padding on top of InteractiveBottomSheet body (16).
 */

import { StyleSheet } from "react-native";
import { colors } from "./colors";
import { radii } from "./radii";
import { fonts } from "./typography";

export const sheetUi = StyleSheet.create({
  title: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 4,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 18,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.hint,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 16,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.caption,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.fg,
    fontFamily: fonts.regular,
    fontSize: 16,
    marginBottom: 12,
  },
  primaryBtn: {
    borderRadius: radii.sm,
    backgroundColor: colors.fg,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  primaryBtnText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.onPrimary,
  },
  secondaryBtn: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  secondaryBtnText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.fg,
  },
});
