import { exportToPPTX } from './src/lib/pptxExport.js'; import fs from 'node:fs';
const f = await exportToPPTX({title:'S',theme:'indigo',sections:[{id:'s',name:'S',slides:['c']}],slides:[{id:'c',layout:'chart',chartType:'bar',chart:{categories:['A','B'],series:[{values:[3,5]}]}}]});
console.log('export OK', fs.statSync(f).size); fs.unlinkSync(f);
