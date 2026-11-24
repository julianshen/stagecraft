import type { ReactElement } from 'react';
import type { PresentationCanvasProps } from '../PresentationEditor.js';

export type KonvaPresentationCanvasProps = Omit<PresentationCanvasProps, 'surface'>;
export function KonvaPresentationCanvas(props?: KonvaPresentationCanvasProps): ReactElement;
