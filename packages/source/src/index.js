import JSZip from 'jszip';
import { validateDocument, isRunFormatValue } from '@stagecraft/core/document';
import { cloneJson } from '@stagecraft/core/editor';
import { readBytes, throwIfAborted, DEFAULT_MAX_BYTES, byteLimit } from '@stagecraft/io';
import { inspectZip } from '@stagecraft/io/zip';
import { runtime, xmlPart, locate, validText, all, child, children, NS } from './xml.js';
import { readPptx } from './pptx.js';
import { readOdp, patchOdp } from './odp.js';
import { authoringDiff, prepareAuthoring, coalesceSplitBreaks } from './authoring.js';
import { odpFormattingWriter } from './odp-format.js';
const clone = value => cloneJson(value);
// CT_TextCharacterProperties is ordered. Insert edited children without rebuilding retained XML.
const RUN_CHILD_ORDER = ['ln','noFill','solidFill','gradFill','blipFill','pattFill','grpFill','effectLst','effectDag','highlight','uLnTx','uLn','uFillTx','uFill','latin','ea','cs','sym','hlinkClick','hlinkMouseOver','rtl','extLst'];
const RUN_FILLS = ['noFill','solidFill','gradFill','blipFill','pattFill','grpFill'];
function patchRunTypography(properties, patch) {
    const doc = properties.ownerDocument;
    const insert = name => {
        const node = doc.createElementNS(NS.a, `a:${name}`);
        const following = children(properties).find(n => n.namespaceURI === NS.a && RUN_CHILD_ORDER.indexOf(n.localName) > RUN_CHILD_ORDER.indexOf(name));
        properties.insertBefore(node, following ?? null);
        return node;
    };
    if (Object.hasOwn(patch, 'typeface')) {
        const fonts = children(properties).filter(n => n.namespaceURI === NS.a && n.localName === 'latin');
        if (patch.typeface === null) for (const font of fonts) properties.removeChild(font);
        else {
            if (fonts.length > 1) throw new Error('Ambiguous direct font');
            (fonts[0] ?? insert('latin')).setAttribute('typeface', patch.typeface);
        }
    }
    if (Object.hasOwn(patch, 'color')) {
        for (const node of children(properties).filter(n => n.namespaceURI === NS.a && RUN_FILLS.includes(n.localName))) properties.removeChild(node);
        if (patch.color !== null) {
            const fill = insert('solidFill'), color = doc.createElementNS(NS.a, 'a:srgbClr');
            color.setAttribute('val', patch.color.slice(1).toUpperCase()); fill.appendChild(color);
        }
    }
}

