import type { ReactElement } from 'react';
import {
  PresentationCanvas,
  PresentationEditor,
  PresentationEditorProvider,
  type PresentationCanvasProps,
  type PresentationEditorProps,
  type PresentationSurface,
  type PresentationSurfaceOutcome,
  type PresentationSurfaceReason,
} from '@stagecraft/react/presentation';
import {
  KonvaPresentationCanvas,
  type KonvaPresentationCanvasProps,
} from '@stagecraft/react/konva';

function expectType<T>(_value: T): void {}
function assertNever(value: never): never {
  throw new Error(`Unhandled surface reason: ${String(value)}`);
}

function describeSurfaceReason(reason: PresentationSurfaceReason): string {
  switch (reason) {
    case 'loading':
    case 'no-slide':
    case 'not-canonical':
    case 'unsupported-format':
    case 'plugin-renderer':
    case 'inherited-appearance':
    case 'unsupported-content':
    case 'unresolved-appearance':
    case 'invalid-geometry':
    case 'unsupported-embedding':
    case 'fonts-unavailable':
    case 'fonts-timeout':
    case 'canvas-unavailable':
    case 'load-failed':
    case 'render-failed':
      return reason;
    default:
      return assertNever(reason);
  }
}

function surfaceComposition(): ReactElement {
  const surface: PresentationSurface = 'konva';
  const onSurfaceChange = (outcome: PresentationSurfaceOutcome) => {
    expectType<PresentationSurface>(outcome.requested);
    expectType<PresentationSurface>(outcome.active);
    expectType<'ready' | 'fallback'>(outcome.status);
    expectType<string | null>(outcome.slideId);
    expectType<number>(outcome.revision);
    if (outcome.reason !== undefined) {
      describeSurfaceReason(outcome.reason);
    }
  };

  const editorProps: PresentationEditorProps = { surface, onSurfaceChange };
  const canvasProps: PresentationCanvasProps = { surface, onSurfaceChange };
  const konvaProps: KonvaPresentationCanvasProps = { onSurfaceChange, className: 'custom' };
  expectType<PresentationEditorProps>(editorProps);
  expectType<PresentationCanvasProps>(canvasProps);
  expectType<KonvaPresentationCanvasProps>(konvaProps);

  return (
    <>
      <PresentationEditor surface={surface} onSurfaceChange={onSurfaceChange} />
      <PresentationEditorProvider>
        <PresentationCanvas surface={surface} onSurfaceChange={onSurfaceChange} />
        <KonvaPresentationCanvas onSurfaceChange={onSurfaceChange} />
      </PresentationEditorProvider>
    </>
  );
}

// @ts-expect-error Unsupported surface value.
const invalidSurface: PresentationSurface = 'canvas';
// @ts-expect-error KonvaPresentationCanvas omits the surface prop.
const invalidKonvaProps: KonvaPresentationCanvasProps = { surface: 'svg' };
// @ts-expect-error Unknown PresentationSurfaceReason member.
const invalidReason: PresentationSurfaceReason = 'unknown-reason';
// @ts-expect-error Invalid surface on PresentationCanvas.
const badCanvas = <PresentationCanvas surface="webgl" />;

void surfaceComposition;
void invalidSurface;
void invalidKonvaProps;
void invalidReason;
void badCanvas;
