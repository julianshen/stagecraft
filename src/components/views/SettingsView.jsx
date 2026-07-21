import { useState, useEffect, useRef } from 'react';
import Icon from '../ui/Icon.jsx';
import SoonTag from '../ui/SoonTag.jsx';
import { Button, Seg, FieldRow } from '../ui/Primitives.jsx';
import { ACCENTS } from '../../data/deck.js';
import { callLLM, describeLLMError, LOCAL_DEFAULT_BASE } from '../../lib/llmClient.js';
import { GENERAL_STORAGE_KEY, readGeneralSettings } from '../../lib/generalSettings.js';

// ---- provider + model catalog ----
const PROVIDERS = [
  { id: 'anthropic',  name: 'Anthropic',  mark: 'A',   hint: 'Claude family',                      endpoint: 'api.anthropic.com',                  needsKey: true },
  { id: 'openai',     name: 'OpenAI',     mark: 'O',   hint: 'GPT family',                         endpoint: 'api.openai.com',                     needsKey: true },
  { id: 'google',     name: 'Google',     mark: 'G',   hint: 'Gemini family',                      endpoint: 'generativelanguage.googleapis.com',  needsKey: true },
  { id: 'openrouter', name: 'OpenRouter', mark: 'OR',  hint: '400+ models, one key',               endpoint: 'openrouter.ai/api/v1',               needsKey: true },
  { id: 'local',      name: 'Local',      mark: '·',   hint: 'Ollama / LM Studio',                 endpoint: new URL(LOCAL_DEFAULT_BASE).host,     needsKey: false, hasBaseUrl: true },
  { id: 'custom',     name: 'Custom',     mark: '{}',  hint: 'OpenAI / Anthropic-compatible',      endpoint: 'your-endpoint',                      needsKey: true, hasBaseUrl: true, custom: true },
];

const MODELS = {
  anthropic: [
    { id: 'claude-opus-4',    name: 'Claude Opus 4',   ctx: '200K', tier: 'Frontier', speed: 2, cost: '$$$' },
    { id: 'claude-sonnet-4',  name: 'Claude Sonnet 4', ctx: '200K', tier: 'Balanced', speed: 4, cost: '$$' },
    { id: 'claude-haiku-3.5', name: 'Claude Haiku 3.5',ctx: '200K', tier: 'Fast',     speed: 5, cost: '$' },
  ],
  openai: [
    { id: 'gpt-4o',   name: 'GPT-4o',   ctx: '128K', tier: 'Balanced', speed: 4, cost: '$$' },
    { id: 'gpt-4.1',  name: 'GPT-4.1',  ctx: '1M',   tier: 'Frontier', speed: 3, cost: '$$$' },
    { id: 'o3-mini',  name: 'o3-mini',  ctx: '200K', tier: 'Reasoning',speed: 3, cost: '$$' },
  ],
  google: [
    { id: 'gemini-2.5-pro',   name: 'Gemini 2.5 Pro',   ctx: '1M', tier: 'Frontier', speed: 3, cost: '$$$' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', ctx: '1M', tier: 'Fast',     speed: 5, cost: '$' },
  ],
  openrouter: [
    { id: 'or-claude-sonnet-4', name: 'anthropic/claude-sonnet-4', ctx: '200K', tier: 'Balanced', speed: 4, cost: '$$' },
    { id: 'or-gpt-4o',          name: 'openai/gpt-4o',             ctx: '128K', tier: 'Balanced', speed: 4, cost: '$$' },
    { id: 'or-llama-3.3',       name: 'meta/llama-3.3-70b',        ctx: '128K', tier: 'Open',     speed: 4, cost: '$' },
  ],
  local: [
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', ctx: '128K', tier: 'Local', speed: 3, cost: 'free' },
    { id: 'qwen-2.5-32b',  name: 'Qwen 2.5 32B',  ctx: '32K',  tier: 'Local', speed: 4, cost: 'free' },
  ],
  custom: [
    { id: 'custom-model', name: 'your-model-id', ctx: '—', tier: 'Custom', speed: 3, cost: '—' },
  ],
};

const SETTINGS_NAV = [
  { id: 'general',    label: 'General',        icon: 'settings' },
  { id: 'appearance', label: 'Appearance',     icon: 'palette' },
  { id: 'ai',         label: 'AI & Co-pilot',  icon: 'ai' },
  { id: 'export',     label: 'Export defaults',icon: 'download' },
  { id: 'shortcuts',  label: 'Shortcuts',      icon: 'key' },
];

// ---- reusable settings primitives ----
function SettingsHeader({ title, sub }) {
  return (
    <div className="settings-hd">
      <h1>{title}</h1>
      <p>{sub}</p>
    </div>
  );
}

function Section({ label, desc, children }) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <h3>{label}</h3>
        {desc && <p>{desc}</p>}
      </div>
      <div className="set-section-body">{children}</div>
    </section>
  );
}

