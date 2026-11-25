import JSZip from 'jszip';
import { NS, validText } from './xml.js';

const escapeXml = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const PPTX_SUPPLEMENTAL_FONTS = {
  major: [
    ['Jpan', '游ゴシック Light'], ['Hang', '맑은 고딕'], ['Hans', '等线 Light'], ['Hant', '新細明體'],
    ['Arab', 'Times New Roman'], ['Hebr', 'Times New Roman'], ['Thai', 'Angsana New'], ['Ethi', 'Nyala'],
    ['Beng', 'Vrinda'], ['Gujr', 'Shruti'], ['Khmr', 'MoolBoran'], ['Knda', 'Tunga'],
    ['Guru', 'Raavi'], ['Cans', 'Euphemia'], ['Cher', 'Plantagenet Cherokee'], ['Yiii', 'Microsoft Yi Baiti'],
    ['Tibt', 'Microsoft Himalaya'], ['Thaa', 'MV Boli'], ['Deva', 'Mangal'], ['Telu', 'Gautami'],
    ['Taml', 'Latha'], ['Syrc', 'Estrangelo Edessa'], ['Orya', 'Kalinga'], ['Mlym', 'Kartika'],
    ['Laoo', 'DokChampa'], ['Sinh', 'Iskoola Pota'], ['Mong', 'Mongolian Baiti'], ['Viet', 'Times New Roman'],
    ['Uigh', 'Microsoft Uighur'], ['Geor', 'Sylfaen'], ['Armn', 'Arial'], ['Bugi', 'Leelawadee UI'],
    ['Bopo', 'Microsoft JhengHei'], ['Java', 'Javanese Text'], ['Lisu', 'Segoe UI'], ['Mymr', 'Myanmar Text'],
    ['Nkoo', 'Ebrima'], ['Olck', 'Nirmala UI'], ['Osma', 'Ebrima'], ['Phag', 'Phagspa'],
    ['Syrn', 'Estrangelo Edessa'], ['Syrj', 'Estrangelo Edessa'], ['Syre', 'Estrangelo Edessa'], ['Sora', 'Nirmala UI'],
    ['Tale', 'Microsoft Tai Le'], ['Talu', 'Microsoft New Tai Lue'], ['Tfng', 'Ebrima'],
  ],
  minor: [
    ['Jpan', '游ゴシック'], ['Hang', '맑은 고딕'], ['Hans', '等线'], ['Hant', '新細明體'],
    ['Arab', 'Arial'], ['Hebr', 'Arial'], ['Thai', 'Cordia New'], ['Ethi', 'Nyala'],
    ['Beng', 'Vrinda'], ['Gujr', 'Shruti'], ['Khmr', 'DaunPenh'], ['Knda', 'Tunga'],
    ['Guru', 'Raavi'], ['Cans', 'Euphemia'], ['Cher', 'Plantagenet Cherokee'], ['Yiii', 'Microsoft Yi Baiti'],
    ['Tibt', 'Microsoft Himalaya'], ['Thaa', 'MV Boli'], ['Deva', 'Mangal'], ['Telu', 'Gautami'],
    ['Taml', 'Latha'], ['Syrc', 'Estrangelo Edessa'], ['Orya', 'Kalinga'], ['Mlym', 'Kartika'],
    ['Laoo', 'DokChampa'], ['Sinh', 'Iskoola Pota'], ['Mong', 'Mongolian Baiti'], ['Viet', 'Arial'],
    ['Uigh', 'Microsoft Uighur'], ['Geor', 'Sylfaen'], ['Armn', 'Arial'], ['Bugi', 'Leelawadee UI'],
    ['Bopo', 'Microsoft JhengHei'], ['Java', 'Javanese Text'], ['Lisu', 'Segoe UI'], ['Mymr', 'Myanmar Text'],
    ['Nkoo', 'Ebrima'], ['Olck', 'Nirmala UI'], ['Osma', 'Ebrima'], ['Phag', 'Phagspa'],
    ['Syrn', 'Estrangelo Edessa'], ['Syrj', 'Estrangelo Edessa'], ['Syre', 'Estrangelo Edessa'], ['Sora', 'Nirmala UI'],
    ['Tale', 'Microsoft Tai Le'], ['Talu', 'Microsoft New Tai Lue'], ['Tfng', 'Ebrima'],
  ],
};

