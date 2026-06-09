import { exportToPPTX } from './src/lib/pptxExport.js';
import fs from 'node:fs';
const types = ['bar','line','area','pie','donut',undefined];
const deck = { title:'Smoke', theme:'indigo',
  sections:[{id:'s',name:'S',slides:types.map((t,i)=>`c${i}`)}],
  slides:types.map((t,i)=>({id:`c${i}`,layout:'chart',chartType:t,title:String(t),
    chart:{categories:['A','B','C'],series:[{name:'X',values:[3,5,4]}]}})) };
const f = await exportToPPTX(deck);
console.log('OK', f, fs.statSync(f).size, 'bytes (incl. doughnut w/ legend+percent, no throw)');
fs.unlinkSync(f);
