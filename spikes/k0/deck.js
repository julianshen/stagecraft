// A synthetic 40-slide deck shaped like a typical imported one: per slide 6
// preset shapes (half gradient-filled, all outlined), 8 text boxes (2–3
// paragraphs, 14–40 pt, mixed runs) and 2 pictures — 16 nodes, in slide px.
const PRESETS = ['rect', 'roundRect', 'ellipse', 'star5', 'rightArrow', 'hexagon'];
const WORDS = 'quarterly revenue grew across every region while margins held steady and the roadmap shipped on time'.split(' ');

const rgb = (i) => ({ r: (i * 67) % 256, g: (i * 131) % 256, b: (i * 197) % 256, a: 1 });
const sentence = (seed, n) => Array.from({ length: n }, (_, i) => WORDS[(seed + i * 7) % WORDS.length]).join(' ');

function shapeNode(s, i) {
  const fill = i % 2
    ? { kind: 'gradient', gradient: 'linear', angle: 45, scaled: false, stops: [{ position: 0, color: rgb(s + i) }, { position: 1, color: rgb(s + i + 9) }] }
    : { kind: 'solid', color: rgb(s + i) };
  return {
    kind: 'shape', preset: PRESETS[i], x: 80 + i * 300, y: 120 + (i % 2) * 40, w: 240, h: 160, rot: i === 3 ? 15 : 0,
    style: { fill, line: { width: 3, fill: { kind: 'solid', color: rgb(s + i + 3) } }, issues: [] },
  };
}

function textNode(s, i) {
  const size = [14, 18, 24, 40][i % 4];
  const para = (p) => ({
    align: p ? 'left' : 'center', level: 0,
    runs: [
      { text: `${sentence(s + i + p, 6)} `, fontSizePt: size, bold: p === 0, color: '#15171C' },
      { text: sentence(s + i + p + 3, 10), fontSizePt: size, italic: p === 2, color: '#3A3F4B' },
    ],
  });
  return {
    kind: 'text', x: 80 + (i % 4) * 450, y: 380 + Math.floor(i / 4) * 330, w: 420, h: 300, rot: 0,
    body: { paragraphs: [0, 1, 2].slice(0, 2 + (i % 2)).map(para), anchor: 't', insetLeftEmu: 91440, insetRightEmu: 91440, insetTopEmu: 45720, insetBottomEmu: 45720, wrap: true },
  };
}

const pictureNode = (i) => ({ kind: 'image', x: 1500, y: 80 + i * 150, w: 320, h: 120, rot: 0 });

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const deck = Array.from({ length: 40 }, (_, s) => [
  ...Array.from({ length: 6 }, (_, i) => shapeNode(s, i)),
  ...Array.from({ length: 8 }, (_, i) => textNode(s, i)),
  pictureNode(0), pictureNode(1),
]);
