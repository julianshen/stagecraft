// OKLCH → OKLab → linear sRGB → gamma (D65). Shared by the palette parity-lock
// tests (chart + risk) so the "exact sRGB of the oklch sibling" invariant is
// verified from one converter rather than a copy pasted into each test file.
export function oklchToHex(str) {
  const parts = str.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!parts) throw new Error(`oklchToHex: not an oklch() string: ${str}`);
  const [L, C, H] = parts.slice(1).map(Number);
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const hx = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0').toUpperCase();
  return hx(gam(r)) + hx(gam(g)) + hx(gam(bl));
}