function ParamSlider({ label, value, min, max, step, onChange, hint }) {
  return (
    <div className="param-cell">
      <div className="param-head"><span>{label}</span><span className="param-val">{Number(value).toFixed(2)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} className="range"/>
      <div className="param-hint">{hint}</div>
    </div>
  );
}

function ToggleRow({ title, sub, on, onChange, disabled = false, tag = null }) {
  const [v, setV] = useState(!!on);
  const toggle = () => { if (disabled) return; const next = !v; setV(next); onChange?.(next); };
  return (
    <div className={`toggle-row${disabled ? ' is-soon' : ''}`} onClick={toggle} aria-disabled={disabled || undefined}>
      <div className="toggle-meta">
        <div className="toggle-t">{title}{tag}</div>
        <div className="toggle-s">{sub}</div>
      </div>
      <div className={`switch ${v ? 'on' : ''}`}><div className="knob"/></div>
    </div>
  );
}

// ---- AI settings section ----
function AISettings() {
  // Load from localStorage on mount
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('stagecraft.ai');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { provider: 'anthropic', model: 'claude-sonnet-4', temperature: 0.6, maxTokens: 4096, apiKey: '' };
  });

  const [keyShown, setKeyShown] = useState(false);
  // Connection test: phase idle | testing | ok | error (+ classified copy).
  // Any settings edit bumps `testSeq`, both resetting the visible result and
  // discarding a still-in-flight test that no longer describes the config.
  const [test, setTest] = useState({ phase: 'idle' });
  const testSeq = useRef(0);
  // The tuning knobs render straight from the saved settings — no mirror
  // state to drift from storage (e.g. on Reset).
  const temp = settings.temperature ?? 0.6;
  const maxTok = settings.maxTokens ?? 4096;
  const topP = settings.topP ?? 1.0;

  const [routing, setRouting] = useState({
    generate: 'claude-opus-4',
    rewrite:  'claude-sonnet-4',
    notes:    'claude-haiku-3.5',
    data:     'claude-sonnet-4',
  });

  const provider = settings.provider || 'anthropic';
  const model    = settings.model    || 'claude-sonnet-4';

  const prov    = PROVIDERS.find(p => p.id === provider);
  const models  = MODELS[provider] || [];
  const curModel = models.find(m => m.id === model) || models[0];

  function save(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { localStorage.setItem('stagecraft.ai', JSON.stringify(next)); } catch {}
    // The config changed — a previous (or in-flight) test no longer describes it.
    testSeq.current += 1;
    setTest({ phase: 'idle' });
  }

  function pickProvider(id) {
    const first = (MODELS[id] || [])[0];
    save({ provider: id, model: first ? first.id : '' });
  }

  async function testConn() {
    const seq = ++testSeq.current;
    setTest({ phase: 'testing' });
    try {
      // Everything but the test-specific tuning comes from the saved settings
      // (kept current by save()), same as every other callLLM caller; a
      // failure throws a classified LLMError so the panel can say *why*.
      await callLLM([{ role: 'user', content: 'ping' }], { maxTokens: 10, temperature: 0 });
      if (seq === testSeq.current) setTest({ phase: 'ok' });
    } catch (err) {
      if (seq === testSeq.current) setTest({ phase: 'error', error: describeLLMError(err) });
    }
  }

  const allModels = Object.entries(MODELS).flatMap(([pid, list]) =>
    list.map(m => ({ ...m, providerName: PROVIDERS.find(p => p.id === pid)?.name || pid })));

  const testButton = (
    <button className="btn outline" onClick={testConn} disabled={test.phase === 'testing'} style={{ height: 30 }}>
      {test.phase === 'testing' ? <><Icon name="refresh" size={12} style={{ animation: 'spin .65s linear infinite' }}/> Testing…</>
       : test.phase === 'ok'    ? <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={12}/> Connected</span>
       : test.phase === 'error' ? <span style={{ color: 'var(--warn)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="x" size={12}/> Failed</span>
       : 'Test connection'}
    </button>
  );

  return (
    <div className="settings-scroll">
      <SettingsHeader
        title="AI & Co-pilot"
        sub="Connect a language-model provider and choose which models power slide generation, rewriting and speaker notes."
      />

      <Section label="Provider" desc="Where Co-pilot requests are sent. Bring your own key — requests go directly to the provider.">
        <div className="provider-grid">
          {PROVIDERS.map(p => (
            <button key={p.id} className={`provider-card ${provider === p.id ? 'active' : ''}`} onClick={() => pickProvider(p.id)}>
              <div className="provider-mark">{p.mark}</div>
              <div className="provider-meta">
                <div className="provider-name">{p.name}</div>
                <div className="provider-hint">{p.hint}</div>
              </div>
              {provider === p.id && <div className="provider-check"><Icon name="check" size={12}/></div>}
            </button>
          ))}
        </div>
      </Section>

      <Section label="Connection" desc={`Endpoint · ${prov?.endpoint}`}>
        {prov?.needsKey && (
          <div className="set-row">
            <div className="set-row-label">
              <div className="srl-title">API key</div>
              <div className="srl-sub">Stored locally in your browser, never sent to Stagecraft servers.</div>
            </div>
            <div className="set-row-control" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="input-group" style={{ width: 280 }}>
                <span className="ico"><Icon name="key" size={12}/></span>
                <input
                  type={keyShown ? 'text' : 'password'}
                  value={settings.apiKey || ''}
                  placeholder="sk-…"
                  onChange={e => save({ apiKey: e.target.value })}
                  style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5 }}
                />
                <button className="iconbtn" style={{ width: 20, height: 20 }} onClick={() => setKeyShown(v => !v)}>
                  <Icon name={keyShown ? 'eye-off' : 'eye'} size={12}/>
                </button>
              </div>
              {testButton}
            </div>
          </div>
        )}
        {prov?.hasBaseUrl && (
          <div className="set-row">
            <div className="set-row-label">
              <div className="srl-title">Base URL</div>
              <div className="srl-sub">{prov?.needsKey ? 'OpenAI-compatible endpoint for your gateway.' : 'Point at a local Ollama or LM Studio server.'}</div>
            </div>
            <div className="set-row-control" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="input-group" style={{ width: 280 }}>
                <span className="ico"><Icon name="link" size={12}/></span>
                <input
                  value={settings.baseUrl ?? ''}
                  placeholder={provider === 'local' ? LOCAL_DEFAULT_BASE : 'https://your-endpoint/v1'}
                  onChange={e => save({ baseUrl: e.target.value.trim() || undefined })}
                  style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5 }}
                />
              </div>
              {/* Keyed providers (Custom) already have the button on the key row. */}
              {!prov?.needsKey && testButton}
            </div>
          </div>
        )}
        {/* Always mounted so the role="status" live region announces changes. */}
        <div role="status" style={{ padding: test.error ? '8px 0 0' : 0, fontSize: 12, color: 'var(--warn)' }}>{test.error || ''}</div>
      </Section>

      <Section label="Default model" desc="Used unless a task below overrides it.">
        <div className="model-list">
          {models.map(m => (
            <button key={m.id} className={`model-row ${model === m.id ? 'active' : ''}`} onClick={() => save({ model: m.id })}>
              <div className="model-radio"/>
              <div className="model-name">{m.name}</div>
              <span className="model-tier">{m.tier}</span>
              <span className="model-ctx">{m.ctx} ctx</span>
              <span className="model-speed" title="Relative speed">
                {Array.from({ length: 5 }).map((_, i) => <span key={i} className={`spd ${i < m.speed ? 'on' : ''}`}/>)}
              </span>
              <span className="model-cost">{m.cost}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section label="Generation parameters" desc={`Tuning for ${curModel?.name || 'the selected model'}.`}>
        <div className="param-grid">
          <ParamSlider label="Temperature" value={temp} min={0} max={1} step={0.05} onChange={v => save({ temperature: v })}
            hint={topP !== 1 ? 'Overridden by Top-p' : temp <= 0.3 ? 'Precise' : temp >= 0.8 ? 'Creative' : 'Balanced'}/>
          <ParamSlider label="Top-p" value={topP} min={0} max={1} step={0.05} onChange={v => save({ topP: v === 1 ? undefined : v })} hint="Nucleus"/>
          <div className="param-cell">
            <div className="param-head"><span>Max tokens</span><span className="param-val">{maxTok}</span></div>
            <input type="range" min="512" max="16384" step="512" value={maxTok}
              onChange={e => save({ maxTokens: +e.target.value })}
              className="range"/>
            <div className="param-hint">Per response ceiling</div>
          </div>
          <div className="param-cell">
            <div className="param-head"><span>Streaming</span></div>
            <Seg value="on" onChange={() => {}} options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]}/>
            <div className="param-hint">Token-by-token rendering</div>
          </div>
        </div>
      </Section>

      <Section label="Task routing" desc="Send each Co-pilot job to the model that fits it best.">
        <div className="routing-list">
          {[
            { id: 'generate', icon: 'magic',     t: 'Generate slides',   d: 'Full deck & layout synthesis' },
            { id: 'rewrite',  icon: 'text',      t: 'Rewrite & shorten', d: 'Tighten copy, adjust tone' },
            { id: 'notes',    icon: 'document',  t: 'Speaker notes',     d: 'Per-slide talk track' },
            { id: 'data',     icon: 'chart-bar', t: 'Data → chart',      d: 'Turn a dataset into a visual' },
          ].map(task => (
            <div key={task.id} className="routing-row">
              <div className="routing-ic"><Icon name={task.icon} size={14}/></div>
              <div className="routing-meta">
                <div className="routing-t">{task.t}</div>
                <div className="routing-d">{task.d}</div>
              </div>
              <div className="select routing-select">
                <select value={routing[task.id]} onChange={e => setRouting({ ...routing, [task.id]: e.target.value })}>
                  {allModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <Icon name="chevron-down" size={11} className="chev"/>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Privacy & safety" desc="Controls applied before any text leaves your machine.">
        <ToggleRow title="Exclude my data from training" sub="Send the no-retention header where supported." on/>
        <ToggleRow title="Redact emails & numbers in prompts" sub="Mask PII patterns before sending." on/>
        <ToggleRow title="Require confirmation for full-deck generation" sub="Co-pilot asks before replacing more than 3 slides."/>
        <ToggleRow title="Log prompts locally" sub="Keep a 30-day history for debugging." on/>
      </Section>

      <div className="settings-footer-actions">
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-4)' }}>Changes save automatically</span>
        <div style={{ flex: 1 }}/>
        <Button variant="ghost" onClick={() => save({ provider: 'anthropic', model: 'claude-sonnet-4', temperature: 0.6, maxTokens: 4096, apiKey: '', baseUrl: undefined, topP: undefined })}>Reset to defaults</Button>
        <Button variant="accent" icon="check">Saved</Button>
      </div>
    </div>
  );
}

// ---- appearance settings ----
function AppearanceSettings({ tw, setTw }) {
  return (
    <div className="settings-scroll">
      <SettingsHeader title="Appearance" sub="Tune the look of the editor. These mirror the in-canvas Tweaks panel."/>
      <Section label="Theme">
        <Seg value={tw.theme} onChange={v => setTw({ ...tw, theme: v })} options={[{ v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }]}/>
      </Section>
      <Section label="Accent color">
        <div style={{ display: 'flex', gap: 10 }}>
          {Object.entries(ACCENTS).map(([k, v]) => (
            <button key={k} onClick={() => setTw({ ...tw, accent: k })} title={v.name}
              style={{ width: 28, height: 28, borderRadius: '50%', background: `oklch(0.62 ${v.chroma} ${v.hue})`,
                outline: tw.accent === k ? '2px solid var(--ink)' : '1px solid var(--line)',
                outlineOffset: 2, cursor: 'pointer' }}/>
          ))}
        </div>
      </Section>
      <Section label="Density">
        <Seg value={tw.density} onChange={v => setTw({ ...tw, density: v })} options={[{ v: 'compact', l: 'Compact' }, { v: 'default', l: 'Default' }, { v: 'cozy', l: 'Cozy' }]}/>
      </Section>
      <Section label="Editor layout">
        <Seg value={tw.layout} onChange={v => setTw({ ...tw, layout: v })} options={[{ v: 'default', l: '3-column' }, { v: 'left-only', l: '2-column' }, { v: 'floating', l: 'Floating' }]}/>
      </Section>
    </div>
  );
}

// ---- general settings ----
// Only keys something actually reads are persisted (both consumed by the
// canvas via Task 5); the storage key, defaults, and reader are single-sourced
// in lib/generalSettings.js so this writer and the canvas readers agree. Slide
// size / language / autosave / spell check are deliberately inert-and-disabled
// below — no state, no storage.
function GeneralSettings() {
  // readGeneralSettings picks only the live keys, so legacy inert values are
  // dropped, not carried.
  const [settings, setSettings] = useState(readGeneralSettings);

  function save(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { localStorage.setItem(GENERAL_STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  return (
    <div className="settings-scroll">
      <SettingsHeader title="General" sub="Deck defaults and editing behavior."/>
      <Section label="Defaults">
        <div className="set-row">
          <div className="set-row-label"><div className="srl-title">Default slide size <SoonTag/></div></div>
          <div className="set-row-control">
            <Seg value="16:9" disabled onChange={() => {}} options={[{ v: '16:9', l: '16:9' }, { v: '4:3', l: '4:3' }, { v: '1:1', l: '1:1' }]}/>
          </div>
        </div>
        <div className="set-row">
          <div className="set-row-label"><div className="srl-title">Language <SoonTag/></div></div>
          <div className="set-row-control">
            <div className="select is-soon">
              <select value="en-US" disabled onChange={() => {}}>
                <option value="en-US">en-US</option>
                <option value="en-GB">en-GB</option>
                <option value="fr-FR">fr-FR</option>
                <option value="de-DE">de-DE</option>
                <option value="ja-JP">ja-JP</option>
              </select>
              <Icon name="chevron-down" size={11} className="chev"/>
            </div>
          </div>
        </div>
      </Section>
      <Section label="Editing">
        <ToggleRow title="Autosave" sub="Changes save continuously — always on." on disabled tag={<SoonTag label="Always on"/>}/>
        <ToggleRow title="Snap to grid" sub="8px grid with smart guides." on={settings.snapToGrid} onChange={v => save({ snapToGrid: v })}/>
        <ToggleRow title="Show rulers" sub="Pixel rulers on the canvas edges." on={settings.showRulers} onChange={v => save({ showRulers: v })}/>
        <ToggleRow title="Spell check" sub="Underline misspellings while typing." disabled tag={<SoonTag/>}/>
      </Section>
    </div>
  );
}

// ---- export settings ----
function ExportSettings() {
  return (
    <div className="settings-scroll">
      <SettingsHeader title="Export defaults" sub="Preselected options in the export dialog."/>
      <Section label="Format">
        <div className="set-row">
          <div className="set-row-label"><div className="srl-title">Default format</div></div>
          <div className="set-row-control">
            <div className="select">
              <select defaultValue="PowerPoint (.pptx)">
                <option>PowerPoint (.pptx)</option><option>PDF</option><option>Keynote (.key)</option><option>PNG sequence</option>
              </select>
              <Icon name="chevron-down" size={11} className="chev"/>
            </div>
          </div>
        </div>
        <div className="set-row">
          <div className="set-row-label"><div className="srl-title">Quality</div></div>
          <div className="set-row-control">
            <Seg value="high" onChange={() => {}} options={[{ v: 'std', l: 'Standard' }, { v: 'high', l: 'High' }, { v: 'max', l: 'Max' }]}/>
          </div>
        </div>
      </Section>
      <Section label="Include">
        <ToggleRow title="Speaker notes" sub="Attach notes to each slide." on/>
        <ToggleRow title="Live data snapshot" sub="Freeze bound tables at export time." on/>
        <ToggleRow title="Slide numbers" sub="Burn page numbers into the footer." on/>
      </Section>
    </div>
  );
}

// ---- shortcuts ----
function ShortcutSettings() {
  const groups = [
    { g: 'Editing',    rows: [['Present', '⌘ ⏎'], ['New slide', '⌘ N'], ['Duplicate', '⌘ D'], ['Delete slide', '⌫'], ['Co-pilot', '⌘ K']] },
    { g: 'Navigation', rows: [['Search', '⌘ /'], ['Next slide', '→'], ['Prev slide', '←'], ['Slide sorter', '⌘ 2']] },
    { g: 'Format',     rows: [['Bold', '⌘ B'], ['Italic', '⌘ I'], ['Align left', '⌘ ⇧ L'], ['Group', '⌘ G']] },
  ];
  return (
    <div className="settings-scroll">
      <SettingsHeader title="Keyboard shortcuts" sub="The essentials. Most actions also live in the right-click menu."/>
      {groups.map(grp => (
        <Section key={grp.g} label={grp.g}>
          <div className="shortcut-grid">
            {grp.rows.map(([n, k]) => (
              <div key={n} className="shortcut-row"><span>{n}</span><span className="kbd">{k}</span></div>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

// ---- main export ----
export default function SettingsView({ tw, setTw }) {
  const [section, setSection] = useState('ai');
  return (
    <div className="settings">
      <aside className="settings-nav">
        <div className="settings-nav-title">Settings</div>
        {SETTINGS_NAV.map(n => (
          <button key={n.id} className={`settings-nav-item ${section === n.id ? 'active' : ''}`} onClick={() => setSection(n.id)}>
            <Icon name={n.icon} size={14}/> <span>{n.label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }}/>
        <div className="settings-nav-foot">
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10 }}>Stagecraft 2.4.0</span>
        </div>
      </aside>
      <main className="settings-main">
        {section === 'ai'         && <AISettings/>}
        {section === 'appearance' && <AppearanceSettings tw={tw} setTw={setTw}/>}
        {section === 'general'    && <GeneralSettings/>}
        {section === 'export'     && <ExportSettings/>}
        {section === 'shortcuts'  && <ShortcutSettings/>}
      </main>
    </div>
  );
}
