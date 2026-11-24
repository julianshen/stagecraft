const DECLARATION = /<!\s*(?:DOCTYPE|ENTITY)\b/i;
const invalidXml = () => { throw new Error('Invalid XML'); };

/** Reject declarations lexically, including NUL-obfuscated forms. The original text is still parsed. */
export function rejectXmlDeclarations(text) {
  if (DECLARATION.test(text.replace(/\0/g, ''))) throw new Error('DTD and entity declarations are unsupported');
}

function parseImplementation(runtime) {
  const parse = runtime?.parse ?? (typeof globalThis.DOMParser === 'function'
    ? text => new globalThis.DOMParser().parseFromString(text, 'application/xml') : undefined);
  if (typeof parse !== 'function') throw new Error('An XML runtime with parse() is required outside the browser');
  return parse;
}

/** Parse untrusted XML with one host-neutral gate; document text never appears in gate errors. */
export function safeXmlParse(text, runtime) {
  if (typeof text !== 'string') invalidXml();
  rejectXmlDeclarations(text);
  const parse = parseImplementation(runtime);
  let document;
  try { document = parse(text); } catch { invalidXml(); }
  if (!document?.documentElement || document.doctype
    || typeof document.getElementsByTagName !== 'function'
    || typeof document.getElementsByTagNameNS !== 'function'
    || document.getElementsByTagName('parsererror').length
    || document.getElementsByTagNameNS('*', 'parsererror').length) invalidXml();
  return document;
}

/** Resolve an injected or browser DOM once; serialization remains optional for parse-only hosts. */
export function createSafeXmlRuntime(runtime) {
  const parse = parseImplementation(runtime);
  const serialize = runtime?.serialize ?? (typeof globalThis.XMLSerializer === 'function'
    ? document => new globalThis.XMLSerializer().serializeToString(document) : undefined);
  if (serialize !== undefined && typeof serialize !== 'function')
    throw new Error('An XML runtime with serialize() is required outside the browser');
  return { parse: text => safeXmlParse(text, { parse }), ...(serialize ? { serialize } : {}) };
}
