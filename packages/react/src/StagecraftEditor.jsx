import { useRef } from 'react';
import Editor from './components/editor/Editor.jsx';
import { SAMPLE_DECK } from '@stagecraft/core/data/deck.js';
import { useDeckHistory } from './hooks/useDeckHistory.js';
import { accentTokens } from './lib/accentTokens.js';

/**
 * Styled, self-contained Stagecraft slide editor wrapper.
 * Supports controlled (`deck` + `onDeckChange`) and uncontrolled (`defaultDeck`)
 * modes, scoped theme/accent/density tokens, optional AI drawer injection, and
 * focus-scoped keyboard shortcuts for safely mounting multiple editors.
 */
export function StagecraftEditor({
  deck,
  defaultDeck,
  onDeckChange,
  theme = 'light',
  accent = 'indigo',
  density = 'comfortable',
  layoutVariant = 'default',
  onPresent,
  onOpenExport,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  keysEnabled = true,
  keyboardScope = 'focus',
  renderAIDrawer,
  slots,
  className,
  style,
}) {
  const rootRef = useRef(null);
  const isControlled = deck !== undefined;
  const history = useDeckHistory(() =>
    isControlled ? null : JSON.parse(JSON.stringify(defaultDeck ?? SAMPLE_DECK))
  );

  const activeDeck = isControlled ? deck : history.deck;
  const handleDeckChange = isControlled ? (onDeckChange ?? (() => {})) : history.commit;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onPointerDownCapture={() => {
        const root = rootRef.current;
        if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
      }}
      className={['stagecraft-editor', className].filter(Boolean).join(' ')}
      data-theme={theme}
      data-density={density}
      style={{
        ...accentTokens(accent, theme),
        ...style,
      }}
    >
      <Editor
        deck={activeDeck}
        onDeckChange={handleDeckChange}
        accent={accent}
        layoutVariant={layoutVariant}
        density={density}
        onPresent={onPresent}
        onOpenExport={onOpenExport}
        onUndo={isControlled ? onUndo : (onUndo ?? history.undo)}
        onRedo={isControlled ? onRedo : (onRedo ?? history.redo)}
        canUndo={isControlled ? canUndo : (canUndo ?? history.canUndo)}
        canRedo={isControlled ? canRedo : (canRedo ?? history.canRedo)}
        keysEnabled={keysEnabled}
        keyboardScope={keyboardScope}
        keyboardTargetRef={rootRef}
        renderAIDrawer={renderAIDrawer}
        slots={slots}
      />
    </div>
  );
}

export default StagecraftEditor;
