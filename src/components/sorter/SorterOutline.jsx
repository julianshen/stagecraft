export default function SorterOutline({ deck, flat, active, setActive, onOpenSlide }) {
  return (
    <div className="sorter">
      <div style={{ maxWidth: 1100 }}>
        {deck.sections.map((sec, si) => (
          <div key={sec.id} style={{ marginBottom: 30 }}>
            <h2 style={{ fontSize: 11, fontFamily: 'var(--f-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 14px' }}>
              {String(si + 1).padStart(2, '0')} · {sec.name}
            </h2>
            {sec.slides.map(sid => {
              const idx = flat.findIndex(f => f.id === sid);
              const s = flat[idx];
              if (!s) return null;
              const bodyPreview = s.body
                || (s.items ? s.items.map(it => it.t || it).slice(0, 3).join(' · ') : null)
                || (s.kpis ? s.kpis.map(k => `${k.label}: ${k.val}`).join(' · ') : null)
                || s.subtitle
                || '—';
              return (
                <div key={sid} className="outline-section" onClick={() => onOpenSlide(idx)}>
                  <div className="num">{String(idx + 1).padStart(2, '0')}</div>
                  <div>
                    <div className="ol-title">{s.title || s.subtitle || '(untitled)'}</div>
                    <div className="ol-body">{bodyPreview}</div>
                  </div>
                  <div className="ol-meta">
                    <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.layout}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
