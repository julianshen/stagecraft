import { useState } from 'react';
import { Button, IconButton } from '../ui/Primitives.jsx';
import { draftOutline, buildDeck } from '../../lib/aiDeck.js';
import { describeLLMError } from '../../lib/llmClient.js';

// LLM failures carry a classified `reason` (describeLLMError words them for the
// user); anything else — e.g. an unusable outline — already has a readable message.
const errorText = (err) => (err?.reason ? describeLLMError(err) : err?.message || describeLLMError(err));

// "Start with AI": describe a topic → review the drafted outline (drop slides
// you don't want) → generate the slides with live progress → `onCreate(deck)`,
// which saves and opens it. Errors keep the dialog open on the step that failed.
export default function AiDeckModal({ onClose, onCreate }) {
  const [step, setStep] = useState('topic'); // 'topic' | 'outline' | 'building'
  const [topic, setTopic] = useState('');
  const [outline, setOutline] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState(null);

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      setOutline(await draftOutline(topic));
      setStep('outline');
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  async function generate() {
    setStep('building');
    setDone(0);
    setError(null);
    try {
      const deck = await buildDeck(outline, { onProgress: (n) => setDone(n) });
      await onCreate(deck);
    } catch (err) {
      setError(errorText(err));
      setStep('outline');
    }
  }

  const remove = (i) => setOutline((o) => ({ ...o, slides: o.slides.filter((_, j) => j !== i) }));
  const count = outline?.slides.length || 0;

  return (
    <div className="modal-backdrop" onClick={busy || step === 'building' ? undefined : onClose}>
      <div className="modal medium" role="dialog" aria-label="Start with AI" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Start with AI</h3>
          <IconButton name="x" title="Close" onClick={onClose} disabled={step === 'building'}/>
        </div>
        <div className="modal-body">
          {step === 'topic' && (
            <textarea
              aria-label="Deck topic"
              className="ai-deck-topic"
              autoFocus
              rows={4}
              placeholder="Make a deck about… e.g. “Q3 results for the leadership team: revenue, churn, and next quarter's bets”"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          )}
          {step !== 'topic' && outline && (
            <>
              <h4 className="ai-deck-title">{outline.title}</h4>
              <ol className="ai-deck-outline">
                {outline.slides.map((s, i) => (
                  <li key={`${i}-${s.title}`}>
                    <span className="layout">{s.layout}</span>
                    <span className="t">{s.title}</span>
                    {s.brief && <span className="b">{s.brief}</span>}
                    {step === 'outline' && count > 1 && (
                      <IconButton name="x" size={11} title={`Remove ${s.title}`} onClick={() => remove(i)}/>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="ai-deck-status" role={error ? 'alert' : 'status'}>
            {error || (step === 'building' ? `Generating slide ${Math.min(done + 1, count)} of ${count}…` : '')}
          </span>
          {step === 'topic' && (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="accent" icon="ai" onClick={draft} disabled={busy || !topic.trim()}>
                {busy ? 'Drafting…' : 'Draft outline'}
              </Button>
            </>
          )}
          {step === 'outline' && (
            <>
              <Button variant="ghost" onClick={() => { setStep('topic'); setError(null); }}>Back</Button>
              <Button variant="accent" icon="ai" onClick={generate}>
                {`Generate ${count} ${count === 1 ? 'slide' : 'slides'}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
