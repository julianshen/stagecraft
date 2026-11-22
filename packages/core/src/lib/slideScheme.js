// The background class a slide renders with on the canvas — '' is the white
// `.slide` default; 'ink' / 'accent' (and the cover's other `.slide.*` variants)
// are the dark ones (main.css). The single source for SlideRenderer's className
// and the PPTX export's per-slide colour scheme, so the two can't drift.
export function slideBgClass(slide) {
  switch (slide?.layout) {
    case 'cover': return slide.bg || '';
    case 'divider': return slide.bg || 'ink';
    case 'thanks': return 'ink';
    default: return '';
  }
}
