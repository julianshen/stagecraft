// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createSafeXmlRuntime, safeXmlParse } from './index.js';

const declarationError = 'DTD and entity declarations are unsupported';
const invalidError = 'Invalid XML';
const parserError = (namespace = null) => ({
  documentElement: {},
  getElementsByTagName: name => name === 'parsererror' && namespace === null ? [{}] : [],
  getElementsByTagNameNS: (_ns, name) => name === 'parsererror' && namespace !== null ? [{}] : [],
});

describe('safe XML gate', () => {
  it.each([
    ['simple doctype', '<!DOCTYPE root><root/>'],
    ['internal subset', '<!DOCTYPE root [<!ENTITY x "secret">]><root/>'],
    ['external doctype', '<!DOCTYPE root SYSTEM "file:///secret"><root/>'],
    ['entity', '<!ENTITY x "secret"><root/>'],
    ['nul doctype', '<!DO\0CTYPE root><root/>'],
    ['nul entity', '<!ENT\0ITY x "secret"><root/>'],
    ['comment false positive', '<root><!-- <!doctype secret> --></root>'],
    ['CDATA false positive', '<root><![CDATA[<!ENTITY secret>]]></root>'],
    ['BOM and whitespace', '\uFEFF \n\t<!doctype root><root/>'],
  ])('rejects %s before invoking the host parser', (_label, text) => {
    const parse = vi.fn(() => ({ documentElement: {} }));
    expect(() => safeXmlParse(text, { parse })).toThrow(declarationError);
    expect(parse).not.toHaveBeenCalled();
  });

  it('parses the original text and rejects a NUL outside a declaration', () => {
    const parse = vi.fn(() => parserError());
    expect(() => safeXmlParse('<root>\0secret</root>', { parse })).toThrow(invalidError);
    expect(parse).toHaveBeenCalledWith('<root>\0secret</root>');
  });

  it.each([
    ['null result', () => null],
    ['missing root', () => ({})],
    ['doctype', () => ({ documentElement: {}, doctype: {} })],
    ['unnamespaced parsererror', () => parserError()],
    ['namespaced parsererror', () => parserError('urn:custom:parsererror')],
  ])('rejects %s with a fixed content-free error', (_label, parse) => {
    expect(() => safeXmlParse('<root/>', { parse })).toThrow(invalidError);
  });

  it('normalizes host parser exceptions without leaking document text', () => {
    const parse = () => { throw new Error('SECRET_DOCUMENT_TEXT'); };
    let error;
    try { safeXmlParse('<root>SECRET_DOCUMENT_TEXT</root>', { parse }); } catch (cause) { error = cause; }
    expect(error?.message).toBe(invalidError);
    expect(error?.message).not.toContain('SECRET_DOCUMENT_TEXT');
  });

  it('accepts valid namespaced XML, declarations, comments, CDATA, and escaped markup', () => {
    const text = '<?xml version="1.0"?><p:root xmlns:p="urn:p"><!-- note --><p:item><![CDATA[<literal>]]>&lt;!DOCTYPE escaped&gt;</p:item></p:root>';
    const doc = { documentElement: {}, getElementsByTagName: () => [], getElementsByTagNameNS: () => [] };
    const parse = vi.fn(() => doc);
    expect(safeXmlParse(text, { parse })).toBe(doc);
    expect(parse).toHaveBeenCalledWith(text);
  });

  it('preserves the receiver of method-based parse and serialize implementations', () => {
    class Runtime {
      constructor() { this.parseCalls = 0; this.serializeCalls = 0; }
      parse() { this.parseCalls++; return { documentElement: {}, getElementsByTagName: () => [], getElementsByTagNameNS: () => [] }; }
      serialize() { this.serializeCalls++; return '<root/>'; }
    }
    const host = new Runtime(), runtime = createSafeXmlRuntime(host);
    const document = runtime.parse('<root/>');
    expect(runtime.serialize(document)).toContain('<root/>');
    expect(host.parseCalls).toBe(1);
    expect(host.serializeCalls).toBe(1);
  });

  it('creates a runtime with an optional serializer and fixed missing-runtime errors', () => {
    const parse = vi.fn(() => ({ documentElement: {}, getElementsByTagName: () => [], getElementsByTagNameNS: () => [] }));
    const serialize = vi.fn(() => '<root/>');
    const runtime = createSafeXmlRuntime({ parse, serialize });
    expect(runtime.parse('<root/>').documentElement).toBeDefined();
    expect(runtime.serialize({})).toBe('<root/>');
    expect(createSafeXmlRuntime({ parse }).serialize).toBeUndefined();
    expect(() => safeXmlParse('<root/>')).toThrow('An XML runtime with parse() is required outside the browser');
  });
});
