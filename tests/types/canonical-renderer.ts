import {buildCanonicalScene,createCanonicalPaintEnvironment,paintCanonicalNode,type CanonicalNode} from '@stagecraft/renderer/canonical';
import type {CanonicalDocument} from '@stagecraft/core/document';
declare const document:CanonicalDocument;
declare const context:CanvasRenderingContext2D;
const result=buildCanonicalScene(document,'slide');
if(result.status==='ready') {
 const node=result.scene.nodes[0];
 paintCanonicalNode(context,node,createCanonicalPaintEnvironment());
 // @ts-expect-error canonical geometry is readonly
 node.geometry.x=0;
}
// @ts-expect-error opaque nodes must originate from the scene builder
const forged:CanonicalNode={id:'x',type:'text',geometry:{x:0,y:0,width:1,height:1},frame:{x:0,y:0,width:1,height:1,rotation:0},hitShape:'rect',textIds:[]};
void forged;
