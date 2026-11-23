// @vitest-environment node
import { it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { inspectZip } from './zip.js';

async function archive() {
  const zip=new JSZip();zip.file('a.bin','payload');
  return Buffer.from(await zip.generateAsync({type:'uint8array',compression:'STORE'}));
}
const directory = b => b.indexOf(Buffer.from([0x50,0x4b,1,2]));

it.each([
  ['split archive', (b,c,e)=>b.writeUInt16LE(1,e+4), 'Split and ZIP64'],
  ['directory extent', (b,c,e)=>b.writeUInt32LE(1,e+12), 'directory layout'],
  ['directory signature', (b,c)=>b.writeUInt32LE(0,c), 'Invalid ZIP directory'],
  ['ZIP64 entry', (b,c)=>b.writeUInt32LE(0xffffffff,c+24), 'ZIP64 entries'],
  ['central name extent', (b,c)=>b.writeUInt16LE(0xffff,c+28), 'Invalid ZIP name'],
  ['local offset', (b,c,e)=>b.writeUInt32LE(e,c+42), 'Invalid ZIP local header'],
  ['local signature', b=>b.writeUInt32LE(0,0), 'Invalid ZIP local header'],
  ['local name extent', b=>b.writeUInt16LE(0xffff,26), 'Invalid ZIP local name'],
  ['different local name', b=>{b[30]=98;}, 'ambiguous ZIP entry names'],
  ['central comment extent', (b,c)=>b.writeUInt16LE(1,c+32), 'Invalid ZIP directory length'],
  ['truncated extra header', (b,c)=>{b.writeUInt16LE(4,c+28);b.writeUInt16LE(1,c+30);}, 'Invalid ZIP extra field'],
])('rejects %s before loading or inflating entries', async (_name, corrupt, error) => {
  const bytes=await archive();corrupt(bytes,directory(bytes),bytes.length-22);
  const load=vi.spyOn(JSZip,'loadAsync');
  try { await expect(inspectZip(bytes)).rejects.toThrow(error);expect(load).not.toHaveBeenCalled(); }
  finally {load.mockRestore();}
});

it('rejects an extra field whose declared payload exceeds its directory region', async()=>{
  const zip=new JSZip();zip.file('é','payload');const b=Buffer.from(await zip.generateAsync({type:'uint8array'}));
  const c=directory(b),start=c+46+b.readUInt16LE(c+28);b.writeUInt16LE(0xffff,start+2);
  await expect(inspectZip(b)).rejects.toThrow('Invalid ZIP extra field length');
});

it('does not accept a false end marker hidden in a ZIP comment', async()=>{
  const zip=new JSZip();zip.file('a','x');zip.comment='PK\x05\x06'+'x'.repeat(30);
  const bytes = await zip.generateAsync({type:'uint8array'});
  // Isolate Stagecraft's EOCD selection from JSZip's separate last-marker scan.
  const load = vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(zip);
  try {
    const result = await inspectZip(bytes);
    expect(load).toHaveBeenCalledWith(bytes);
    expect(result.entryCount).toBe(1);
    expect(result.expandedBytes).toBe(1);
    expect(await result.zip.file('a').async('string')).toBe('x');
  } finally { load.mockRestore(); }
});

it.each(['count','renamed','inflated'])('rejects inconsistent loader output: %s',async mode=>{
  const bytes=await archive(),zip=await JSZip.loadAsync(bytes);
  if(mode==='count')zip.file('extra','x');
  if(mode==='renamed')zip.file('a.bin').unsafeOriginalName='other.bin';
  if(mode==='inflated')zip.file('a.bin').async=async()=>new Uint8Array(20);
  const load=vi.spyOn(JSZip,'loadAsync').mockResolvedValue(zip);
  try {await expect(inspectZip(bytes,{maxEntryBytes:10})).rejects.toThrow(mode==='inflated'?'inflated size':'ambiguous ZIP entry names');}
  finally{load.mockRestore();}
});
