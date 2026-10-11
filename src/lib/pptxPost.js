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
import { parseXml, kid, path, xfrmBox } from './ooxml.js';
import { isRenderableGradient } from './elements.js';
import { isFillableShape } from './shapes.js';
import { pptxHex } from './color.js';

// Namespaces for the nodes the patches create.
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

const hasWork = ({ gradients, groups }) => Object.keys(gradients).length > 0 || groups.length > 0;

/**
 * The object name an element exports under, which the patches key on: its id,
 * percent-encoded so it holds nothing XML escapes (pptxgenjs escapes a text
 * box's name twice, so `&` or `"` in an id would otherwise never match).
 * One-to-one, so distinct ids stay distinct; plain ids pass through unchanged.
 * A lone UTF-16 surrogate (which encodeURIComponent rejects) becomes `%uXXXX`,
 * a form percent-encoding never produces; the empty id (a valid id, whose
 * empty name pptxgenjs would ignore) becomes a bare `%`, likewise unique.
 */
const isLoneSurrogate = (c) => c.length === 1 && c >= '\ud800' && c <= '\udfff';
export const objectNameOf = (id) => (String(id) === '' ? '%' : String(id)
  .replace(/[\ud800-\udbff][\udc00-\udfff]|[^]/g, (c) => (isLoneSurrogate(c) ? `%u${c.charCodeAt(0).toString(16).toUpperCase()}` : encodeURIComponent(c)))
  .replace(/'/g, '%27'));

/**
 * A slide's plan, read from its elements (each exported under its id): every
 * shape's valid gradient, and each groupId's members in z-order. Members that
 * weren't drawn (an image without a src) and one-member groups need no
 * special case here — the patcher skips names it can't find and groups under
 * two members.
 */
export function planFor(slide) {
  const gradients = Object.create(null); // keyed by arbitrary ids: no inherited __proto__ setter
  const groups = new Map();
  for (const el of Array.isArray(slide?.elements) ? slide.elements : []) {
    if (el?.id == null) continue; // '' is a valid id
    if (isFillableShape(el.type) && isRenderableGradient(el.gradient)) {
      gradients[objectNameOf(el.id)] = { from: pptxHex(el.gradient.from), to: pptxHex(el.gradient.to), angle: el.gradient.angle };
    }
    if (el.groupId) {
      if (!groups.has(el.groupId)) groups.set(el.groupId, []);
      groups.get(el.groupId).push(objectNameOf(el.id));
    }
  }
  return { gradients, groups: [...groups.values()] };
}

/** The pptxgenjs package `data` with each slide's plan applied; `data` itself when there is nothing to do. */
export async function postProcess(data, plans) {
  if (!plans.some(hasWork)) return data;
  const zip = await JSZip.loadAsync(data);
  for (const [i, plan] of plans.entries()) {
    if (!hasWork(plan)) continue;
    const name = `ppt/slides/slide${i + 1}.xml`;
    const part = zip.file(name);
    if (!part) continue; // no such slide: nothing to patch
    zip.file(name, patchSlideXml(await part.async('string'), plan));
  }
  // Each part keeps the compression pptxgenjs gave it (images aren't re-deflated).
  return zip.generateAsync({ type: 'arraybuffer' });
}

/** One slide's XML with its gradients and groups applied. */
export function patchSlideXml(xml, { gradients = {}, groups = [] } = {}) {
  const doc = parseXml(xml);
  const cNvPrs = [...doc.getElementsByTagNameNS(P, 'cNvPr')];
  // Only a unique name is patched: a duplicated element id, or one that
  // happens to match a pptxgenjs default name ("Text 3"), is ambiguous.
  const count = new Map();
  for (const n of cNvPrs) count.set(n.getAttribute('name'), (count.get(n.getAttribute('name')) || 0) + 1);
  const named = new Map(cNvPrs.filter((n) => count.get(n.getAttribute('name')) === 1).map((n) => [n.getAttribute('name'), n]));
  for (const [name, gradient] of Object.entries(gradients)) {
    const spPr = kid(drawableOf(named.get(name)), 'spPr');
    if (spPr) applyGradient(doc, spPr, gradient);
  }
  let nextId = 1 + Math.max(0, ...cNvPrs.map((n) => Number(n.getAttribute('id')) || 0));
  for (const names of groups) {
    if (applyGroup(doc, names.map((n) => drawableOf(named.get(n))).filter(Boolean), nextId)) nextId += 1;
  }
  // XMLSerializer drops the XML declaration; PowerPoint's own parts carry one.
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0] ?? '';
  return decl + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>/, '');
}

