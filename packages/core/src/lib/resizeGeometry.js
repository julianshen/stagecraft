/** Shared structural eligibility; callers supply trusted native metadata or authored theme defaults. */
export function resizeIneligibility(object, original, defaults) {
 const g=object.geometry, layout=object.bodyLayout;
 if ((g?.rotation??0)!==0) return 'rotated';
 if (layout?.wrap==='none') return 'wrap-none';
 if (!['text','shape'].includes(object.type)||!object.text||object.children?.length
   || object.shape&&object.shape!=='rect'||layout?.autofit!=='resize'
   ||layout.anchor!==undefined&&!['top','middle','bottom'].includes(layout.anchor)
   ||!g||!['x','y','width','height'].every(k=>Number.isSafeInteger(g[k]))
   ||g.width<=0||g.height<=0||g.flipH||g.flipV) return 'unsupported-geometry';
 if(original) {
   if(original.source?.format!=='pptx'||original.extensions?.editableGeometry!==true||original.extensions?.pptxTextMetrics?.supported!==true) return 'unsupported-metrics';
 } else if(object.source||object.extensions?.stagecraftAuthored!==true||defaults?.[object.type==='text'?'txDef':'spDef']) return 'unsupported-metrics';
 return null;
}
export function resizedGeometry(object,height) {
 const g=object.geometry;
 if(!Number.isSafeInteger(height)||height<g.height||height<=0)return null;
 const growth=height-g.height, anchor=object.bodyLayout.anchor;
 const y=g.y-(anchor==='bottom'?growth:anchor==='middle'?Math.floor(growth/2):0);
 return Number.isSafeInteger(y)?{...g,y,height}:null;
}
