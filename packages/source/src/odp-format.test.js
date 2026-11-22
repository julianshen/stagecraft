import { describe, expect, it } from 'vitest';
import { odpAppearanceReader, odpFormattingWriter, reservedOdpStyleNames } from './odp-format.js';
import { patchOdp } from './odp.js';
import { NS } from './xml.js';
const xmlns = `xmlns:office="${NS.office}" xmlns:style="${NS.style}" xmlns:text="${NS.text}" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"`;
const doc = (body, kind = 'content') => new DOMParser().parseFromString(`<office:document-${kind} ${xmlns}>${body}</office:document-${kind}>`, 'application/xml');
const text = d => d.getElementsByTagNameNS(NS.text, 'span')[0].firstChild;

describe('bounded ODP formatting preview', () => {
  it('resolves common parents and local text styles, while unsupported values suppress guessed inheritance', () => {
    const styles = doc('<office:styles><style:style style:name="Base" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-size="20pt" fo:color="#123456" fo:font-family="Arial"/></style:style></office:styles>', 'styles');
    const content = doc('<office:automatic-styles><style:style style:name="Local" style:family="text" style:parent-style-name="Base"><style:text-properties fo:font-style="italic" fo:font-size="150%"/></style:style></office:automatic-styles><office:body><text:p><text:span text:style-name="Local">Value</text:span></text:p></office:body>');
    const read = odpAppearanceReader(content, styles);
    expect(read(text(content), 'content.xml')).toEqual({ bold: true, italic: true, color: '#123456', fontFamily: 'Arial' });
    expect(read(text(content), 'content.xml')).toEqual(read(text(content), 'content.xml'));
  });
  it('bounds cyclic common parents, ignores ambiguous names and clears unsupported nested properties', () => {
    const styles = doc('<office:styles><style:style style:name="A" style:family="text" style:parent-style-name="B"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="B" style:family="text" style:parent-style-name="A"><style:text-properties fo:font-style="italic"/></style:style><style:style style:name="Duplicate" style:family="text"/><style:style style:name="Duplicate" style:family="text"/></office:styles>', 'styles');
    const content = doc('<office:automatic-styles><style:style style:name="P" style:family="paragraph"><style:text-properties fo:font-size="20pt" fo:color="#123456"/></style:style><style:style style:name="Child" style:family="text"><style:text-properties fo:font-weight="invalid" fo:font-style="oblique" fo:font-size="120%" fo:color="auto"/></style:style></office:automatic-styles><office:body><text:p text:style-name="P"><text:span text:style-name="A"><text:span text:style-name="Child">Value</text:span></text:span><text:span text:style-name="Duplicate">Other</text:span></text:p></office:body>');
    const read = odpAppearanceReader(content, styles), spans = content.getElementsByTagNameNS(NS.text, 'span');
    expect(read(spans[1].firstChild, 'content.xml')).toEqual({});
    expect(read(spans[2].firstChild, 'content.xml')).toEqual({ fontSize: 20, color: '#123456' });
  });
  it.each([['1in', 72], ['1pc', 12], ['2.54cm', 72], ['25.4mm', 72], ['24px', 18]])('reads absolute size %s', (size, expected) => {
    const content = doc(`<office:automatic-styles><style:style style:name="S" style:family="text"><style:text-properties fo:font-size="${size}"/></style:style></office:automatic-styles><text:p><text:span text:style-name="S">X</text:span></text:p>`);
    expect(odpAppearanceReader(content, doc('', 'styles'))(text(content), 'content.xml').fontSize).toBeCloseTo(expected);
  });
});

describe('ODP run-local writer', () => {
  it('inserts missing automatic styles before body, avoids declared and unresolved referenced names, and preserves original text nodes', () => {
    const d = doc('<office:body><text:p text:style-name="StagecraftRun1"><text:span text:style-name="StagecraftRun2"><![CDATA[raw  text]]></text:span></text:p></office:body>');
    const node = text(d), write = odpFormattingWriter(d, reservedOdpStyleNames(d));
    const name = write({ bold: false, italic: true, fontSize: 18.25 });
    expect(name).toBe('StagecraftRun3');
    patchOdp(node, node.data, name, false);
    expect(node.parentNode.localName).toBe('span'); expect(node.nodeType).toBe(4); expect(node.data).toBe('raw  text');
    expect(d.documentElement.firstElementChild.localName).toBe('automatic-styles');
    const props = d.getElementsByTagNameNS(NS.style, 'text-properties')[0];
    expect(props.getAttributeNS(NS.style, 'font-size-asian')).toBe('18.25pt');
    expect(props.getAttributeNS(NS.style, 'font-weight-complex')).toBe('normal');
    expect(write({ italic: false })).toBe('StagecraftRun4');
  });
  it('inserts automatic styles before master styles and refuses ambiguous sections', () => {
    const d = doc('<office:styles/><office:master-styles/>', 'styles');
    odpFormattingWriter(d, [])({ bold: true });
    expect(d.documentElement.children[1].localName).toBe('automatic-styles');
    const bad = doc('<office:automatic-styles/><office:automatic-styles/>');
    expect(() => odpFormattingWriter(bad, [])({ bold: true })).toThrow('Ambiguous');
  });
});
