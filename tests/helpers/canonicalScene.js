const authored={stagecraftAuthored:true};
export const box=(extra={})=>({id:'box',type:'text',extensions:authored,geometry:{x:95250,y:190500,width:2857500,height:1905000},text:{paragraphs:[{id:'p',runs:[{id:'r',text:'Hello',editable:true,style:{sz:'1800',typeface:'Arial',color:'#ff0000'},extensions:authored}]}]},...extra});
export const deck=(objects=[box()])=>({schemaVersion:1,units:'emu',extensions:{sourceFormat:'pptx'},size:{width:9144000,height:5143500},slides:[{id:'s',extensions:authored,objects}],layouts:[],masters:[],themes:[]});
