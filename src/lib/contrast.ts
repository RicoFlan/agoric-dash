/**
 * WCAG relative luminance and contrast, used to keep the theme tokens legible.
 *
 * The muted token was #6b7785 on #161d26, which is 3.72:1 and was used at 12px for meaningful text.
 * WCAG AA needs 4.5:1 below 18.66px, so the token failed wherever it carried real information.
 * `contrast.contract.test.ts` pins the tokens so this cannot regress silently.
 */
export function srgbToLinear(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio, 1 to 21. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for normal text (below 18.66px, or below 14pt bold). */
export const WCAG_AA_NORMAL_TEXT = 4.5;
