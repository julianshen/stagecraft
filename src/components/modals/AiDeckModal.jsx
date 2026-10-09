import { useState, useEffect, useRef } from 'react';
import { Button, IconButton } from '../ui/Primitives.jsx';
import { draftOutline, buildDeck } from '../../lib/aiDeck.js';
import { describeLLMError } from '../../lib/llmClient.js';

// "Start with AI": describe a topic → review the drafted outline (drop slides
// you don't want) → generate the slides with live progress → `onCreate(deck)`,
// which saves and opens it. Errors keep the dialog open on the step that failed,
// and nothing already paid for is thrown away: a generation failure resumes
// after the slides that succeeded, a save failure retries only the save.
export function AiDeckModal({ onClose, onCreate }) {
  const [step, setStep] = useState('topic'); // 'topic' | 'drafting' | 'outline' | 'building'
  const [topic, setTopic] = useState('');
  const [outline, setOutline] = useState(null);
  const [partial, setPartial] = useState([]);  // slides generated before a failure
  const [built, setBuilt] = useState(null);    // the finished deck, if only the save failed
  const [done, setDone] = useState(0);
  const [error, setError] = useState(null);

  // A request that settles after the dialog is gone (closed by the app, a view
  // switch) must not create a deck the user no longer expects.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // App closes any modal on Escape (window listener). Past the topic step that
  // would discard a drafted outline or abandon an in-flight build, so swallow
  // Escape here first (capture phase) — the explicit Cancel / × still close.
  const guarded = step !== 'topic';
  useEffect(() => {
    if (!guarded) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') e.stopImmediatePropagation(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [guarded]);

  async function draft() {
    setStep('drafting');
    setError(null);
    try {
      setOutline(await draftOutline(topic));
      setStep('outline');
    } catch (err) {
      setError(describeLLMError(err));
      setStep('topic');
    }
  }

  async function save(deck) {
    if (!alive.current) return;
    try {
      await onCreate(deck);
    } catch (err) {
      setBuilt(deck);
      setError(err?.message || 'Couldn’t save the deck — try again.');
      setStep('outline');
    }
  }

  async function generate() {
    setStep('building');
    setDone(partial.length);
    setError(null);
    let deck;
    try {
      deck = await buildDeck(outline, { onProgress: (n) => setDone(n), done: partial });
    } catch (err) {
      setPartial(err?.partial || partial);
      setError(describeLLMError(err));
      setStep('outline');
      return;
    }
    await save(deck);
  }

  function retrySave() {
    setStep('building');
    setError(null);
    save(built);
  }

  // Back to the topic discards the outline and anything generated from it.
  function back() {
    setStep('topic');
    setError(null);
    setPartial([]);
    setBuilt(null);
  }

  const remove = (i) => setOutline((o) => ({ ...o, slides: o.slides.filter((_, j) => j !== i) }));
  const count = outline?.slides.length || 0;
  const locked = step === 'drafting' || step === 'building'; // a request is in flight
  const editingTopic = step === 'topic' || step === 'drafting';
  // Once slides exist the outline is frozen, so a resume stays aligned with it.
  const editable = step === 'outline' && !partial.length && !built;

  // Only the topic step closes on a backdrop click — a stray click must not
  // discard a drafted outline or generated slides (Cancel / × still close).
  return (
    <div className="modal-backdrop" onClick={step === 'topic' ? onClose : undefined}>
      <div className="modal medium" role="dialog" aria-label="Start with AI" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Start with AI</h3>
          <IconButton name="x" title="Close" onClick={onClose} disabled={locked}/>
        </div>
        <div className="modal-body">
          {editingTopic && (
            <textarea
              aria-label="Deck topic"
              className="ai-deck-topic"
              autoFocus
              rows={4}
              placeholder="Make a deck about… e.g. “Q3 results for the leadership team: revenue, churn, and next quarter's bets”"
              value={topic}
              readOnly={locked}
              onChange={(e) => setTopic(e.target.value)}
            />
          )}
          {!editingTopic && (
            <>
              <h4 className="ai-deck-title">{outline.title}</h4>
              <ol className="ai-deck-outline">
                {outline.slides.map((s, i) => (
                  <li key={`${i}-${s.title}`}>
                    <span className="layout">{s.layout}</span>
                    <span className="t">{s.title}</span>
                    {s.brief && <span className="b">{s.brief}</span>}
                    {editable && count > 1 && (
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
            {error || (step === 'building' ? (done >= count ? 'Saving…' : `Generating slide ${done + 1} of ${count}…`) : '')}
          </span>
          {editingTopic && (
            <>
              <Button variant="ghost" onClick={onClose} disabled={locked}>Cancel</Button>
              <Button variant="accent" icon="ai" onClick={draft} disabled={locked || !topic.trim()}>
                {locked ? 'Drafting…' : 'Draft outline'}
              </Button>
            </>
          )}
          {step === 'outline' && (
            <>
              <Button variant="ghost" onClick={back}>Back</Button>
              {built
                ? <Button variant="accent" onClick={retrySave}>Retry save</Button>
                : (
                  <Button variant="accent" icon="ai" onClick={generate}>
                    {partial.length
                      ? `Resume (${partial.length} of ${count} done)`
                      : `Generate ${count} ${count === 1 ? 'slide' : 'slides'}`}
                  </Button>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
