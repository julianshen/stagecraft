import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import SettingsView from './SettingsView.jsx';
import { callLLM, LLMError, LOCAL_DEFAULT_BASE } from '../../lib/llmClient.js';
import { stubLocalStorage } from '../../test/localStorage.js';

// Stub only the network-bound call; keep the real LLMError/describeLLMError so
// these tests assert the actual user-facing copy.
vi.mock('../../lib/llmClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  callLLM: vi.fn(),
}));

const store = stubLocalStorage();

const tw = { theme: 'light', accent: 'indigo', density: 'default', layout: 'default' };
const renderSettings = () => render(<SettingsView tw={tw} setTw={vi.fn()} />);

beforeEach(() => { callLLM.mockReset(); });

describe('AI settings — Base URL persistence', () => {
  it('persists an edited Base URL for the keyless Local provider', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Local'));
    // Unset state shows the effective default as a placeholder, not a value.
    const input = screen.getByPlaceholderText(LOCAL_DEFAULT_BASE);
    fireEvent.change(input, { target: { value: 'http://lmstudio:1234/v1' } });
    expect(JSON.parse(store.get('stagecraft.ai')).baseUrl).toBe('http://lmstudio:1234/v1');
  });

  it('shows the stored Base URL instead of the default', () => {
    store.set('stagecraft.ai', JSON.stringify({ provider: 'local', model: 'llama-3.3-70b', baseUrl: 'http://lmstudio:1234/v1' }));
    renderSettings();
    expect(screen.getByDisplayValue('http://lmstudio:1234/v1')).toBeInTheDocument();
  });

  it('clearing (or blanking) the field removes the stored baseUrl entirely', () => {
    store.set('stagecraft.ai', JSON.stringify({ provider: 'local', model: 'llama-3.3-70b', baseUrl: 'http://lmstudio:1234/v1' }));
    renderSettings();
    fireEvent.change(screen.getByDisplayValue('http://lmstudio:1234/v1'), { target: { value: '   ' } });
    expect(JSON.parse(store.get('stagecraft.ai'))).not.toHaveProperty('baseUrl');
  });

  it('offers the Base URL field for the Custom provider too (it needs a key AND an endpoint)', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Custom'));
    expect(screen.getByText('Base URL')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-…')).toBeInTheDocument();
  });

  it('Reset to defaults clears the stored baseUrl', () => {
    store.set('stagecraft.ai', JSON.stringify({ provider: 'local', model: 'llama-3.3-70b', baseUrl: 'http://lmstudio:1234/v1' }));
    renderSettings();
    fireEvent.click(screen.getByText('Reset to defaults'));
    expect(JSON.parse(store.get('stagecraft.ai'))).not.toHaveProperty('baseUrl');
  });
});

describe('AI settings — Test connection', () => {
  it('routes the test through callLLM and shows Connected', async () => {
    store.set('stagecraft.ai', JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4', apiKey: 'sk-x' }));
    callLLM.mockResolvedValue('pong');
    renderSettings();
    fireEvent.click(screen.getByText('Test connection'));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(callLLM).toHaveBeenCalledWith(
      [{ role: 'user', content: 'ping' }],
      { maxTokens: 10, temperature: 0 },
    );
  });

  it('shows the classified reason when the test fails', async () => {
    callLLM.mockRejectedValue(new LLMError('unconfigured', 'No API key configured'));
    renderSettings();
    fireEvent.click(screen.getByText('Test connection'));
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(await screen.findByText(/add one in Settings/)).toBeInTheDocument();
  });

  it('offers Test connection for the keyless Local provider too', async () => {
    callLLM.mockResolvedValue('pong');
    renderSettings();
    fireEvent.click(screen.getByText('Local'));
    fireEvent.click(screen.getByText('Test connection'));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });

  it('clears the previous test result when switching provider', async () => {
    callLLM.mockRejectedValue(new LLMError('auth', 'bad key'));
    renderSettings();
    fireEvent.click(screen.getByText('Test connection'));
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/rejected your API key/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('OpenAI'));
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText(/rejected your API key/)).toBeNull();
  });

  it('editing a setting invalidates the previous test result', async () => {
    callLLM.mockRejectedValue(new LLMError('auth', 'bad key'));
    renderSettings();
    fireEvent.click(screen.getByText('Test connection'));
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-fixed' } });
    expect(screen.queryByText('Failed')).toBeNull(); // result no longer describes the new config
    expect(screen.queryByText(/rejected your API key/)).toBeNull();
  });

  it('discards an in-flight result that lands after a provider switch', async () => {
    let reject;
    callLLM.mockReturnValue(new Promise((_, r) => { reject = r; }));
    renderSettings();
    fireEvent.click(screen.getByText('Test connection'));
    fireEvent.click(screen.getByText('OpenAI')); // switch while the test is in flight
    await act(async () => { reject(new LLMError('auth', 'bad key')); }); // settle + flush React
    expect(screen.queryByText('Failed')).toBeNull(); // stale verdict not applied to the new provider
    expect(screen.getByText('Test connection')).toBeInTheDocument();
  });

  it('ignores clicks while a test is in flight', async () => {
    let resolve;
    callLLM.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderSettings();
    fireEvent.click(screen.getByText('Test connection'));
    fireEvent.click(screen.getByText('Testing…'));
    expect(callLLM).toHaveBeenCalledTimes(1);
    resolve('pong');
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });
});

