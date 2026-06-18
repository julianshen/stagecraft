import React from 'react';
import { Button, IconButton } from '../../ui/Primitives.jsx';
import { remapCollectionFmt } from '../../../lib/slideFmt.js';

// agenda items are objects with these leaves (number / title / description);
// list items are bare strings. `n` is a short ordinal, so it gets a narrow field.
const AGENDA_FIELDS = [
  { key: 'n', title: 'Item number', width: 56 },
  { key: 't', title: 'Item title' },
  { key: 'd', title: 'Item description' },
];

// Inspector editor for the `items` collection of agenda + list slides: edit, add,
// delete, and reorder items. Commits through the shared validated patch path
// (onApply → sanitizeSlidePatch), like the Co-pilot. Edits/adds keep item
// positions, so they send `items` alone; delete/reorder change positions, so they
// also send the index-keyed `fmt` remapped by remapCollectionFmt — keeping
// per-item formatting on its item (the patch merge replaces `fmt` wholesale).
export default function ListItemsEditor({ slide, onApply }) {
  const isAgenda = slide.layout === 'agenda';
  const items = Array.isArray(slide.items) ? slide.items : [];

  const commitItems = (next) => onApply({ items: next });
  const commitOrder = (next, newOrder) => {
    const fmt = slide.fmt ? remapCollectionFmt(slide.fmt, 'items', newOrder) : undefined;
    onApply(fmt ? { items: next, fmt } : { items: next });
  };

  const order = items.map((_, i) => i); // current old-index order, permuted alongside items
  const editItem = (i, value) => commitItems(items.map((it, j) => (j === i ? value : it)));
  const editField = (i, key, value) =>
    // Spread only a plain object — a layout switch can leave a string item here,
    // and `{ ...'Foo' }` would scatter it into {0:'F',1:'o',…}; start fresh instead.
    commitItems(items.map((it, j) => (j === i ? { ...(it && typeof it === 'object' ? it : {}), [key]: value } : it)));
  const addItem = () => commitItems([...items, isAgenda ? { n: '', t: '', d: '' } : '']);
  const removeItem = (i) =>
    commitOrder(items.filter((_, j) => j !== i), order.filter((j) => j !== i));
  const move = (i, to) => {
    const next = items.slice();
    const ord = order.slice();
    [next[i], next[to]] = [next[to], next[i]];
    [ord[i], ord[to]] = [ord[to], ord[i]];
    commitOrder(next, ord);
  };

  return (
    <div className="pane-section">
      <h4>{isAgenda ? 'Agenda items' : 'List items'}</h4>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ flex: 1, display: 'grid', gap: 4 }}>
            {isAgenda
              ? AGENDA_FIELDS.map((f) => (
                  <input key={f.key} className="cell-input" title={f.title} value={it?.[f.key] ?? ''}
                    style={f.width ? { width: f.width } : undefined}
                    onChange={(e) => editField(i, f.key, e.target.value)} />
                ))
              : (
                // A layout switch can leave object items on a list slide; show them
                // blank like the canvas (SlideRenderer coerces object→''), not "[object Object]".
                <input className="cell-input" title="Item text"
                  value={typeof it === 'object' && it !== null ? '' : (it ?? '')}
                  onChange={(e) => editItem(i, e.target.value)} />
              )}
          </div>
          <IconButton name="chevron-up" size={12} title="Move up" disabled={i === 0}
            onClick={() => move(i, i - 1)} />
          <IconButton name="chevron-down" size={12} title="Move down" disabled={i === items.length - 1}
            onClick={() => move(i, i + 1)} />
          <IconButton name="trash" size={12} title="Remove item" onClick={() => removeItem(i)} />
        </div>
      ))}
      <Button variant="outline" style={{ height: 26, fontSize: 11 }} onClick={addItem}>Add item</Button>
    </div>
  );
}
