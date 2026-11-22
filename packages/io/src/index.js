/** Host-neutral document I/O. Sources never trigger ambient filesystem or network access. */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    if (signal.reason !== undefined) throw signal.reason;
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  }
}

export function byteLimit(value, name = 'maxBytes') {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return value;
}

/** Copy caller-owned bytes so a host cannot mutate the package during async parsing. */
export async function readBytes(source, { maxBytes = DEFAULT_MAX_BYTES, signal } = {}) {
  byteLimit(maxBytes);
  throwIfAborted(signal);
  let bytes;
  if (source instanceof Uint8Array) bytes = source;
  else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
  else if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (source.size > maxBytes) throw new RangeError('Source exceeds maxBytes');
    bytes = new Uint8Array(await source.arrayBuffer());
  } else throw new TypeError('Expected Uint8Array, ArrayBuffer, or Blob bytes');
  throwIfAborted(signal);
  if (bytes.byteLength > maxBytes) throw new RangeError('Source exceeds maxBytes');
  return new Uint8Array(bytes);
}

const isBytes = (value) => value instanceof Uint8Array || value instanceof ArrayBuffer
  || (typeof Blob !== 'undefined' && value instanceof Blob);
function checkAdapter(adapter, method) {
  if (!adapter || typeof adapter.id !== 'string' || !adapter.id || typeof adapter[method] !== 'function') {
    throw new TypeError(`An explicit format adapter with ${method}() is required`);
  }
}
function diagnosticsOf(result) {
  if (!Array.isArray(result?.diagnostics)) throw new TypeError('Adapter must return diagnostics as an array');
  return result.diagnostics;
}

export async function importDocument(source, { adapter, load, maxBytes = DEFAULT_MAX_BYTES, signal, ...options } = {}) {
  checkAdapter(adapter, 'import');
  byteLimit(maxBytes);
  throwIfAborted(signal);
  if (!isBytes(source)) {
    if (typeof load !== 'function') throw new TypeError('Non-byte sources require an explicit host load callback');
    source = await load(source, { signal, maxBytes });
    throwIfAborted(signal);
  }
  const bytes = await readBytes(source, { maxBytes, signal });
  throwIfAborted(signal);
  const result = await adapter.import(bytes, { ...options, signal, maxBytes });
  throwIfAborted(signal);
  if (!result || result.document == null) throw new TypeError('Adapter did not return a document');
  return { ...result, diagnostics: diagnosticsOf(result), metadata: { format: adapter.id, mimeType: adapter.mimeType, byteLength: bytes.byteLength } };
}

function exportFileName(document, adapter, requested) {
  if (requested !== undefined && (typeof requested !== 'string' || !requested.trim())) throw new TypeError('fileName must be a non-empty string');
  const clean = value => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (requested !== undefined) return clean(requested) || 'document';
  const title = typeof document?.title === 'string' ? clean(document.title) : '';
  const extension = adapter.extensions?.find(value => typeof value === 'string' && /^[a-z0-9]+$/i.test(value));
  return `${title || 'document'}${extension ? `.${extension}` : ''}`;
}

export async function exportDocument(document, { adapter, save, signal, fileName, maxBytes = DEFAULT_MAX_BYTES, ...options } = {}) {
  checkAdapter(adapter, 'export');
  byteLimit(maxBytes);
  if (save !== undefined && typeof save !== 'function') throw new TypeError('save must be a host callback');
  throwIfAborted(signal);
  const outputFileName = exportFileName(document, adapter, fileName);
  const result = await adapter.export(document, { ...options, signal, maxBytes, fileName: outputFileName });
  throwIfAborted(signal);
  const bytes = await readBytes(result?.bytes, { maxBytes, signal });
  const output = { ...result, bytes, diagnostics: diagnosticsOf(result), metadata: { format: adapter.id, mimeType: adapter.mimeType, fileName: outputFileName, byteLength: bytes.byteLength } };
  if (save) {
    throwIfAborted(signal);
    await save(bytes, { ...output.metadata, signal });
    throwIfAborted(signal);
  }
  return output;
}
