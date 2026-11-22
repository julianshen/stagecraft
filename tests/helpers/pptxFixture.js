// Builds minimal-but-valid .pptx packages in memory for the importer tests — the
// OOXML parts PowerPoint itself writes, trimmed to what the importer reads.
import JSZip from 'jszip';

export const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (list) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
  list.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`).join('')}</Relationships>`;

export const tree = (inner) => `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree></p:cSld>`;

// EMU helpers: on the default 13.333in-wide slide, 1px of the 1920 canvas = 6350 EMU.
export const PX = 6350;
export const xfrm = (x, y, w, h, extra = '') => `<a:xfrm${extra}><a:off x="${x * PX}" y="${y * PX}"/><a:ext cx="${w * PX}" cy="${h * PX}"/></a:xfrm>`;

export const DEFAULT_THEME = `<a:theme ${NS} name="T"><a:themeElements><a:clrScheme name="C">
  <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
  <a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
  <a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
  </a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>
  </a:themeElements></a:theme>`;

export const DEFAULT_MASTER = `<p:sldMaster ${NS}>${tree(`
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
    <p:spPr>${xfrm(100, 50, 1720, 150)}</p:spPr></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
    <p:spPr>${xfrm(100, 250, 1720, 700)}</p:spPr></p:sp>`)}
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"/>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>
      <a:lvl2pPr><a:buChar char="–"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle>
    <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
  </p:txStyles></p:sldMaster>`;

export const DEFAULT_LAYOUT = `<p:sldLayout ${NS}>${tree('')}</p:sldLayout>`;

export const slideXml = (inner, { attrs = '', after = '', bg = '' } = {}) =>
  `<p:sld ${NS}${attrs}>${bg ? tree(inner).replace('<p:cSld>', `<p:cSld>${bg}`) : tree(inner)}${after}</p:sld>`;

/**
 * slides: [{ xml, notes?, media?: { name, data }[], extraRels?: [id,type,target,mode][] }]
 * Each slide's rId1 is its layout; media are rId10+ in order; notes is rIdN.
 */
export async function buildPptx({
  slides = [], size = { cx: 12192000, cy: 6858000 }, theme = DEFAULT_THEME, master = DEFAULT_MASTER,
  layout = DEFAULT_LAYOUT, layoutRels = [], masterRels = [], core = null, sections = null, media = {},
} = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const ids = slides.map((_, i) => 256 + i);
  const sectionXml = sections ? `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${
    sections.map((s) => `<p14:section name="${s.name}" id="{X}"><p14:sldIdLst>${s.slides.map((i) => `<p14:sldId id="${ids[i]}"/>`).join('')}</p14:sldIdLst></p14:section>`).join('')
  }</p14:sectionLst></p:ext></p:extLst>` : '';
  zip.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${
    ids.map((id, i) => `<p:sldId id="${id}" r:id="rIdS${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${size.cx}" cy="${size.cy}"/>${sectionXml}</p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', rels([['rIdM', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ...slides.map((_, i) => [`rIdS${i + 1}`, 'slide', `slides/slide${i + 1}.xml`])]));
  zip.file('ppt/slideMasters/slideMaster1.xml', master);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme1.xml'], ...masterRels]));
  zip.file('ppt/theme/theme1.xml', theme);
  zip.file('ppt/slideLayouts/slideLayout1.xml', layout);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml'], ...layoutRels]));
  for (const [name, data] of Object.entries(media)) zip.file(`ppt/media/${name}`, data);
  slides.forEach((s, i) => {
    const n = i + 1;
    const list = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ...(s.extraRels || [])];
    if (s.notes != null) {
      list.push(['rIdN', 'notesSlide', `../notesSlides/notesSlide${n}.xml`]);
      zip.file(`ppt/notesSlides/notesSlide${n}.xml`, `<p:notes ${NS}>${tree(`
        <p:sp><p:nvSpPr><p:cNvPr id="2" name="Img"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
        <p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
          <p:txBody><a:bodyPr/>${s.notes.split('\n').map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`)}</p:notes>`);
    }
    zip.file(`ppt/slides/slide${n}.xml`, s.xml);
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels(list));
  });
  if (core) {
    zip.file('docProps/core.xml', `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${
      core.title ? `<dc:title>${core.title}</dc:title>` : ''}${core.creator ? `<dc:creator>${core.creator}</dc:creator>` : ''}</cp:coreProperties>`);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

// A text-box shape (txBox) with given runs/paragraph XML.
export const textBox = (id, x, y, w, h, parasXml, { spPr = '', bodyPr = '<a:bodyPr/>' } = {}) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>${spPr}</p:spPr>
    <p:txBody>${bodyPr}${parasXml}</p:txBody></p:sp>`;
// rPr: run attributes (' sz="2400" b="1"'); rKids: run-property children (fill, font).
export const para = (text, { rPr = '', rKids = '', pPr = '' } = {}) =>
  `<a:p>${pPr}<a:r><a:rPr lang="en-US"${rPr}>${rKids}</a:rPr><a:t>${text}</a:t></a:r></a:p>`;
export const shape = (id, prst, x, y, w, h, spPrExtra = '', extra = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="S${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${spPrExtra}</p:spPr>${extra}</p:sp>`;
