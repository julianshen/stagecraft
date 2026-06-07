import React, { useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { IconButton } from '../../ui/Primitives.jsx';
import { callLLM } from '../../../lib/llmClient.js';

export default function DefaultAIDrawer({ onClose, slideNum, slide }) {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const suggestions = [
    { icon: 'magic', t: 'Rewrite as 3 columns' },
    { icon: 'chart-bar', t: 'Plot against plan' },
    { icon: 'layers', t: 'Apply Executive theme' },
    { icon: 'sparkle', t: 'Generate speaker notes' },
  ];

  async function handleSend(text) {
    const input = text || prompt;
    if (!input.trim()) return;
    if (!text) setPrompt(''); // clear the typed prompt (suggestion chips pass `text`)
    setLoading(true);
    setResponse('');
    try {
      const ctx = slide ? `Current slide layout: ${slide.layout}, title: ${slide.title || ''}` : '';
      const result = await callLLM([
        { role: 'user', content: `${ctx}\n\n${input}` }
      ]);
      setResponse(result);
    } catch (err) {
      setResponse(`Error: ${err.message}`);
    }
    setLoading(false);
  }

  return (
    <div className="ai-drawer">
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="ai" size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>Co-pilot</span>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-4)', marginLeft: 'auto' }}>slide {String(slideNum).padStart(2, '0')}</span>
        <IconButton name="x" onClick={onClose} />
      </div>
      <div style={{ flex: 1, padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!response && suggestions.map((s, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 10, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer' }}
            onClick={() => handleSend(s.t)}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent-wash)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
              <Icon name={s.icon} size={13} />
            </div>
            <div style={{ fontWeight: 550, fontSize: 12.5, alignSelf: 'center' }}>{s.t}</div>
          </div>
        ))}
        {loading && (
          <div style={{ padding: 12, color: 'var(--ink-3)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="refresh" size={12} style={{ animation: 'spin .65s linear infinite' }} />
            Thinking…
          </div>
        )}
        {response && (
          <div style={{ padding: 12, background: 'var(--bg-2)', borderRadius: 6, border: '1px solid var(--line)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
            {response}
          </div>
        )}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--line)' }}>
        <div className="input-group" style={{ height: 36 }}>
          <span className="ico"><Icon name="ai" size={12} /></span>
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Ask Co-pilot or describe an edit…"
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSend(); }}
          />
          <button
            style={{ padding: '0 8px', background: 'var(--accent)', color: 'white', borderRadius: 3, fontSize: 11, height: 24 }}
            onClick={() => handleSend()}
            disabled={loading}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
