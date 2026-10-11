// Tiny DrawingML/PresentationML XML helpers shared by the importer and the
// export post-processor. Namespace-agnostic: elements and attributes match on
// their localName, so a part's prefixes don't matter.
export const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
export const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
export function kid(el, name) {
  if (el) for (const c of el.children) if (c.localName === name) return c;
  return null;
}
// Walk a chain of child names: path(sp, 'spPr', 'xfrm', 'off').
export const path = (el, ...names) => names.reduce((cur, n) => kid(cur, n), el);
export function desc(el, name) {
  if (!el) return null;
  for (const c of el.children) {
    if (c.localName === name) return c;
    const d = desc(c, name);
    if (d) return d;
  }
  return null;
}
// Attribute by local name, ignoring the prefix (r:id / r:embed / p14:dur).
export function attr(el, name) {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}
// A relationship-namespace attribute (r:id / r:embed): a prefixed attribute, so
// `<p:sldId id="256" r:id="rId2">` resolves to the rId, not the numeric id.
export function relAttr(el, name) {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === name && a.prefix) return a.value;
  return null;
}
// A picture's relationship: embedded (r:embed) or linked (r:link — external).
export const blipRel = (blip) => relAttr(blip, 'embed') ?? relAttr(blip, 'link');
// An xsd:boolean attribute: "1"/"true" or "0"/"false"; absent → `d`.
export const boolAttr = (el, name, d = false) => {
  const v = attr(el, name);
  return v == null ? d : v === '1' || v === 'true';
};
export const numAttr = (el, name, d = null) => {
  const s = attr(el, name);
  const v = Number(s);
  return s != null && Number.isFinite(v) ? v : d;
};

// An xfrm → EMU box (+ rotation/flips), mapped through the group transform chain.
export function xfrmBox(xfrm, groupT) {
  if (!xfrm) return null;
  const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
  if (!off || !ext) return null;
  const box = {
    x: numAttr(off, 'x', 0), y: numAttr(off, 'y', 0), w: numAttr(ext, 'cx', 0), h: numAttr(ext, 'cy', 0),
    rot: numAttr(xfrm, 'rot', 0) / 60000,
    flipH: boolAttr(xfrm, 'flipH'), flipV: boolAttr(xfrm, 'flipV'),
  };
  return groupT ? groupT(box) : box;
}
