/**
 * JetBrains Mono presets — crystallize sizes already used in `ui` / `sheetUi`.
 * `caption` (14) is hub; `sheetCaption` (13) keeps sheet body parity.
 */
export const fonts = {
  regular: "JetBrainsMono_400Regular",
  bold: "JetBrainsMono_700Bold",
} as const;

export const type = {
  title: { fontFamily: fonts.bold, fontSize: 20 },
  body: { fontFamily: fonts.regular, fontSize: 15 },
  caption: { fontFamily: fonts.regular, fontSize: 14 },
  sheetCaption: { fontFamily: fonts.regular, fontSize: 13 },
  hint: { fontFamily: fonts.regular, fontSize: 12 },
  input: { fontFamily: fonts.regular, fontSize: 16 },
  button: { fontFamily: fonts.bold, fontSize: 15 },
  buttonSheet: { fontFamily: fonts.bold, fontSize: 14 },
} as const;
