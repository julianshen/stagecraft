import { fireEvent, render, screen } from '@testing-library/react';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { EditorProvider } from './EditorProvider.jsx';
import { PresentationEditor } from './PresentationEditor.jsx';

it('toggles every optional region without changing the document or selected object', () => {
  const editor = createEditor({
    document: createDocument({ slides: [{ id: 's', notes: 'Saved notes', objects: [{
      id: 'shape', type: 'shape', shape: 'rect', fill: '#123456',
      geometry: { x: 0, y: 0, width: 914400, height: 914400 },
      extensions: { stagecraftAuthored: true },
    }] }] }), validateDocument, plugins: [documentPlugin, presentationPlugin],
  });
  const view = visible => <EditorProvider editor={editor}><PresentationEditor
    showToolbar={visible} showSlideList={visible} showAttributePanel={visible}
    showNotesPanel={visible} showDeckList={visible}
    decks={[{ id: 'deck', title: 'Deck' }]} activeDeckId="deck"
  /></EditorProvider>;
  const mounted = render(view(true));
  try {
    fireEvent.click(screen.getByLabelText('Slide canvas').querySelector('[data-object-id="shape"]'));
    expect(screen.getByLabelText('Fill')).toHaveValue('#123456');
    fireEvent.change(screen.getByRole('textbox', { name: 'Speaker notes' }), { target: { value: 'Uncommitted notes' } });
    const before = editor.getSnapshot();
    mounted.rerender(view(false));
    for (const name of ['Presentations', 'Slides', 'Attribute panel', 'Speaker notes'])
      expect(screen.queryByLabelText(name)).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByLabelText('Slide canvas')).toBeTruthy();
    expect(editor.getSnapshot()).toBe(before);
    mounted.rerender(view(true));
    expect(screen.getByLabelText('Fill')).toHaveValue('#123456');
    expect(screen.getByRole('textbox', { name: 'Speaker notes' })).toHaveValue('Saved notes');
    expect(screen.getByRole('button', { name: 'Deck' })).toHaveAttribute('aria-current', 'page');
    expect(editor.getSnapshot()).toBe(before);
  } finally { mounted.unmount(); editor.dispose(); }
});