describe('settings interactions', () => {
  it('Reset to defaults snaps the sliders back too (no UI/storage divergence)', () => {
    const { container } = renderSettings();
    const ranges = container.querySelectorAll('input[type="range"]');
    fireEvent.change(ranges[0], { target: { value: '0.9' } });  // temperature
    fireEvent.change(ranges[1], { target: { value: '0.5' } });  // top-p
    fireEvent.change(ranges[2], { target: { value: '1024' } }); // max tokens
    fireEvent.click(screen.getByText('Reset to defaults'));
    expect(ranges[0].value).toBe('0.6');
    expect(ranges[1].value).toBe('1');
    expect(ranges[2].value).toBe('4096');
    expect(JSON.parse(store.get('stagecraft.ai'))).toMatchObject({ temperature: 0.6, maxTokens: 4096 });
  });

  it('flags the Temperature slider as overridden while Top-p is set', () => {
    const { container } = renderSettings();
    const ranges = container.querySelectorAll('input[type="range"]');
    fireEvent.change(ranges[1], { target: { value: '0.5' } }); // set top-p
    expect(screen.getByText(/Overridden by Top-p/i)).toBeInTheDocument();
    fireEvent.change(ranges[1], { target: { value: '1' } });   // back to unset
    expect(screen.queryByText(/Overridden by Top-p/i)).toBeNull();
  });

  it('renders exactly one Test connection button for the Custom provider (key + Base URL rows)', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Custom'));
    expect(screen.getAllByRole('button', { name: /Test connection/ })).toHaveLength(1);
  });

  it('exercises the AI section controls (model, sliders, routing, reset, key)', () => {
    const { container } = renderSettings();
    fireEvent.click(container.querySelector('.input-group .iconbtn')); // show/hide key
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-test' } });
    expect(JSON.parse(store.get('stagecraft.ai')).apiKey).toBe('sk-test');
    fireEvent.click(within(container.querySelector('.model-list')).getByText('Claude Opus 4'));
    expect(JSON.parse(store.get('stagecraft.ai')).model).toBe('claude-opus-4');
    const ranges = container.querySelectorAll('input[type="range"]');
    fireEvent.change(ranges[0], { target: { value: '0.1' } }); // temperature
    expect(screen.getByText('Precise')).toBeInTheDocument();
    fireEvent.change(ranges[0], { target: { value: '0.9' } });
    expect(screen.getByText('Creative')).toBeInTheDocument();
    fireEvent.change(ranges[1], { target: { value: '0.5' } }); // top-p
    expect(JSON.parse(store.get('stagecraft.ai')).topP).toBe(0.5);
    // Sliding back to 1.0 (≡ full nucleus ≡ unset) removes the key, so the
    // proxy stops sending top_p alongside temperature.
    fireEvent.change(ranges[1], { target: { value: '1' } });
    expect(JSON.parse(store.get('stagecraft.ai'))).not.toHaveProperty('topP');
    fireEvent.change(ranges[1], { target: { value: '0.5' } }); // back for the reset test below
    fireEvent.change(ranges[2], { target: { value: '1024' } }); // max tokens
    expect(JSON.parse(store.get('stagecraft.ai')).maxTokens).toBe(1024);
    const routing = container.querySelectorAll('.routing-select select')[0];
    fireEvent.change(routing, { target: { value: 'gpt-4o' } });
    expect(routing.value).toBe('gpt-4o');
    fireEvent.click(screen.getByText('Log prompts locally')); // privacy toggle
    fireEvent.click(screen.getByText('Reset to defaults'));
    expect(JSON.parse(store.get('stagecraft.ai')).provider).toBe('anthropic');
    expect(JSON.parse(store.get('stagecraft.ai')).apiKey).toBe('');
    expect(JSON.parse(store.get('stagecraft.ai'))).not.toHaveProperty('topP'); // the 0.5 set above is wiped
  });

  it('appearance controls call setTw for every axis', () => {
    const setTw = vi.fn();
    render(<SettingsView tw={tw} setTw={setTw} />);
    fireEvent.click(screen.getByText('Appearance'));
    fireEvent.click(screen.getByText('Dark'));
    fireEvent.click(screen.getByTitle('Emerald'));
    fireEvent.click(screen.getByText('Cozy'));
    fireEvent.click(screen.getByText('Floating'));
    expect(setTw).toHaveBeenCalledTimes(4);
  });

  it('export rows respond to clicks', () => {
    const { container } = renderSettings();
    fireEvent.click(screen.getByText('Export defaults'));
    expect(container.querySelectorAll('.switch.on').length).toBe(3);
    fireEvent.click(screen.getByText('Standard'));      // Seg
    fireEvent.click(screen.getByText('Speaker notes')); // ToggleRow flips off
    expect(container.querySelectorAll('.switch.on').length).toBe(2);
  });
});

