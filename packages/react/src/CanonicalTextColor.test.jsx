import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import {createEditor} from '@stagecraft/core';
import {createDocument,documentPlugin,presentationPlugin} from '@stagecraft/core/document';
import {buildCanonicalScene} from '@stagecraft/renderer/canonical';
import {EditorProvider} from './EditorProvider.jsx';
import {PresentationEditor} from './PresentationEditor.jsx';
it('gives UI-created sz-only text the same authored color in SVG and canvas',()=>{
 const editor=createEditor({document:createDocument({slides:[{id:'s',objects:[],extensions:{stagecraftAuthored:true}}],layouts:[{id:'l',masterId:'m'}],masters:[{id:'m',themeId:'t'}],themes:[{id:'t',extensions:{pptxFontScheme:{minor:{latin:'Arial'}}}}]}),plugins:[documentPlugin,presentationPlugin]});
 render(<EditorProvider editor={editor}><PresentationEditor /></EditorProvider>);
 fireEvent.click(screen.getByRole('tab',{name:'Insert'}));fireEvent.click(screen.getByText('Text box'));
 const snapshot=editor.getSnapshot().document,run=snapshot.slides[0].objects[0].text.paragraphs[0].runs[0];expect(run.style).toEqual({sz:'2400'});
 const result=buildCanonicalScene(snapshot,'s');expect(result.status).toBe('ready');
 const svg=screen.getByLabelText('Slide canvas').querySelector('.stagecraft-presentation-object');
 expect(svg).toHaveStyle({color:'#172033'});expect(result.scene.nodes[0].paint.text.body.paragraphs[0].runs[0].color).toBe('#172033');
});
