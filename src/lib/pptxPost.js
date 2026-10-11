// The export post-processor (F-EXP-1). pptxgenjs has no API for some of what
// the deck can hold, so its output is patched afterwards: the package is
// unzipped and each slide's XML gets pure DOM patches, keyed by the
// `p:cNvPr name` the export sets on every element (`objectName = el.id`).
//
//  - gradients: a shape's solid fill → its real two-stop linear `a:gradFill`
//    (pptxgenjs only writes `a:solidFill`);
//  - groups: a `groupId`'s members → one `p:grpSp`, so the group survives in
//    PowerPoint.
//
// A slide's plan is `{ gradients: { [name]: { from, to, angle } }, groups:
// [[name, …], …] }`; plans line up with the slides in export order
// (pptxgenjs writes them as ppt/slides/slideN.xml).
import JSZip from 'jszip';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

const hasWork = (plan) => Object.keys(plan?.gradients || {}).length > 0 || (plan?.groups || []).length > 0;

/** The pptxgenjs package `data` with each slide's plan applied; `data` itself when there is nothing to do. */
export async function postProcess(data, plans) {
  if (!plans.some(hasWork)) return data;
  const zip = await JSZip.loadAsync(data);
  for (const [i, plan] of plans.entries()) {
    if (!hasWork(plan)) continue;
    const path = `ppt/slides/slide${i + 1}.xml`;
    zip.file(path, patchSlideXml(await zip.file(path).async('string'), plan));
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

/** One slide's XML with its gradients and groups applied. */
export function patchSlideXml(xml, { gradients = {}, groups = [] } = {}) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const named = new Map([...doc.getElementsByTagNameNS(P, 'cNvPr')].map((n) => [n.getAttribute('name'), n]));
  for (const [name, gradient] of Object.entries(gradients)) {
    const spPr = shapeOf(named.get(name))?.getElementsByTagNameNS(P, 'spPr')[0];
    if (spPr) applyGradient(doc, spPr, gradient);
  }
  for (const names of groups) applyGroup(doc, names.map((n) => shapeOf(named.get(n))).filter(Boolean));
  // XMLSerializer drops the XML declaration; PowerPoint's own parts carry one.
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0] ?? '';
  return decl + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>/, '');
}

// The top-level drawing object (p:sp / p:pic / p:graphicFrame / p:cxnSp) a
// cNvPr names: the child of the shape tree (or of a group) that holds it.
const DRAWABLE = new Set(['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp']);
function shapeOf(cNvPr) {
  let n = cNvPr?.parentNode;
  while (n && !(n.namespaceURI === P && DRAWABLE.has(n.localName))) n = n.parentNode;
  return n || null;
}

/** A CSS `linear-gradient` angle (0° = up, clockwise) as DrawingML `a:lin ang` (0° = rightward, clockwise; 60000ths). */
export const linAngle = (cssDeg) => ((((cssDeg - 90) % 360) + 360) % 360) * 60000;

const el = (doc, ns, tag, attrs = {}, children = []) => {
  const node = doc.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children) node.appendChild(c);
  return node;
};

// Swap the shape's own fill (a direct child of spPr — not the outline's) for a
// two-stop linear gradient. The solid fill's colour modifiers (its alpha, i.e.
// the element opacity) carry onto both stops.
function applyGradient(doc, spPr, { from, to, angle }) {
  const solid = [...spPr.children].find((c) => c.namespaceURI === A && c.localName === 'solidFill');
  if (!solid) return;
  const mods = [...(solid.firstElementChild?.children || [])];
  const stop = (pos, hex) => el(doc, A, 'a:gs', { pos }, [el(doc, A, 'a:srgbClr', { val: hex }, mods.map((m) => m.cloneNode(true)))]);
  const grad = el(doc, A, 'a:gradFill', { rotWithShape: 1 }, [
    el(doc, A, 'a:gsLst', {}, [stop(0, from), stop(100000, to)]),
    el(doc, A, 'a:lin', { ang: linAngle(angle), scaled: 0 }),
  ]);
  spPr.replaceChild(grad, solid);
}

// The xfrm box of a drawing object, in EMU.
function boxOf(shape) {
  const xfrm = [...shape.getElementsByTagNameNS(A, 'xfrm')][0];
  const n = (tag, a) => Number(xfrm?.getElementsByTagNameNS(A, tag)[0]?.getAttribute(a)) || 0;
  const x = n('off', 'x'), y = n('off', 'y');
  return { x, y, r: x + n('ext', 'cx'), b: y + n('ext', 'cy') };
}

// Wrap the members in a p:grpSp whose child frame is the identity (chOff/chExt
// = off/ext = their bounding box), so every member keeps its absolute
// geometry. A PowerPoint group is contiguous in z-order, so it takes the
// topmost member's place and the members keep their relative order.
function applyGroup(doc, members) {
  if (members.length < 2) return;
  members.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const boxes = members.map(boxOf);
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const cx = Math.max(...boxes.map((b) => b.r)) - x, cy = Math.max(...boxes.map((b) => b.b)) - y;
  const id = 1 + Math.max(0, ...[...doc.getElementsByTagNameNS(P, 'cNvPr')].map((n) => Number(n.getAttribute('id')) || 0));
  const frame = [el(doc, A, 'a:off', { x, y }), el(doc, A, 'a:ext', { cx, cy }), el(doc, A, 'a:chOff', { x, y }), el(doc, A, 'a:chExt', { cx, cy })];
  const grp = el(doc, P, 'p:grpSp', {}, [
    el(doc, P, 'p:nvGrpSpPr', {}, [el(doc, P, 'p:cNvPr', { id, name: `Group ${id}` }), el(doc, P, 'p:cNvGrpSpPr'), el(doc, P, 'p:nvPr')]),
    el(doc, P, 'p:grpSpPr', {}, [el(doc, A, 'a:xfrm', {}, frame)]),
  ]);
  const top = members[members.length - 1];
  top.parentNode.insertBefore(grp, top);
  for (const m of members) grp.appendChild(m);
}