describe('General section honesty (Task 4)', () => {
  function openGeneral() {
    fireEvent.click(screen.getByText('General'));
  }

  // AC-4.1: the four inert controls (Autosave, slide size, Language, Spell
  // check) render disabled, each with a Soon/Always-on affordance.
  it('AC-4.1: inert controls are disabled with a Soon affordance', () => {
    renderSettings();
    openGeneral();

    // One "Coming soon" pill per inert control.
    const tags = screen.getAllByLabelText('Coming soon');
    expect(tags).toHaveLength(4);
    expect(tags.some(t => t.textContent === 'Always on')).toBe(true); // Autosave reads "already handled"

    // Slide-size Seg buttons carry a real disabled attribute.
    for (const label of ['16:9', '4:3', '1:1']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }

    // Language select is truly disabled.
    expect(screen.getByRole('combobox')).toBeDisabled();

    // Inert toggle rows expose aria-disabled on the interactive row…
    expect(screen.getByText('Autosave').closest('.toggle-row')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Spell check').closest('.toggle-row')).toHaveAttribute('aria-disabled', 'true');
    // …while the Task-5 toggles stay enabled.
    expect(screen.getByText('Snap to grid').closest('.toggle-row')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Show rulers').closest('.toggle-row')).not.toHaveAttribute('aria-disabled', 'true');
  });

  // AC-4.2: a disabled control accepts no change and never writes
  // localStorage['stagecraft.general'].
  it('AC-4.2: interacting with each disabled control writes nothing to localStorage', () => {
    renderSettings();
    openGeneral();

    const autosaveRow = screen.getByText('Autosave').closest('.toggle-row');
    const autosaveSwitch = autosaveRow.querySelector('.switch');
    expect(autosaveSwitch.classList.contains('on')).toBe(true); // always on

    fireEvent.click(autosaveRow);
    fireEvent.click(screen.getByText('Spell check').closest('.toggle-row'));
    fireEvent.click(screen.getByRole('button', { name: '4:3' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr-FR' } });

    expect(autosaveSwitch.classList.contains('on')).toBe(true); // did not flip
    expect(store.has('stagecraft.general')).toBe(false);        // nothing persisted
  });

  // AC-4.2 (persisted shape): only the keys something reads survive — the
  // live toggles keep persisting, legacy inert keys are not resurrected.
  it('AC-4.2: persisted shape contains only snapToGrid and showRulers', () => {
    store.set('stagecraft.general', JSON.stringify({
      slideSize: '4:3', language: 'fr-FR', autosave: false, spellCheck: false,
      snapToGrid: true, showRulers: true,
    }));
    renderSettings();
    openGeneral();

    fireEvent.click(screen.getByText('Snap to grid').closest('.toggle-row'));

    const persisted = JSON.parse(store.get('stagecraft.general'));
    expect(Object.keys(persisted).sort()).toEqual(['showRulers', 'snapToGrid']);
    expect(persisted.snapToGrid).toBe(false);
    expect(persisted.showRulers).toBe(true);
  });

  it('persists showRulers back to true when toggled twice', () => {
    renderSettings();
    openGeneral();
    const row = screen.getByText('Show rulers').closest('.toggle-row');
    fireEvent.click(row);
    expect(JSON.parse(store.get('stagecraft.general')).showRulers).toBe(false);
    fireEvent.click(row);
    expect(JSON.parse(store.get('stagecraft.general')).showRulers).toBe(true);
  });

  it('loads snapToGrid:false from localStorage on mount', () => {
    store.set('stagecraft.general', JSON.stringify({ snapToGrid: false, showRulers: true }));
    renderSettings();
    openGeneral();
    const snapSwitch = screen.getByText('Snap to grid').closest('.toggle-row').querySelector('.switch');
    expect(snapSwitch.classList.contains('on')).toBe(false);
  });

  it('leaves defaults intact for keys absent from the stored object', () => {
    store.set('stagecraft.general', JSON.stringify({ showRulers: false }));
    renderSettings();
    openGeneral();
    const snapSwitch = screen.getByText('Snap to grid').closest('.toggle-row').querySelector('.switch');
    expect(snapSwitch.classList.contains('on')).toBe(true);
  });
});

describe('navigation smoke', () => {
  it('renders every settings section', () => {
    renderSettings();
    fireEvent.click(screen.getByText('General'));
    expect(screen.getByText('Default slide size')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Appearance'));
    expect(screen.getByText('Accent color')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Export defaults'));
    expect(screen.getByText('Default format')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Shortcuts'));
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
    fireEvent.click(screen.getByText('AI & Co-pilot'));
    expect(screen.getByText('Task routing')).toBeInTheDocument();
  });
});