// The drawing object (p:sp / p:pic / p:graphicFrame / p:cxnSp / p:grpSp) a
// cNvPr names: its nearest such ancestor.
const DRAWABLE = new Set(['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp']);
function drawableOf(cNvPr) {
  let n = cNvPr?.parentNode;
  while (n && !DRAWABLE.has(n.localName)) n = n.parentNode;
  return n || null;
}

/** A CSS `linear-gradient` angle (0° = up, clockwise) as DrawingML `a:lin ang` (0° = rightward, clockwise; 60000ths). */
export const linAngle = (cssDeg) => Math.round(((((cssDeg - 90) % 360) + 360) % 360) * 60000);

const node = (doc, ns, tag, attrs = {}, children = []) => {
  const n = doc.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const c of children) n.appendChild(c);
  return n;
};

// Swap the shape's own fill (spPr's solidFill — not the outline's) for a
// two-stop linear gradient. The solid fill's colour modifiers (its alpha, i.e.
// the element opacity) carry onto both stops.
function applyGradient(doc, spPr, { from, to, angle }) {
  const solid = kid(spPr, 'solidFill');
  if (!solid) return;
  const mods = [...(solid.firstElementChild?.children || [])];
  const stop = (pos, hex) => node(doc, A, 'a:gs', { pos }, [node(doc, A, 'a:srgbClr', { val: hex }, mods.map((m) => m.cloneNode(true)))]);
  spPr.replaceChild(node(doc, A, 'a:gradFill', { rotWithShape: 1 }, [
    node(doc, A, 'a:gsLst', {}, [stop(0, from), stop(100000, to)]),
    node(doc, A, 'a:lin', { ang: linAngle(angle), scaled: 0 }),
  ]), solid);
}

// The bounds (EMU) a drawing object covers: its own frame — spPr/xfrm, a
// group's grpSpPr/xfrm or a graphic frame's p:xfrm — turned by its rotation
// about its centre.
function boundsOf(shape) {
  const b = xfrmBox(path(shape, 'spPr', 'xfrm') ?? path(shape, 'grpSpPr', 'xfrm') ?? kid(shape, 'xfrm')) ?? { x: 0, y: 0, w: 0, h: 0, rot: 0 };
  const t = (b.rot * Math.PI) / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const hw = (b.w * c + b.h * s) / 2, hh = (b.w * s + b.h * c) / 2;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return { x: Math.round(cx - hw), y: Math.round(cy - hh), r: Math.round(cx + hw), b: Math.round(cy + hh) };
}

// Are the (document-ordered) members adjacent in z-order — siblings with no
// other drawing object between them?
function adjacent(members) {
  const siblings = [...members[0].parentNode.children].filter((c) => DRAWABLE.has(c.localName));
  const at = siblings.indexOf(members[0]);
  return members.every((m, i) => siblings[at + i] === m);
}

// Wrap the members in a p:grpSp (shape id `id`) whose child frame is the
// identity (chOff/chExt = off/ext = their bounds), so every member keeps its
// absolute geometry. A PowerPoint group is contiguous in z-order, so members
// with another object between them stay ungrouped: gathering them would
// restack the slide (the editor's ⌘G gathers them first, as PowerPoint does).
// Returns whether a group was made (it needs two adjacent members).
function applyGroup(doc, members, id) {
  if (members.length < 2) return false;
  members.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  if (!adjacent(members)) return false;
  const boxes = members.map(boundsOf);
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const cx = Math.max(...boxes.map((b) => b.r)) - x, cy = Math.max(...boxes.map((b) => b.b)) - y;
  const frame = [node(doc, A, 'a:off', { x, y }), node(doc, A, 'a:ext', { cx, cy }), node(doc, A, 'a:chOff', { x, y }), node(doc, A, 'a:chExt', { cx, cy })];
  const grp = node(doc, P, 'p:grpSp', {}, [
    node(doc, P, 'p:nvGrpSpPr', {}, [node(doc, P, 'p:cNvPr', { id, name: `Group ${id}` }), node(doc, P, 'p:cNvGrpSpPr'), node(doc, P, 'p:nvPr')]),
    node(doc, P, 'p:grpSpPr', {}, [node(doc, A, 'a:xfrm', {}, frame)]),
  ]);
  members[0].parentNode.insertBefore(grp, members[0]);
  for (const m of members) grp.appendChild(m);
  return true;
}
