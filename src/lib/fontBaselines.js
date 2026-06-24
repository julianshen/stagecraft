// Per-(layout, field) canvas default font size, in px of the 1920×1080 authoring
// space. Single-sourced between the renderer (which sizes the field) and the PPTX
// export, which scales its own hand-tuned pt baseline by the user's fmt.fontSize ÷
// this baseline — so a field resized on the canvas exports at the same proportion
// (the two surfaces are independently laid out, so a ratio, not absolute px, is
// what carries across). Extend per layout/field as parity is wired (text first).
export const CANVAS_BASELINE_PX = Object.freeze({
  cover: Object.freeze({ title: 140 }),
  divider: Object.freeze({ title: 140 }),
  text: Object.freeze({ title: 84, body: 32 }),
});
