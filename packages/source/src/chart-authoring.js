import JSZip from 'jszip';
import { validateChart } from '@stagecraft/core/document';
import { validText } from './xml.js';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const x = value => String(value).replace(/[&<>"'\r\n\t]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#13;', '\n': '&#10;', '\t': '&#9;' }[c]));
const colors = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
function validOptions(geometry, name, used) {
  if (!(used instanceof Set) || !geometry || !['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(geometry[k])) ||
      geometry.width <= 0 || geometry.height <= 0 || geometry.rotation !== undefined && geometry.rotation !== 0) throw new Error('INVALID_CHART_GEOMETRY');
  if (typeof name !== 'string' || name.length > 1000) throw new Error('INVALID_CHART_NAME');
  validText(name);
}
function packagePath(path) {
  if (typeof path !== 'string' || !path || /[\\\x00-\x20?#:%]/.test(path) || path.startsWith('/') || path.split('/').some(v => !v || v === '.' || v === '..')) throw new Error('INVALID_CHART_OWNER');
}
function relative(owner, target) {
  const a = owner.split('/'); a.pop(); const b = target.split('/');
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
  return '../'.repeat(a.length) + b.join('/');
}
function column(index) { let result = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; }
function points(values) { return `<c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${x(v)}</c:v></c:pt>`).join('')}`; }
function seriesXml(chart) {
  return chart.series.map((series, i) => {
    const col = column(i + 1), end = chart.categories.length + 1;
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f><c:strCache>${points([series.name])}</c:strCache></c:strRef></c:tx>` +
      (chart.kind === 'pie' ? '' : `<c:spPr>${chart.kind === 'line' ? `<a:ln w="28575"><a:solidFill><a:srgbClr val="${colors[i % colors.length]}"/></a:solidFill></a:ln>` : `<a:solidFill><a:srgbClr val="${colors[i % colors.length]}"/></a:solidFill>`}</c:spPr>`) +
      (chart.kind === 'line' ? '<c:marker><c:symbol val="none"/></c:marker>' : '') +
      `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${end}</c:f><c:strCache>${points(chart.categories)}</c:strCache></c:strRef></c:cat>` +
      `<c:val><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${end}</c:f><c:numCache><c:formatCode>General</c:formatCode>${points(series.values)}</c:numCache></c:numRef></c:val>` +
      (chart.kind === 'line' ? '<c:smooth val="0"/>' : '') + '</c:ser>';
  }).join('');
}
function chartXml(chart) {
  const tag = chart.kind === 'bar' ? 'barChart' : chart.kind === 'line' ? 'lineChart' : 'pieChart';
  const typeProps = chart.kind === 'bar' ? '<c:barDir val="col"/><c:grouping val="clustered"/>' : chart.kind === 'line' ? '<c:grouping val="standard"/>' : '';
  const typeEnd = chart.kind === 'pie' ? '<c:firstSliceAng val="0"/>' : `${chart.kind === 'bar' ? '<c:gapWidth val="150"/>' : ''}<c:axId val="100001"/><c:axId val="100002"/>`;
  const axes = chart.kind === 'pie' ? '' :
    '<c:catAx><c:axId val="100001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="100002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>' +
    '<c:valAx><c:axId val="100002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="100001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
  return XML + `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:${tag}>${typeProps}<c:varyColors val="${chart.kind === 'pie' ? 1 : 0}"/>${seriesXml(chart)}${typeEnd}</c:${tag}>${axes}</c:plotArea><c:legend><c:legendPos val="r"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}
async function workbook(chart) {
  const zip = new JSZip();
  const str = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(value.replace(/_x[0-9a-f]{4}_/gi, token => '_x005F_' + token.slice(1)))}</t></is></c>`;
  const rows = [`<row r="1">${str('A1', '')}${chart.series.map((v, i) => str(`${column(i + 1)}1`, v.name)).join('')}</row>`];
  chart.categories.forEach((category, i) => {
    const r = i + 2;
    rows.push(`<row r="${r}">${str(`A${r}`, category)}${chart.series.map((v, j) => `<c r="${column(j + 1)}${r}" t="n"><v>${v.values[i]}</v></c>`).join('')}</row>`);
  });
  zip.file('[Content_Types].xml', XML + `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file('_rels/.rels', XML + `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', XML + `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', XML + `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', XML + `<worksheet xmlns="${S}"><dimension ref="A1:${column(chart.series.length)}${chart.categories.length + 1}"/><sheetData>${rows.join('')}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
/** Generate isolated native parts; the caller applies package relationships/content types. */
export async function createPptxChartParts({ chart: input, geometry, nonVisualId, name = 'Chart', ownerPart, usedPartNames, usedRelationshipIds }) {
  const chart = validateChart(input);
  validOptions(geometry, name, usedPartNames); packagePath(ownerPart);
  geometry = { ...geometry };
  if (!(usedRelationshipIds instanceof Set) || !Number.isSafeInteger(nonVisualId) || nonVisualId < 1 || nonVisualId > 4294967295) throw new Error('INVALID_CHART_ID');
  let index = 1, chartPart, workbookPart, relPart;
  do {
    chartPart = `ppt/charts/stagecraftChart${index}.xml`;
    relPart = `ppt/charts/_rels/stagecraftChart${index}.xml.rels`;
    workbookPart = `ppt/embeddings/stagecraftChart${index}.xlsx`; index++;
  } while ([chartPart, relPart, workbookPart].some(path => usedPartNames.has(path)));
  let ridIndex = 1; while (usedRelationshipIds.has(`rIdStagecraftChart${ridIndex}`)) ridIndex++;
  const rid = `rIdStagecraftChart${ridIndex}`;
  // Reserve synchronously before the first await, including simultaneous chart exports.
  [chartPart, relPart, workbookPart].forEach(path => usedPartNames.add(path)); usedRelationshipIds.add(rid);
  const data = await workbook(chart);
  return {
    chartPart, workbookPart,
    relationship: { id: rid, type: `${R}/chart`, target: relative(ownerPart, chartPart) },
    frameXml: `<p:graphicFrame xmlns:p="${P}" xmlns:a="${A}" xmlns:c="${C}" xmlns:r="${R}"><p:nvGraphicFramePr><p:cNvPr id="${nonVisualId}" name="${x(name)}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${geometry.x}" y="${geometry.y}"/><a:ext cx="${geometry.width}" cy="${geometry.height}"/></p:xfrm><a:graphic><a:graphicData uri="${C}"><c:chart r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`,
    parts: [
      { path: chartPart, data: chartXml(chart), contentType: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml' },
      { path: relPart, data: XML + `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/package" Target="${relative(chartPart, workbookPart)}"/></Relationships>`, contentType: 'application/vnd.openxmlformats-package.relationships+xml' },
      { path: workbookPart, data, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ],
  };
}

const O = 'urn:oasis:names:tc:opendocument:xmlns:';
const odpNs = `xmlns:office="${O}office:1.0" xmlns:chart="${O}chart:1.0" xmlns:table="${O}table:1.0" xmlns:text="${O}text:1.0" xmlns:style="${O}style:1.0" xmlns:draw="${O}drawing:1.0" xmlns:svg="${O}svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:fo="${O}xsl-fo-compatible:1.0"`;
const cm = value => `${Number((value / 360000).toFixed(8))}cm`;
/** Native embedded ODF chart with local editable numeric table, never linked to a remote source. */
export function createOdpChartParts({ chart: input, geometry, name = 'Chart', usedPartNames }) {
  const chart = validateChart(input); validOptions(geometry, name, usedPartNames);
  let index = 1, objectPath;
  do { objectPath = `StagecraftChart${index++}/`; } while ([...usedPartNames].some(path => path === objectPath.slice(0, -1) || path.startsWith(objectPath)));
  const part = objectPath + 'content.xml', stylesPart = objectPath + 'styles.xml';
  [objectPath, part, stylesPart].forEach(path => usedPartNames.add(path));
  const cell = value => `<table:table-cell office:value-type="string" office:string-value="${x(value)}"><text:p>${x(value)}</text:p></table:table-cell>`;
  const table = `<table:table table:name="local-table"><table:table-header-columns><table:table-column/></table:table-header-columns><table:table-columns><table:table-column table:number-columns-repeated="${chart.series.length}"/></table:table-columns><table:table-header-rows><table:table-row>${cell('')}${chart.series.map(s => cell(s.name)).join('')}</table:table-row></table:table-header-rows><table:table-rows>${chart.categories.map((category, i) => `<table:table-row>${cell(category)}${chart.series.map(s => `<table:table-cell office:value-type="float" office:value="${s.values[i]}"><text:p>${s.values[i]}</text:p></table:table-cell>`).join('')}</table:table-row>`).join('')}</table:table-rows></table:table>`;
  const end = chart.categories.length + 1;
  const pointElements = chart.kind === 'pie'
    ? chart.categories.map((_, i) => `<chart:data-point chart:style-name="point${i}"/>`).join('')
    : `<chart:data-point chart:repeated="${chart.categories.length}"/>`;
  const pointStyles = chart.kind === 'pie'
    ? chart.categories.map((_, i) => `<style:style style:name="point${i}" style:family="chart"><style:graphic-properties draw:fill="solid" draw:fill-color="#${colors[i % colors.length]}"/></style:style>`).join('')
    : '';
  const series = chart.series.map((s, i) => `<chart:series chart:attached-axis="primary-y" chart:class="chart:${chart.kind === 'pie' ? 'circle' : chart.kind}" chart:style-name="series${i}" chart:values-cell-range-address="local-table.$${column(i + 1)}$2:.$${column(i + 1)}$${end}" chart:label-cell-address="local-table.$${column(i + 1)}$1">${pointElements}</chart:series>`).join('');
  // PowerPoint's ODF chart loader requires an explicit chart root style and automatic plot
  // positioning when no plot coordinates are supplied. Match its saved native chart structure.
  const rootStyle = `<style:style style:name="main" style:family="chart"><style:chart-properties chart:three-dimensional="false" chart:stacked="false" chart:percentage="false"/><style:graphic-properties draw:fill="none" draw:stroke="none"/><style:text-properties fo:font-size="10pt" fo:color="#000000"/></style:style>`;
  const styles = `<style:style style:name="plot" style:family="chart"><style:chart-properties chart:auto-position="true" chart:series-source="columns" chart:vertical="false"/></style:style>${chart.series.map((s, i) => `<style:style style:name="series${i}" style:family="chart"><style:chart-properties chart:symbol-type="none"/><style:graphic-properties draw:fill="solid" draw:fill-color="#${colors[i % colors.length]}" draw:stroke="solid" svg:stroke-color="#${colors[i % colors.length]}" svg:stroke-width="0.08cm"/></style:style>`).join('')}`;
  const axes = `<chart:axis chart:dimension="x" chart:name="primary-x"><chart:categories table:cell-range-address="local-table.$A$2:.$A$${end}"/></chart:axis><chart:axis chart:dimension="y" chart:name="primary-y"/>`;
  const content = XML + `<office:document-content ${odpNs} office:version="1.3"><office:automatic-styles>${rootStyle}${styles}${pointStyles}</office:automatic-styles><office:body><office:chart><chart:chart chart:style-name="main" chart:class="chart:${chart.kind === 'pie' ? 'circle' : chart.kind}" svg:width="${cm(geometry.width)}" svg:height="${cm(geometry.height)}"><chart:legend chart:legend-position="end"/><chart:plot-area chart:style-name="plot" chart:data-source-has-labels="both">${axes}${series}</chart:plot-area>${table}</chart:chart></office:chart></office:body></office:document-content>`;
  return {
    objectPath,
    frameXml: `<draw:frame ${odpNs} draw:name="${x(name)}" svg:x="${cm(geometry.x)}" svg:y="${cm(geometry.y)}" svg:width="${cm(geometry.width)}" svg:height="${cm(geometry.height)}"><draw:object xlink:href="${objectPath}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`,
    parts: [{ path: part, data: content, contentType: 'text/xml' }, {
      path: stylesPart,
      data: XML + `<office:document-styles ${odpNs} office:version="1.3"><office:styles><style:default-style style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#4472c4" draw:opacity="100%" draw:stroke="solid" svg:stroke-width="0.01389in" svg:stroke-color="#172c51" svg:stroke-opacity="100%" draw:stroke-linejoin="miter" svg:stroke-linecap="butt"/></style:default-style></office:styles></office:document-styles>`,
      contentType: 'text/xml',
    }],
    manifestEntries: [{ path: objectPath, mediaType: 'application/vnd.oasis.opendocument.chart' }, { path: part, mediaType: 'text/xml' }, { path: stylesPart, mediaType: 'text/xml' }],
  };
}

const elements = node => Array.from(node?.childNodes ?? []).filter(child => child.nodeType === 1);
const direct = (node, ns, name) => elements(node).filter(child => child.namespaceURI === ns && child.localName === name);
function only(node, ns, name) { const list = direct(node, ns, name); if (list.length !== 1) throw Error('UNSUPPORTED_CHART'); return list[0]; }
function numberText(value) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw Error('UNSUPPORTED_CHART');
  return Number(value);
}
function cacheValues(ref, name, numeric = false) {
  const cache = only(ref, C, name), count = only(cache, C, 'ptCount').getAttribute('val');
  if (!/^(?:[1-9]|[1-9]\d|100)$/.test(count)) throw Error('UNSUPPORTED_CHART');
  const points = direct(cache, C, 'pt');
  if (points.length !== Number(count)) throw Error('UNSUPPORTED_CHART');
  const result = new Array(Number(count)), seen = new Set();
  for (const point of points) {
    const index = point.getAttribute('idx');
    if (!/^(?:0|[1-9]\d*)$/.test(index) || Number(index) >= result.length || seen.has(index)) throw Error('UNSUPPORTED_CHART');
    seen.add(index);
    const value = only(point, C, 'v').textContent;
    result[Number(index)] = numeric ? numberText(value) : value;
  }
  return result;
}
/** Read the isolated local cached subset authored above. Never resolves a workbook relationship. */
export function readPptxChartData(document) {
  try {
    const root = document?.documentElement;
    if (root?.namespaceURI !== C || root.localName !== 'chartSpace') return null;
    const plot = only(only(root, C, 'chart'), C, 'plotArea');
    const charts = elements(plot).filter(node => node.namespaceURI === C && /Chart$/.test(node.localName));
    if (charts.length !== 1 || !['barChart', 'lineChart', 'pieChart'].includes(charts[0].localName)) return null;
    const kind = charts[0].localName.replace('Chart', ''), items = direct(charts[0], C, 'ser');
    if (items.length < 1 || items.length > 20) return null;
    if (kind === 'bar' && (only(charts[0], C, 'barDir').getAttribute('val') !== 'col' || only(charts[0], C, 'grouping').getAttribute('val') !== 'clustered')) return null;
    if (kind === 'line' && only(charts[0], C, 'grouping').getAttribute('val') !== 'standard') return null;
    let categories;
    const series = items.map((item, i) => {
      if (only(item, C, 'idx').getAttribute('val') !== String(i) || only(item, C, 'order').getAttribute('val') !== String(i)) throw Error('UNSUPPORTED_CHART');
      const tx = only(only(item, C, 'tx'), C, 'strRef');
      const cat = only(only(item, C, 'cat'), C, 'strRef');
      const val = only(only(item, C, 'val'), C, 'numRef');
      const labels = cacheValues(tx, 'strCache'), cats = cacheValues(cat, 'strCache'), values = cacheValues(val, 'numCache', true);
      if (labels.length !== 1 || values.length !== cats.length) throw Error('UNSUPPORTED_CHART');
      const col = column(i + 1), end = cats.length + 1;
      if (only(tx, C, 'f').textContent !== `Sheet1!$${col}$1` || only(cat, C, 'f').textContent !== `Sheet1!$A$2:$A$${end}` ||
          only(val, C, 'f').textContent !== `Sheet1!$${col}$2:$${col}$${end}` || categories && JSON.stringify(categories) !== JSON.stringify(cats)) throw Error('UNSUPPORTED_CHART');
      categories = cats;
      return { name: labels[0], values };
    });
    return validateChart({ kind, categories, series });
  } catch { return null; }
}
/** Read only a local ODF data table with explicit supported series references; no fetches. */
export function readOdpChartData(document) {
  try {
    const chartNs = O + 'chart:1.0', tableNs = O + 'table:1.0', officeNs = O + 'office:1.0';
    const charts = Array.from(document.getElementsByTagNameNS(chartNs, 'chart'));
    if (charts.length !== 1) return null;
    const chart = charts[0], cls = chart.getAttributeNS(chartNs, 'class');
    const kind = ({ 'chart:bar': 'bar', 'chart:line': 'line', 'chart:circle': 'pie' })[cls];
    if (!kind || chart.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) return null;
    const plot = only(chart, chartNs, 'plot-area'), seriesNodes = direct(plot, chartNs, 'series');
    if (seriesNodes.length < 1 || seriesNodes.length > 20) return null;
    const table = only(chart, tableNs, 'table');
    if (table.getAttributeNS(tableNs, 'name') !== 'local-table' || table.getElementsByTagNameNS(tableNs, 'table').length) return null;
    const rows = Array.from(table.getElementsByTagNameNS(tableNs, 'table-row'));
    if (rows.length < 2 || rows.length > 101) return null;
    const cells = rows.map(row => {
      if (row.hasAttributeNS(tableNs, 'number-rows-repeated')) throw Error('UNSUPPORTED_CHART');
      const result = direct(row, tableNs, 'table-cell');
      if (result.length !== seriesNodes.length + 1 || result.length !== elements(row).length || result.some(cell => cell.hasAttributeNS(tableNs, 'number-columns-repeated') || cell.hasAttributeNS(tableNs, 'formula'))) throw Error('UNSUPPORTED_CHART');
      return result;
    });
    const range = value => {
      const match = /^local-table\.\$?([A-U])\$?([1-9]\d{0,2})(?::\.?\$?([A-U])\$?([1-9]\d{0,2}))?$/.exec(value);
      return match ? `local-table.${match[1]}${match[2]}${match[3] ? `:${match[3]}${match[4]}` : ''}` : '';
    };
    const label = cell => {
      if (cell.getAttributeNS(officeNs, 'value-type') !== 'string' || !cell.hasAttributeNS(officeNs, 'string-value')) throw Error('UNSUPPORTED_CHART');
      return cell.getAttributeNS(officeNs, 'string-value');
    };
    const categories = cells.slice(1).map(row => label(row[0]));
    const axes = direct(plot, chartNs, 'axis').filter(axis => axis.getAttributeNS(chartNs, 'dimension') === 'x');
    if (axes.length !== 1 || range(only(axes[0], chartNs, 'categories').getAttributeNS(tableNs, 'cell-range-address')) !== `local-table.A2:A${rows.length}`) return null;
    const series = seriesNodes.map((node, i) => {
      const col = column(i + 1);
      if (node.getAttributeNS(chartNs, 'class') !== cls || range(node.getAttributeNS(chartNs, 'values-cell-range-address')) !== `local-table.${col}2:${col}${rows.length}` ||
          range(node.getAttributeNS(chartNs, 'label-cell-address')) !== `local-table.${col}1`) throw Error('UNSUPPORTED_CHART');
      return { name: label(cells[0][i + 1]), values: cells.slice(1).map(row => {
        const cell = row[i + 1];
        if (cell.getAttributeNS(officeNs, 'value-type') !== 'float') throw Error('UNSUPPORTED_CHART');
        return numberText(cell.getAttributeNS(officeNs, 'value'));
      }) };
    });
    return validateChart({ kind, categories, series });
  } catch { return null; }
}
