import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createPptxChartParts, createOdpChartParts, readPptxChartData, readOdpChartData } from './chart-authoring.js';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const O = 'urn:oasis:names:tc:opendocument:xmlns:';
const geometry = { x: 360000, y: 720000, width: 3600000, height: 2160000 };
const data = kind => ({ kind, categories: [' A & <B> ', '=1+1'], series: [{ name: 'Sales "2026"', values: [1, 2.5] }, ...(kind === 'pie' ? [] : [{ name: 'Second', values: [-2, 4] }])] });
const options = kind => ({ chart: data(kind), geometry, nonVisualId: 5, name: 'Chart "<&', ownerPart: 'ppt/slides/slide1.xml', usedPartNames: new Set(), usedRelationshipIds: new Set() });
function parse(value) {
  const doc = new DOMParser().parseFromString(value, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull(); return doc;
}
const nodes = (doc, ns, name) => [...doc.getElementsByTagNameNS(ns, name)];
describe('native PPTX authored chart parts', () => {
  for (const kind of ['bar', 'line', 'pie']) it(`creates editable ${kind} charts with consistent cache/formula/workbook data`, async () => {
    const result = await createPptxChartParts(options(kind));
    const chart = parse(result.parts.find(p => p.path === result.chartPart).data);
    expect(nodes(chart, C, `${kind}Chart`)).toHaveLength(1);
    expect(nodes(chart, C, 'ser')).toHaveLength(data(kind).series.length);
    expect(nodes(chart, C, 'strCache')[0].textContent).toContain('Sales "2026"');
    expect(nodes(chart, C, 'cat')[0].textContent).toContain(' A & <B> ');
    expect(nodes(chart, C, 'f').map(n => n.textContent)).toContain('Sheet1!$B$2:$B$3');
    expect(nodes(chart, C, 'externalData')[0].getAttributeNS(R, 'id')).toBe('rId1');
    expect(nodes(chart, C, 'autoUpdate')[0].getAttribute('val')).toBe('0');
    expect(nodes(chart, C, 'catAx')).toHaveLength(kind === 'pie' ? 0 : 1);
    const frame = parse(result.frameXml);
    expect(nodes(frame, C, 'chart')[0].getAttributeNS(R, 'id')).toBe(result.relationship.id);
    expect(result.relationship.target).toBe('../charts/stagecraftChart1.xml');
    expect(result.parts.find(p => p.path.endsWith('.rels')).data).toContain('Target="../embeddings/stagecraftChart1.xlsx"');
    expect(result.parts.find(p => p.path.endsWith('.rels')).data).not.toContain('TargetMode="External"');
    const xlsx = await JSZip.loadAsync(result.parts.find(p => p.path === result.workbookPart).data);
    const sheet = parse(await xlsx.file('xl/worksheets/sheet1.xml').async('string'));
    const cells = nodes(sheet, S, 'c');
    expect(cells.find(n => n.getAttribute('r') === 'A2').textContent).toBe(' A & <B> ');
    expect(cells.find(n => n.getAttribute('r') === 'A3').getAttribute('t')).toBe('inlineStr');
    expect(cells.find(n => n.getAttribute('r') === 'A3').textContent).toBe('=1+1');
    expect(cells.find(n => n.getAttribute('r') === 'B3').textContent).toBe('2.5');
    expect(nodes(sheet, S, 'f')).toHaveLength(0);
    expect(Object.keys(xlsx.files).some(path => /externalLinks/.test(path))).toBe(false);
    for (const entry of Object.values(xlsx.files).filter(f => !f.dir && /\.xml$|\.rels$/.test(f.name))) parse(await entry.async('string'));
  });
  it('reserves part names and relationship IDs before async workbook creation', async () => {
    const shared = options('bar'); shared.usedPartNames.add('ppt/embeddings/stagecraftChart1.xlsx'); shared.usedRelationshipIds.add('rIdStagecraftChart1');
    const [first, second] = await Promise.all([createPptxChartParts(shared), createPptxChartParts(shared)]);
    expect(first.chartPart).toBe('ppt/charts/stagecraftChart2.xml'); expect(second.chartPart).toBe('ppt/charts/stagecraftChart3.xml');
    expect(first.relationship.id).not.toBe(second.relationship.id);
    expect(new Set([...first.parts, ...second.parts].map(p => p.path)).size).toBe(6);
  });
  it('preserves XML whitespace and protects literal SpreadsheetML escape sequences', async () => {
    const args = options('pie'); args.chart.categories = ['line\r\n\t<&', '_x0041_'];
    const result = await createPptxChartParts(args);
    const chart = parse(result.parts[0].data); expect(nodes(chart, C, 'cat')[0].textContent).toContain('line\r\n\t<&');
    const xlsx = await JSZip.loadAsync(result.parts[2].data);
    const sheet = parse(await xlsx.file('xl/worksheets/sheet1.xml').async('string'));
    expect(nodes(sheet, S, 't').map(n => n.textContent)).toContain('_x005F_x0041_');
  });
  it('rejects invalid options before reserving or generating parts', async () => {
    for (const patch of [{ ownerPart: '../slide.xml' }, { geometry: { ...geometry, rotation: 15 } }, { nonVisualId: 0 }, { name: '\u0000' }]) {
      const args = { ...options('bar'), ...patch };
      await expect(createPptxChartParts(args)).rejects.toThrow(); expect(args.usedPartNames.size).toBe(0);
    }
  });
});
describe('native ODP authored chart objects', () => {
  for (const kind of ['bar', 'line', 'pie']) it(`embeds editable ${kind} data tables and local series references`, () => {
    const result = createOdpChartParts(options(kind));
    const doc = parse(result.parts[0].data), chartNs = O + 'chart:1.0', tableNs = O + 'table:1.0';
    const chart = nodes(doc, chartNs, 'chart')[0]; expect(chart.getAttributeNS(chartNs, 'class')).toBe('chart:' + (kind === 'pie' ? 'circle' : kind));
    expect(nodes(doc, chartNs, 'series')).toHaveLength(data(kind).series.length);
    expect(nodes(doc, chartNs, 'series')[0].getAttributeNS(chartNs, 'values-cell-range-address')).toBe('local-table.$B$2:.$B$3');
    expect(nodes(doc, tableNs, 'table')).toHaveLength(1);
    expect(nodes(doc, tableNs, 'table-cell').some(n => n.getAttributeNS(O + 'office:1.0', 'string-value') === ' A & <B> ')).toBe(true);
    expect(nodes(doc, tableNs, 'table-cell').some(n => n.getAttributeNS(O + 'office:1.0', 'value') === '2.5')).toBe(true);
    const frame = parse(result.frameXml);
    expect(nodes(frame, O + 'drawing:1.0', 'object')[0].getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('StagecraftChart1/');
    expect(result.manifestEntries).toContainEqual({ path: 'StagecraftChart1/', mediaType: 'application/vnd.oasis.opendocument.chart' });
    expect(nodes(doc, '*', 'binary-data')).toHaveLength(0);
  });
  it('avoids any occupied embedded object directory and rejects rotation', () => {
    const args = options('bar'); args.usedPartNames.add('StagecraftChart1/settings.xml');
    expect(createOdpChartParts(args).objectPath).toBe('StagecraftChart2/');
    expect(createOdpChartParts(args).objectPath).toBe('StagecraftChart3/');
    expect(() => createOdpChartParts({ ...options('bar'), geometry: { ...geometry, rotation: 1 } })).toThrow('INVALID_CHART_GEOMETRY');
  });
});

describe('bounded native chart readers', () => {
  for (const kind of ['bar', 'line', 'pie']) it(`round trips authored ${kind} data through both native formats`, async () => {
    const pptx = await createPptxChartParts(options(kind));
    expect(readPptxChartData(parse(pptx.parts[0].data))).toEqual(data(kind));
    const odp = createOdpChartParts(options(kind));
    expect(readOdpChartData(parse(odp.parts[0].data))).toEqual(data(kind));
  });
  it('reads indexed PPTX caches independent of XML point order but rejects duplicate/missing indexes', async () => {
    const pptx = await createPptxChartParts(options('bar'));
    const doc = parse(pptx.parts[0].data), cache = nodes(doc, C, 'numCache')[0], pts = nodes(cache, C, 'pt');
    cache.appendChild(pts[0]); expect(readPptxChartData(doc)).toEqual(data('bar'));
    pts[0].setAttribute('idx', '1'); expect(readPptxChartData(doc)).toBeNull();
    pts[0].setAttribute('idx', '0'); cache.removeChild(pts[0]); expect(readPptxChartData(doc)).toBeNull();
  });
  it('rejects external or inconsistent chart formulas, unsupported classes and numeric coercion', async () => {
    const pptx = await createPptxChartParts(options('line'));
    const external = parse(pptx.parts[0].data); nodes(external, C, 'f')[0].textContent = '[http://evil/book.xlsx]Sheet1!$B$1';
    expect(readPptxChartData(external)).toBeNull();
    const mismatched = parse(pptx.parts[0].data); nodes(mismatched, C, 'strCache')[3].lastElementChild.lastElementChild.textContent = 'different category';
    expect(readPptxChartData(mismatched)).toBeNull();
    const invalid = parse(pptx.parts[0].data); nodes(nodes(invalid, C, 'numCache')[0], C, 'v')[0].textContent = ' ';
    expect(readPptxChartData(invalid)).toBeNull();
    expect(readPptxChartData(parse(pptx.parts[0].data.replaceAll('lineChart', 'scatterChart')))).toBeNull();
  });
  it('rejects nonlocal ODF tables, inconsistent dimensions, repeated cells and formulas', () => {
    const text = createOdpChartParts(options('bar')).parts[0].data;
    for (const mutated of [text.replace('chart:bar', 'chart:scatter'), text.replace('local-table.$B$2:.$B$3', 'External.B2:B3'),
      text.replace('office:value="1"', 'office:value="NaN"'), text.replace('<table:table-row>', '<table:table-row table:number-rows-repeated="2">'),
      text.replace('office:value="1"', 'office:value="1" table:formula="of:=1"')]) expect(readOdpChartData(parse(mutated))).toBeNull();
    const missing = parse(text), cell = nodes(missing, O + 'table:1.0', 'table-cell')[1]; cell.remove(); expect(readOdpChartData(missing)).toBeNull();
    expect(readOdpChartData(parse('<root/>'))).toBeNull(); expect(readPptxChartData(parse('<root/>'))).toBeNull();
  });
});

it('emits complete native ODF embedding and explicit automatic chart layout', () => {
  const result = createOdpChartParts(options('bar'));
  const doc = parse(result.parts[0].data), chartNs = O + 'chart:1.0', styleNs = O + 'style:1.0';
  const styles = new Map(nodes(doc, styleNs, 'style').map(n => [n.getAttributeNS(styleNs, 'name'), n]));
  const root = nodes(doc, chartNs, 'chart')[0], plot = nodes(doc, chartNs, 'plot-area')[0];
  expect(styles.has(root.getAttributeNS(chartNs, 'style-name'))).toBe(true);
  const layout = styles.get(plot.getAttributeNS(chartNs, 'style-name'));
  expect(nodes(layout, styleNs, 'chart-properties')[0].getAttributeNS(chartNs, 'auto-position')).toBe('true');
  const stylePart = result.parts.find(part => part.path === result.objectPath + 'styles.xml');
  expect(parse(stylePart.data).documentElement.localName).toBe('document-styles');
  expect(result.manifestEntries).toContainEqual({ path: stylePart.path, mediaType: 'text/xml' });
  const reference = nodes(parse(result.frameXml), O + 'drawing:1.0', 'object')[0].getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  expect(reference).toBe(result.objectPath);
});

// PowerPoint silently drops a circle chart when the Y axis/series attachment is absent,
// despite the reduced chart being accepted by the general ODF schema.
it('keeps the native axis attachment required to load editable ODF pie charts', () => {
  const result = createOdpChartParts(options('pie')), doc = parse(result.parts[0].data);
  const chartNs = O + 'chart:1.0';
  expect(nodes(doc, chartNs, 'axis').find(n => n.getAttributeNS(chartNs, 'dimension') === 'y')?.getAttributeNS(chartNs, 'name')).toBe('primary-y');
  expect(nodes(doc, chartNs, 'series')[0].getAttributeNS(chartNs, 'attached-axis')).toBe('primary-y');
  expect(readOdpChartData(doc)).toEqual(data('pie'));
});
