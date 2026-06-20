import React from 'react';
import { Button, IconButton } from '../../ui/Primitives.jsx';
import { remapCollectionFmt } from '../../../lib/slideFmt.js';

// Per-layout config: which collection the layout's items live in, and (for object
// items) the editable leaf fields + their input titles. List items are bare
// primitives (a single text field, no leaf schema). `n` is a short ordinal, so it
// gets a narrow field. Single source for the layouts this editor handles —
// DataPanel routes by ITEM_LAYOUTS. The leaf keys are the per-item fmt paths the
// renderer emits (`items.0.t`, `kpis.0.val`, `stats.0.lbl`, …); keep them in step
// with `ITEM_FIELDS` in lib/slideFmt.js (the formattable-leaf vocabulary) when a
// per-item field is added — they're separate lists (this one adds title/order/width).
const EDITORS = {
  agenda: { collection: 'items', heading: 'Agenda items', fields: [
    { key: 'n', title: 'Item number', width: 56 }, { key: 't', title: 'Item title' }, { key: 'd', title: 'Item description' }] },
  list: { collection: 'items', heading: 'List items', primitive: true },
  kpi: { collection: 'kpis', heading: 'KPI items', fields: [
    { key: 'label', title: 'Label' }, { key: 'val', title: 'Value' }, { key: 'delta', title: 'Delta' }, { key: 'target', title: 'Target' }] },
  split: { collection: 'stats', heading: 'Stat items', fields: [
    { key: 'lbl', title: 'Label' }, { key: 'val', title: 'Value' }] },
};
// The slide layouts whose per-item collection this editor can edit (DataPanel routes these here).
export const ITEM_LAYOUTS = Object.keys(EDITORS);

// Inspector editor for a slide's per-item collection (agenda/list `items`, kpi
// `kpis`, split `stats`): edit fields, add, delete, and reorder items. Commits
// through the shared validated patch path (onApply → sanitizeSlidePatch), like
// the Co-pilot. Edits/adds keep item positions, so they send the collection
// alone; delete/reorder change positions, so they also send the index-keyed `fmt`
// remapped by remapCollectionFmt — keeping per-item formatting on its item (the
// patch merge replaces `fmt` wholesale).
export default function ListItemsEditor({ slide, onApply }) {
  const cfg = EDITORS[slide.layout];
  if (!cfg) return null; // DataPanel only routes ITEM_LAYOUTS here; guard a misroute
  const { collection, fields, primitive, heading } = cfg;
  const items = Array.isArray(slide[collection]) ? slide[collection] : [];

  const commitItems = (next) => onApply({ [collection]: next });
  const commitOrder = (next, newOrder) => {
    const fmt = slide.fmt ? remapCollectionFmt(slide.fmt, collection, newOrder) : undefined;
    onApply(fmt ? { [collection]: next, fmt } : { [collection]: next });
  };

  const order = items.map((_, i) => i); // current old-index order, permuted alongside items
  const editItem = (i, value) => commitItems(items.map((it, j) => (j === i ? value : it)));
  const editField = (i, key, value) =>
    // Spread only a plain object — a layout switch can leave a string item here,
    // and `{ ...'Foo' }` would scatter it into {0:'F',1:'o',…}; start fresh instead.
    commitItems(items.map((it, j) => (j === i ? { ...(it && typeof it === 'object' ? it : {}), [key]: value } : it)));
  const blankItem = () => (primitive ? '' : Object.fromEntries(fields.map((f) => [f.key, ''])));
  const addItem = () => commitItems([...items, blankItem()]);
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
      <h4>{heading}</h4>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ flex: 1, display: 'grid', gap: 4 }}>
            {primitive
              ? (
                // A layout switch can leave object items on a list slide; show them
                // blank like the canvas (SlideRenderer coerces object→''), not "[object Object]".
                <input className="cell-input" title="Item text"
                  value={typeof it === 'object' && it !== null ? '' : (it ?? '')}
                  onChange={(e) => editItem(i, e.target.value)} />
              )
              : fields.map((f) => (
                  <input key={f.key} className="cell-input" title={f.title} value={it?.[f.key] ?? ''}
                    style={f.width ? { width: f.width } : undefined}
                    onChange={(e) => editField(i, f.key, e.target.value)} />
                ))}
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
