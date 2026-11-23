import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { readOdp, readOdpTable } from './odp.js';
import { NS, runtime } from './xml.js';
const mime='application/vnd.oasis.opendocument.presentation';
const manifest=body=>`<manifest:manifest xmlns:manifest="${NS.manifest}">${body}</manifest:manifest>`;
function fixture(){
 const zip=new JSZip();zip.file('mimetype',mime);
 zip.file('META-INF/manifest.xml',manifest(`<manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/>`));
 zip.file('content.xml',`<office:document-content xmlns:office="${NS.office}"><office:body><office:presentation/></office:body></office:document-content>`);
 zip.file('styles.xml',`<office:document-styles xmlns:office="${NS.office}"/>`);return zip;
}
it.each([
 ['missing MIME',z=>z.remove('mimetype'),'mimetype'],
 ['encrypted manifest',z=>z.file('META-INF/manifest.xml',manifest('<manifest:encryption-data/>')),'manifest'],
 ['wrong manifest root',z=>z.file('META-INF/manifest.xml','<wrong/>'),'manifest'],
 ['missing root media identity',z=>z.file('META-INF/manifest.xml',manifest('')),'identity'],
 ['wrong content root',z=>z.file('content.xml','<wrong/>'),'document root'],
 ['wrong styles root',z=>z.file('styles.xml','<wrong/>'),'document root'],
 ['absent presentation body',z=>z.file('content.xml',`<office:document-content xmlns:office="${NS.office}"/>`),'presentation'],
])('rejects %s',async(_label,mutate,message)=>{const zip=fixture();mutate(zip);await expect(readOdp(zip,runtime(),new Map())).rejects.toThrow(new RegExp(message,'i'));});
const frame=body=>runtime().parse(`<draw:frame xmlns:draw="${NS.draw}" xmlns:table="${NS.table}" xmlns:text="${NS.text}">${body}</draw:frame>`).documentElement;
const table=cell=>`<table:table><table:table-column/><table:table-row><table:table-cell>${cell}</table:table-cell></table:table-row></table:table>`;
it('retains an empty cell and defaults unspecified column widths without projecting an empty table',()=>{
 expect(readOdpTable(frame('<table:table/>'),'content.xml')).toBeNull();
 const result=readOdpTable(frame(table('')),'content.xml');
 expect(result.columns[0].width).toBe(1);expect(result.rows[0].cells[0].text.paragraphs[0].runs[0]).toMatchObject({text:'',editable:false});
});
it.each(['0','-1','1.5','1001','NaN'])('bounds table-cell space expansion (%s)',count=>{
 expect(()=>readOdpTable(frame(table(`<text:p><text:s text:c="${count}"/></text:p>`)),'content.xml')).toThrow('ODP text space expansion limit');
});
it('handles a default single space and ignores comments in native table text',()=>{
 const result=readOdpTable(frame(table('<text:p>A<!--ignored--><text:s/>B</text:p>')),'content.xml');
 expect(result.rows[0].cells[0].text.paragraphs[0].runs[0].text).toBe('A B');
});
it('bounds cell-text nesting and aggregate expansion',()=>{
 const nested='<text:list>'.repeat(130)+'<text:p>Hidden</text:p>'+'</text:list>'.repeat(130);
 expect(()=>readOdpTable(frame(table(nested)),'content.xml')).toThrow('ODP cell text structure limit');
 expect(()=>readOdpTable(frame(table(`<text:p>${'x'.repeat(1048577)}</text:p>`)),'content.xml')).toThrow('ODP text expansion limit');
});
