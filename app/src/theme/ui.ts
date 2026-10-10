import { colors } from "../theme/colors";
import { radii } from "../theme/radii";
import { fonts } from "../theme/typography";
import { StyleSheet } from "react-native";

export const ui = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 28,
    paddingTop: 64,
    paddingBottom: 40,
  },
  centerRoot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 12,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    lineHeight: 18,
  },
  primaryBtn: {
    backgroundColor: colors.fg,
    borderRadius: radii.sm,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  primaryBtnText: {
    fontFamily: fonts.bold,
    fontSize: 15,
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
    fontSize: 15,
    color: colors.fg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.fg,
    padding: 16,
    marginTop: 12,
  },
  cardMuted: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 12,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.fg,
    marginBottom: 8,
  },
  footerLink: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    paddingTop: 24,
  },
});
