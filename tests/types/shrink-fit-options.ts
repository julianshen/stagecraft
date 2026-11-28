import { scaledTextBody } from '@stagecraft/renderer/text/measureShrinkFits';

const body = {
  paragraphs: [{ runs: [{ fontSizePt: 18 }], endProperties: { fontSizePt: 18 }, lineSpacing: { kind: 'percent', value: 1.5 } }],
};
const fit = { fontScale: 62500, lnSpcReduction: 20000 };

scaledTextBody(body, fit, { snapFontSize: true, minimumSnappedFontSizePt: 1, lineSpacingReduction: 'subtractive' });
scaledTextBody(body, fit, { lineSpacingReduction: 'multiplicative' });
// @ts-expect-error unsupported line-spacing reduction modes must stay out of the public type
scaledTextBody(body, fit, { lineSpacingReduction: 'additive' });
