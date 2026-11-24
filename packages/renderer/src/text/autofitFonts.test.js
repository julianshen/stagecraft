import { expect,it,vi } from 'vitest';
import {waitForAutofitFonts} from './waitForAutofitFonts.js';
const object=(id,autofit,typeface)=>({id,type:'text',extensions:{stagecraftAuthored:true},geometry:{x:0,y:0,width:2667000,height:952500},bodyLayout:{autofit},text:{paragraphs:[{runs:[{text:'Both fonts',style:{sz:'1800',typeface}}]}]}});
it('loads the union of snapshot fonts in one wait and deduplicates queries',async()=>{
 const document={slides:[{objects:[object('a','shrink','Arial'),object('b','resize','Verdana'),object('c','resize','Arial')]}]};const loaded=new Set();
 const fonts={status:'loaded',check:vi.fn(query=>loaded.has(query)),load:vi.fn(async query=>{loaded.add(query);return [];}),ready:Promise.resolve()};
 const result=await waitForAutofitFonts(document,{fonts});expect(result).toEqual({shrink:{status:'ready'},resize:{status:'ready'}});expect(fonts.load.mock.calls.length).toBe(2);
 const checks=fonts.check.mock.calls.map(call=>call[0]).join(' ');expect(checks).toContain('Arial');expect(checks).toContain('Verdana');
});
