// Pixel helpers for the canvas tests (the `chromium` project).

/** The RGBA at slide point (x, y) on a canvas painted at `k` device px per slide px. */
export const pixelAt = (ctx, k, x, y) => [...ctx.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data];

/** Whether an RGBA's colour is within `tol` of an RGB on every channel. */
export const near = (actual, expected, tol = 12) => actual.slice(0, 3).every((c, i) => Math.abs(c - expected[i]) <= tol);
