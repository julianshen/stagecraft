export const NS = { p: 'http://schemas.openxmlformats.org/presentationml/2006/main', a: 'http://schemas.openxmlformats.org/drawingml/2006/main', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', rel: 'http://schemas.openxmlformats.org/package/2006/relationships', ct: 'http://schemas.openxmlformats.org/package/2006/content-types', office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0', svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0', presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0', table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0', c: 'http://schemas.openxmlformats.org/drawingml/2006/chart' };
export const is = (n, ns, name) => n?.nodeType === 1 && n.namespaceURI === NS[ns] && n.localName === name;
export const children = n => Array.from(n?.childNodes ?? []).filter(n => n.nodeType === 1);
export const all = (n, ns, name) => Array.from(n.getElementsByTagNameNS(NS[ns], name));
export const child = (n, ns, name) => children(n).find(n => is(n, ns, name));
export const attr = (n, ns, name) => n?.getAttributeNS(NS[ns], name) ?? '';
export const attrs = n => Object.fromEntries(Array.from(n?.attributes ?? []).map(a => [a.name, a.value]));
export function path(n) {
    const out = [];
    while (n.parentNode) {
        out.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
        n = n.parentNode;
    }
    return out;
}
export const locate = (doc, path) => path.reduce((node, i) => node?.childNodes[i], doc);
export const source = (format, part, n) => ({ format, part, path: path(n) });
export const id = (part, n, kind = 'node') => `${kind}:${part}:${path(n).join('.')}`;
export function runtime(xml) {
    const parse = xml?.parse ?? (typeof DOMParser !== 'undefined' ? s => new DOMParser().parseFromString(s, 'application/xml') : undefined);
    const serialize = xml?.serialize ?? (typeof XMLSerializer !== 'undefined' ? d => new XMLSerializer().serializeToString(d) : undefined);
    if (typeof parse !== 'function' || typeof serialize !== 'function')
        throw new Error('An XML parse/serialize runtime is required');
    return { parse(s) {
            if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(s))
                throw new Error('DTD/entities unsupported');
            const doc = parse(s);
            if (!doc?.documentElement || doc.doctype || doc.getElementsByTagNameNS('*', 'parsererror').length)
                throw new Error('Malformed XML');
            return doc;
        }, serialize };
}
export function validText(s) {
    for (const c of s) {
        const n = c.codePointAt(0);
        if (!(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0xd7ff || n >= 0xe000 && n <= 0xfffd || n >= 0x10000 && n <= 0x10ffff))
            throw new Error('XML-invalid text character');
    }
}
export async function xmlPart(zip, part, xml) {
    const entry = zip.file(part);
    if (!entry)
        throw new Error(`Missing package part: ${part}`);
    return xml.parse(await entry.async('string'));
}
