import {
  nativeObjectAppearanceInput,
  nativeSlideAppearanceInput,
} from '@stagecraft/core/lib/nativeAppearance.js';

const colorMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
const source = (part, path = []) => ({ format: 'pptx', part, path });

/** Small proof-backed fixture whose EMU and colour values are the pixel oracle. */
export function nativeShapeFixture({ shape = 'rect', fill = { kind: 'solid', color: '#123456' }, stroke = { kind: 'none' }, adjust } = {}) {
  const theme = { id: 'theme', extensions: { pptxColorScheme: { dk1: '#000000', lt1: '#FFFFFF' } } };
  const master = { id: 'master', themeId: theme.id, source: source('ppt/slideMasters/slideMaster1.xml'), objects: [], extensions: { pptxColorMap: colorMap } };
  const layout = { id: 'layout', masterId: master.id, source: source('ppt/slideLayouts/slideLayout1.xml'), objects: [], extensions: { pptxColorMap: colorMap } };
  const object = {
    id: 'native-shape', type: 'shape', shape,
    geometry: { x: 95250, y: 95250, width: 952500, height: 476250 },
    source: source('ppt/slides/slide1.xml', [0]), extensions: { pptxColorMap: undefined },
  };
  const slide = { id: 'native-slide', source: source('ppt/slides/slide1.xml'), layoutId: layout.id, extensions: { pptxColorMap: colorMap }, objects: [object] };
  const document = {
    schemaVersion: 1, units: 'emu', size: { width: 9144000, height: 5143500 },
    extensions: { sourceFormat: 'pptx' }, slides: [slide], layouts: [layout], masters: [master], themes: [theme],
  };
  object.extensions.stagecraftNativeAppearance = {
    version: 1, sourceFormat: 'pptx', appearanceResolved: true,
    input: nativeObjectAppearanceInput(object, { theme, colorMap, document, slide }),
    fill, stroke, ...(adjust ? { adjust } : {}),
  };
  slide.extensions.stagecraftSlideAppearance = {
    version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide, document),
    background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
  };
  return document;
}