/** Hard limits for host-supplied image bytes. Aggregate bounds matter more than the per-image one. */
export const IMAGE_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024, maxImages: 64 });
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const sniffImage = bytes => {
    if (bytes.length >= 8 && PNG.every((b, i) => bytes[i] === b)) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        for (let i = bytes.length - 2; i > 2; i--) if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return 'image/jpeg';
    }
    return null;
};
/** Private retained package; callers receive only canonical JSON and fresh export bytes. */
export async function openPresentation(source, options = {}) {
    options = { ...options };
    const { format, signal } = options;
    if (!['pptx', 'odp'].includes(format))
        throw new Error('Unsupported native format');
    const xml = runtime(options.xml);
    let original = await readBytes(source, options);
    const { zip, checkLimits } = await inspectZip(original, options);
    let mapping = new Map();
    let baseline = await (format === 'pptx' ? readPptx : readOdp)(zip, xml, mapping);
    validateDocument(baseline);
    throwIfAborted(signal);
    // Bounded preview bytes for native (already-in-package) PNG/JPEG assets, so a reopened export
    // still displays images. Read-only: original retained bytes are never touched or rewritten.
    const previews = new Map();
    const skippedPreviews = [];
    let previewBytes = 0;
    for (const asset of baseline.assets) {
        const part = asset.source?.part;
        if (!part || asset.extensions?.externalTarget || asset.extensions?.directory) continue;
        const entry = zip.file(part);
        if (!entry) continue;
        try {
            const bytes = new Uint8Array(await entry.async('uint8array'));
            if (bytes.length > IMAGE_LIMITS.maxBytes) { skippedPreviews.push(asset.id); continue; }
            const contentType = sniffImage(bytes);
            if (!contentType) continue; // not PNG/JPEG: no preview rather than a wrong one
            if (previews.size >= IMAGE_LIMITS.maxImages || previewBytes + bytes.length > IMAGE_LIMITS.maxTotalBytes) { skippedPreviews.push(asset.id); continue; }
            previews.set(asset.id, { bytes, contentType });
            previewBytes += bytes.length;
        } catch { skippedPreviews.push(asset.id); }
    }
    let editableSlots = new WeakMap();
    const visit = objects => {
        for (const object of objects ?? []) {
            for (const paragraph of object.text?.paragraphs ?? [])
                for (const run of paragraph.runs)
                    if (mapping.has(run.id))
                        editableSlots.set(run, mapping.get(run.id));
            visit(object.children);
        }
    };
    for (const owner of [...baseline.slides, ...baseline.layouts, ...baseline.masters])
        visit(owner.objects);
    const signatureRelationship = baseline.relationships.some(r => /\/digital-signature\/(?:origin|signature|certificate)$/.test(r.type));
    const signatureContentType = format === 'pptx' && all(await xmlPart(zip, '[Content_Types].xml', xml), 'ct', '*').some(n => /digital-signature/.test(n.getAttribute('ContentType') ?? ''));
    const signed = signatureRelationship || signatureContentType || Object.keys(zip.files).some(p => /^_xmlsignatures\//i.test(p) || /^META-INF\/[^/]*signatures\.xml$/i.test(p));
    throwIfAborted(signal);
    const readOnly = signed;
    const capabilities = Object.freeze({ edits: Object.freeze(readOnly ? [] : ['existing-run-text', 'existing-run-format', 'slide-structure', 'object-structure', 'object-geometry', 'object-style', 'slide-properties', 'object-text', 'object-table', 'object-image', 'object-chart', 'paragraph-format', 'text-body-layout', 'run-range-format']), readOnly, preservesUntouchedParts: true, exactNoOp: true, nativeVisualCertification: false, trustedWholeSource: true });
    const diagnostics = Object.freeze([Object.freeze({ code: 'PARTIAL_CANONICAL_VIEW', message: 'The canonical view is partial: unknown objects remain opaque and native style inheritance is retained without resolution. Original package retention does not certify canonical rendering.' }), Object.freeze({ code: 'NATIVE_VISUAL_UNCERTIFIED', message: 'Retained source text patching has not been visually certified in native Office applications.' }), ...(format === 'odp' ? [Object.freeze({ code: 'ODP_ROTATION_UNSUPPORTED', message: 'ODP authoring supports unrotated geometry only; nonzero rotation edits are rejected.' })] : []), Object.freeze({ code: 'RETAINED_DELETED_PARTS', message: 'Deleting visible slides or objects is not sanitization: original unreferenced package parts and relationships may remain.' }), ...(skippedPreviews.length ? [Object.freeze({ code: 'IMAGE_PREVIEW_UNAVAILABLE', message: `${skippedPreviews.length} embedded image(s) exceed the preview limits and are shown as placeholders.` })] : []), ...(signed ? [Object.freeze({ code: 'SIGNED_SOURCE', message: 'Signed source allows exact unchanged export only.' })] : [])]);
    let disposed = false;
    /** assetId -> { bytes, contentType } for host-registered image bytes. Never enters canonical JSON. */
    const images = new Map();
    let registeredBytes = 0, nextImageId = 0;
    const imageFor = assetId => (images.get(assetId) ?? previews.get(assetId) ?? null);
    const registerImage = input => {
        check();
        if (!input || typeof input !== 'object') throw new Error('Invalid image input');
        const raw = input.bytes;
        if (!(raw instanceof Uint8Array)) throw new Error('Image bytes must be a Uint8Array');
        if (raw.length === 0 || raw.length > IMAGE_LIMITS.maxBytes) throw new Error('Image exceeds the per-image byte limit');
        const contentType = sniffImage(raw);
        if (!contentType) throw new Error('Unsupported image (PNG or JPEG only)');
        if (input.contentType !== undefined && input.contentType !== contentType) throw new Error('Image content type does not match its bytes');
        if (images.size >= IMAGE_LIMITS.maxImages) throw new Error('Image count limit reached');
        if (registeredBytes + raw.length > IMAGE_LIMITS.maxTotalBytes) throw new Error('Image total byte limit reached');
        // Monotonic sequence: a released registration shrinks `images`, so size-derived ids could
        // collide with a surviving registration within the same millisecond and overwrite its bytes.
        const assetId = `image-asset-${++nextImageId}`;
        images.set(assetId, { bytes: raw.slice(), contentType });
        registeredBytes += raw.length;
        let state = 'registered';
        return {
            assetId, contentType,
            /** Marks the bytes as consumed by a committed edit; its undo history keeps them reachable. */
            commit() {
                check();
                if (state === 'released') throw new Error('Image registration was released');
                state = 'committed';
            },
            /** Frees quota for a registration that never reached a committed edit (denied/failed dispatch). */
            release() {
                check();
                if (state !== 'registered') return false;
                const image = images.get(assetId);
                if (!image) return false;
                images.delete(assetId);
                registeredBytes -= image.bytes.length;
                state = 'released';
                return true;
            },
        };
    };
    /** Copied bytes for host previews; the session keeps its own private copy. */
    const getImage = assetId => {
        const image = imageFor(assetId);
        return image ? { bytes: image.bytes.slice(), contentType: image.contentType } : null;
    };
    const assets = { get: imageFor, has: assetId => images.has(assetId) };
    const check = s => {
        if (disposed)
            throw new Error('Source session disposed');
        throwIfAborted(signal);
        throwIfAborted(s);
    };
    return {
        document: clone(baseline), diagnostics, capabilities, registerImage, getImage,
        get images() { return [...new Set([...images.keys(), ...previews.keys()])]; },
        async export(document, exportOptions = {}) {
            exportOptions = { ...exportOptions };
            check(exportOptions.signal);
            // Synchronous clone/validation/diff precede the first await.
            validateDocument(document);
            const snapshot = clone(document), changes = [];
            // FU-CR: native run-text edits are written one run at a time, so a split CRLF must be
            // coalesced against the paragraph's post-edit runs (the snapshot) — computed from the
            // canonical paragraph, not per change. Empty runs are skipped by the lookahead.
            const forEachParagraph = (owners, fn) => { for (const owner of owners) { const visit = objects => { for (const object of objects ?? []) {
                const paragraphs = [...(object.text?.paragraphs ?? []), ...(object.table?.rows ?? []).flatMap(row => (row.cells ?? []).flatMap(cell => cell.text?.paragraphs ?? []))];
                for (const paragraph of paragraphs) fn(paragraph);
                visit(object.children);
            } }; visit(owner.objects); } };
            const runContexts = new Map(), baselineRunById = new Map();
            const changeRun = new Map(), runToChange = new Map(), textChangedRuns = new Set(), otherChangedRuns = new Set(), changedParagraphs = new Set();
            forEachParagraph([...snapshot.slides, ...snapshot.layouts, ...snapshot.masters], paragraph => {
                const texts = paragraph.runs.map(run => ({ text: run.text }));
                paragraph.runs.forEach((run, index) => runContexts.set(run, { texts, index, runs: paragraph.runs }));
            });
            forEachParagraph([...baseline.slides, ...baseline.layouts, ...baseline.masters], paragraph => {
                for (const run of paragraph.runs) baselineRunById.set(run.id, run);
            });
            // FU-CR fix5: ONE general rule, applied after the diff. Every paragraph containing a
            // text-changed run (text or emptiness) is coalesced as a whole over its post-edit run
            // texts; then every run in it whose coalesced written text differs from what the file
            // currently holds gets its change replaced (or a new change emitted, writable slot
            // required). Documented fallback: a run without a writable slot — or one whose only
            // change is formatting, which cannot also carry text — stays as-is; an extra blank
            // line is better than failing the export.
            const delta = authoringDiff(baseline, snapshot, (a,b) => diff(a,b));
            function diff(a, b) {
                if (delta.hook(a,b)) return;
                if (a === b)
                    return;
                if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b))
                    throw new Error('Unsupported source document edit');
                const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
                if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i]))
                    throw new Error('Unsupported source document structure');
                const slot = editableSlots.get(a);
                if (slot?.kind === 'odp') {
                    const overrides = b.style?.overrides;
                    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
                        || Object.entries(overrides).some(([key, value]) => !isRunFormatValue(key, value)))
                        throw new Error('Invalid ODP formatting override');
                    for (const key of ak) {
                        if (key === 'text') validText(b.text);
                        else if (key === 'style') diff(a.style, { ...b.style, overrides: a.style.overrides });
                        else diff(a[key], b[key]);
                    }
                    if (a.text !== b.text || Object.keys(overrides).length) {
                        const change = { ...slot, text: b.text, overrides, replaceText: a.text !== b.text };
                        changes.push(change);
                        changeRun.set(change, b);
                        runToChange.set(b, change);
                        if (a.text !== b.text) { textChangedRuns.add(b); changedParagraphs.add(runContexts.get(b)?.runs); }
                        else otherChangedRuns.add(b);
                    }
                    return;
                }
                for (const key of ak) {
                    if (key === 'style' && editableSlots.get(a)?.kind === 'pptx') {
                        const before = a.style, after = b.style;
                        if (!after || typeof after !== 'object' || Array.isArray(after)) throw new Error('Unsupported run style');
                        const patch = {};
                        for (const attribute of new Set([...Object.keys(before), ...Object.keys(after)])) {
                            const value = after[attribute];
                            if (Object.hasOwn(before, attribute) === Object.hasOwn(after, attribute) && before[attribute] === value) continue;
                            if (!['b', 'i', 'sz', 'typeface', 'color'].includes(attribute)) {
                                if (!Object.hasOwn(before, attribute) || !Object.hasOwn(after, attribute)) throw new Error('Unsupported run style');
                                diff(before[attribute], value);
                                continue;
                            }
                            if (attribute === 'typeface' || attribute === 'color') {
                                if (value !== undefined && !isRunFormatValue(attribute === 'typeface' ? 'fontFamily' : 'color', value)) throw new Error('Invalid direct run typography');
                            } else if (value !== undefined && (typeof value !== 'string' || (attribute === 'sz'
                                ? !/^\d+$/.test(value) || Number(value) < 100 || Number(value) > 400000
                                : !['0', '1', 'true', 'false'].includes(value)))) throw new Error('Invalid direct run formatting');
                            patch[attribute] = value ?? null;
                        }
                        if (Object.keys(patch).length) {
                            const change = { ...editableSlots.get(a), formatting: patch };
                            changes.push(change);
                            otherChangedRuns.add(b);
                        }
                    }
                    else if (key === 'text' && typeof a.text === 'string' && editableSlots.has(a) && a.text !== b.text) {
                        validText(b.text);
                        const change = { ...editableSlots.get(a), text: b.text };
                        changes.push(change);
                        changeRun.set(change, b);
                        runToChange.set(b, change);
                        textChangedRuns.add(b);
                        changedParagraphs.add(runContexts.get(b)?.runs);
                    }
                    else
                        diff(a[key], b[key]);
                }
            }
            diff(baseline, snapshot);
            const authored = delta.structures.length || delta.geometries.length || delta.fills.length || delta.slideProperties.length
                || (delta.paragraphFormats?.length ?? 0) || (delta.bodyLayouts?.length ?? 0);
            if ((changes.length || authored) && signed)
                throw new Error('Cannot edit signed source package');
            const limits = { ...options, ...exportOptions };
            delete limits.xml;
            delete limits.format;
            byteLimit(limits.maxBytes ?? DEFAULT_MAX_BYTES);
            const bytes = original;
            if (!changes.length && !authored) {
                const result = await readBytes(bytes, limits);
                check(exportOptions.signal);
                checkLimits(limits);
                check(exportOptions.signal);
                return { bytes: result, dirtyParts: [], diagnostics: [...diagnostics] };
            }
            const { zip: working } = await inspectZip(bytes, { ...options, signal: exportOptions.signal ?? signal });
            check(exportOptions.signal);
            const docs = new Map();
            const getDoc = async part => { if (!docs.has(part)) docs.set(part, await xmlPart(working, part, xml)); return docs.get(part); };
            const applyAuthoring = authored ? await prepareAuthoring(working, xml, baseline, delta, getDoc, assets) : null;
            // FU-CR fix5: coalesce every changed paragraph as a whole, then reconcile each of
            // its runs against the coalesced written text.
            for (const runs of changedParagraphs) {
                if (!runs) continue;
                const written = coalesceSplitBreaks(runs.map(run => ({ text: run.text })));
                for (const [index, run] of runs.entries()) {
                    const change = runToChange.get(run);
                    if (change) {
                        change.text = written[index];
                        // An ODP change whose only edit was formatting carries replaceText:false;
                        // once the coalesced text differs from the run's current text, the file
                        // must be rewritten, so promote it.
                        if (written[index] !== run.text) change.replaceText = true;
                        continue;
                    }
                    if (written[index] === run.text) continue;
                    if (otherChangedRuns.has(run)) continue;
                    const baselineRun = baselineRunById.get(run.id);
                    const slot = baselineRun ? editableSlots.get(baselineRun) : undefined;
                    if (!slot) continue;
                    const newChange = { ...slot, text: written[index], ...(slot.kind === 'odp' ? { overrides: {}, replaceText: true } : {}) };
                    changes.push(newChange);
                    changeRun.set(newChange, run);
                    runToChange.set(run, newChange);
                }
            }
            let dirtyParts = [...new Set(changes.map(c => c.part))].sort();
            for (const part of dirtyParts) {
                const doc = await getDoc(part);
                check(exportOptions.signal);
                // Resolve every target before replacement can shift neighboring child indexes.
                const targets = changes.filter(c => c.part === part).map(c => ({ change: c, node: locate(doc, c.path) }));
                const odpFormat = format === 'odp' ? odpFormattingWriter(doc, targets[0].change.styleNames) : null;
                for (const { change, node } of targets) {
                    if (!node)
                        throw new Error('Missing mapped XML node');
                    if (change.formatting) {
                        const run = node.parentNode;
                        let properties = child(run, 'a', 'rPr');
                        if (!properties) {
                            properties = doc.createElementNS(NS.a, `${node.prefix ? node.prefix + ':' : ''}rPr`);
                            run.insertBefore(properties, node);
                        }
                        patchRunTypography(properties, change.formatting);
                        for (const [name, value] of Object.entries(change.formatting)) {
                            if (name === 'typeface' || name === 'color') continue;
                            if (value === null) properties.removeAttribute(name);
                            else properties.setAttribute(name, value);
                        }
                    }
                    else if (change.kind === 'odp') {
                        let target = node;
                        if (change.emptyContainer) { target = doc.createTextNode(''); node.appendChild(target); }
                        patchOdp(target, change.text, Object.keys(change.overrides).length ? odpFormat(change.overrides) : undefined, change.replaceText);
                    }
                    else {
                        node.textContent = change.text;
                        if (/^\s|\s$/.test(change.text))
                            node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
                    }
                }

            }
            if (applyAuthoring) dirtyParts = [...new Set([...dirtyParts, ...await applyAuthoring()])].sort();
            for (const part of dirtyParts) if (docs.has(part)) working.file(part, xml.serialize(docs.get(part)));
            let output = working;
            if (format === 'odp') {
                output = new JSZip();
                output.file('mimetype', await working.file('mimetype').async('uint8array'), { compression: 'STORE' });
                check(exportOptions.signal);
                for (const entry of Object.values(working.files))
                    if (entry.name !== 'mimetype') {
                        const data = entry.dir ? null : await entry.async('uint8array');
                        check(exportOptions.signal);
                        output.file(entry.name, data, { dir: entry.dir, date: entry.date, comment: entry.comment, unixPermissions: entry.unixPermissions, dosPermissions: entry.dosPermissions, createFolders: false });
                    }
            }
            const generated = await output.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
            check(exportOptions.signal);
            const result = await readBytes(generated, limits);
            check(exportOptions.signal);
            await inspectZip(result, limits);
            check(exportOptions.signal);
            return { bytes: result, dirtyParts, diagnostics: [...diagnostics] };
        },
        dispose() { disposed = true; original = null; baseline = null; mapping?.clear(); mapping = null; editableSlots = null; images.clear(); previews.clear(); registeredBytes = 0; previewBytes = 0; }
    };
}