const fontGroupXml = (tag, latin, supplemental) => (
  `<a:${tag}><a:latin typeface="${latin}"/><a:ea typeface=""/><a:cs typeface=""/>${
    supplemental.map(([script, typeface]) => `<a:font script="${script}" typeface="${typeface}"/>`).join('')
  }</a:${tag}>`
);

function buildPptxTemplate(title) {
  const zip = new JSZip();
  const relOffice = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relCore = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
  const emptySpTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${NS.ct}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.rel}">
  <Relationship Id="rId1" Type="${relOffice}/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="${relCore}" Target="docProps/core.xml"/>
</Relationships>`);

  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>Stagecraft</dc:creator>
</cp:coreProperties>`);

  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.rel}">
  <Relationship Id="rId1" Type="${relOffice}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="${relOffice}/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="${relOffice}/theme" Target="theme/theme1.xml"/>
</Relationships>`);

  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500"/>
  <p:notesSz cx="5143500" cy="9144000"/>
  <p:defaultTextStyle/>
</p:presentation>`);

  zip.file('ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${NS.a}" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      ${fontGroupXml('majorFont', 'Calibri Light', PPTX_SUPPLEMENTAL_FONTS.major)}
      ${fontGroupXml('minorFont', 'Calibri', PPTX_SUPPLEMENTAL_FONTS.minor)}
    </a:fontScheme>
    <a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
</a:theme>`);

  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.rel}">
  <Relationship Id="rId1" Type="${relOffice}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="${relOffice}/theme" Target="../theme/theme1.xml"/>
</Relationships>`);

  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld>${emptySpTree}</p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:otherStyle/></p:txStyles>
</p:sldMaster>`);

  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.rel}">
  <Relationship Id="rId1" Type="${relOffice}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);

  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" preserve="1">
  <p:cSld name="Blank">${emptySpTree}</p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`);

  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.rel}">
  <Relationship Id="rId1" Type="${relOffice}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`);

  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld name="Slide 1">${emptySpTree}</p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`);

  return zip.generateAsync({ type: 'uint8array' });
}

function buildOdpTemplate() {
  const zip = new JSZip();
  const odpMime = 'application/vnd.oasis.opendocument.presentation';
  const odpNs = `xmlns:office="${NS.office}" xmlns:draw="${NS.draw}" xmlns:text="${NS.text}" xmlns:svg="${NS.svg}" xmlns:style="${NS.style}" xmlns:fo="${NS.fo}" xmlns:presentation="${NS.presentation}" xmlns:manifest="${NS.manifest}" office:version="1.3"`;

  zip.file('mimetype', odpMime, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="${NS.manifest}" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${odpMime}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`);

  zip.file('styles.xml', `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${odpNs}>
  <office:styles/>
  <office:automatic-styles>
    <style:page-layout style:name="Page">
      <style:page-layout-properties fo:page-width="20in" fo:page-height="11.25in" style:print-orientation="landscape"/>
    </style:page-layout>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Default" style:page-layout-name="Page"/>
  </office:master-styles>
</office:document-styles>`);

  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${odpNs}>
  <office:automatic-styles/>
  <office:body>
    <office:presentation>
      <draw:page draw:name="Slide 1" draw:master-page-name="Default"/>
    </office:presentation>
  </office:body>
</office:document-content>`);

  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildMinimalPresentation({ format, title = 'Untitled' }) {
  if (typeof title !== 'string') throw new TypeError('Presentation title must be a string');
  validText(title);
  if (format === 'pptx') return buildPptxTemplate(title);
  if (format === 'odp') return buildOdpTemplate();
  throw new Error(`Unsupported presentation format: ${format}`);
}
