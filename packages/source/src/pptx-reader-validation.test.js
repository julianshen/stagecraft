import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { readPptx } from './pptx.js';
import { NS, runtime } from './xml.js';
const relType='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const rel=(id,type,target,extra='')=>`<Relationship Id="${id}" Type="${relType}${type}" Target="${target}" ${extra}/>`;
const rels=body=>`<Relationships xmlns="${NS.rel}">${body}</Relationships>`;
const slide=body=>`<p:sld xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
function fixture(body='') {
  const zip=new JSZip();
  zip.file('[Content_Types].xml',`<Types xmlns="${NS.ct}"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
  zip.file('_rels/.rels',rels(rel('office','officeDocument','ppt/presentation.xml')));
  zip.file('ppt/presentation.xml',`<p:presentation xmlns:p="${NS.p}" xmlns:r="${NS.r}"><p:sldIdLst><p:sldId r:id="s"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels',rels(rel('s','slide','slides/one.xml')));
  zip.file('ppt/slides/one.xml',slide(body));return zip;
}
const read=zip=>readPptx(zip,runtime(),new Map());
it.each([
 ['content types root',z=>z.file('[Content_Types].xml','<wrong/>'),'Invalid content types'],
 ['relationship owner',z=>z.file('orphan.rels',rels('')),'Invalid relationship owner'],
 ['missing owner part',z=>z.file('ppt/_rels/missing.xml.rels',rels('')),'Invalid relationship owner'],
 ['relationship root',z=>z.file('_rels/.rels','<wrong/>'),'Invalid relationships'],
 ['relationship child',z=>z.file('_rels/.rels',rels('<wrong/>')),'Unsupported relationship element'],
 ['missing relationship id',z=>z.file('_rels/.rels',rels(rel('','officeDocument','ppt/presentation.xml'))),'Invalid relationship'],
 ['duplicate relationship id',z=>z.file('_rels/.rels',rels(rel('x','officeDocument','ppt/presentation.xml').repeat(2))),'Invalid relationship'],
 ['unknown target mode',z=>z.file('_rels/.rels',rels(rel('x','officeDocument','ppt/presentation.xml','TargetMode="Maybe"'))),'Invalid relationship'],
 ['missing office relationship',z=>z.file('_rels/.rels',rels('')),'package identity'],
 ['wrong content type',z=>z.file('[Content_Types].xml',`<Types xmlns="${NS.ct}"/>`),'content type'],
 ['wrong slide root',z=>z.file('ppt/slides/one.xml','<wrong/>'),'Invalid native part root'],
 ['unsupported slide-list node',z=>z.file('ppt/presentation.xml',`<p:presentation xmlns:p="${NS.p}"><p:sldIdLst><p:wrong/></p:sldIdLst></p:presentation>`),'Unsupported slide list'],
 ['missing slide relationship',z=>z.file('ppt/_rels/presentation.xml.rels',rels('')),'Invalid slide reference'],
 ['duplicate slide target',z=>z.file('ppt/presentation.xml',`<p:presentation xmlns:p="${NS.p}" xmlns:r="${NS.r}"><p:sldIdLst><p:sldId r:id="s"/><p:sldId r:id="s"/></p:sldIdLst></p:presentation>`),'Duplicate slide'],
 ['image without a relationship',z=>z.file('ppt/slides/one.xml',slide('<p:pic><a:blip r:link="missing"/></p:pic>')),'Invalid image relationship'],
])('rejects %s rather than inventing a native mapping',async (_name,mutate,message)=>{
 const zip=fixture();mutate(zip);await expect(read(zip)).rejects.toThrow(message);
});

it('does not project malformed or uneven native tables; retains empty cell text and a unit-width fallback',async()=>{
 const table=(grid,rows)=>`<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
 const col='<a:gridCol w="bogus"/>',row='<a:tr><a:tc/></a:tr>';
 const d=await read(fixture(table('',row)+table(col,'')+table(col+col,row)+table(col,row)));
 expect(d.slides[0].objects.map(o=>o.type)).toEqual(['opaque','opaque','opaque','table']);
 const t=d.slides[0].objects[3].table;expect(t.columns[0].width).toBe(1);expect(t.rows[0].cells[0].text.paragraphs[0].runs[0]).toMatchObject({text:'',editable:false});
});

it('keeps native breaks, opaque fields and direct font resets distinct from editable text',async()=>{
 const body='<p:sp><p:spPr><a:prstGeom prst="rect"/></p:spPr></p:sp>'+ '<p:sp><p:txBody><a:p><a:br/><a:fld>Field value</a:fld><a:r><a:rPr><a:latin/><a:solidFill><a:srgbClr/></a:solidFill></a:rPr><a:t>Editable</a:t></a:r></a:p></p:txBody></p:sp>';
 const d=await read(fixture(body));expect(d.slides[0].objects[0]).toMatchObject({type:'shape',shape:'rect'});
 const runs=d.slides[0].objects[1].text.paragraphs[0].runs;
 expect(runs.map(r=>[r.text,r.editable])).toEqual([['\n',false],['Field value',false],['Editable',true]]);
 expect(runs[2].style).toMatchObject({typeface:null,color:null});expect(runs[2].extensions).toBeUndefined();
 expect(d.size.width).toBeGreaterThan(0); // absent native size retains canonical default
});
