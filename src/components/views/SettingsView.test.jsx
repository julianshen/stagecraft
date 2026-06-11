import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SettingsView from './SettingsView.jsx';
import { callLLM, LLMError } from '../../lib/llmClient.js';

// Stub only the network-bound call; keep the real LLMError/describeLLMError so
// these tests assert the actual user-facing copy.
vi.mock('../../lib/llmClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  callLLM: vi.fn(),
}));

// Minimal localStorage mock — jsdom in vitest doesn't expose localStorage
// unless --localstorage-file is set; stub it ourselves.
const store = new Map();
const localStorageMock = {
  getItem:    (k) => store.has(k) ? store.get(k) : null,
  setItem:    (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear:      () => store.clear(),
};

const tw = { theme: 'light', accent: 'indigo', density: 'default', layout: 'default' };
const renderSettings = () => render(<SettingsView tw={tw} setTw={vi.fn()} />);

beforeEach(() => {
  store.clear();
  callLLM.mockReset();
  vi.stubGlobal('localStorage', localStorageMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('AI settings — Base URL persistence', () => {
  it('persists an edited Base URL for the keyless Local provider', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Local'));
    const input = screen.getByDisplayValue('http://localhost:11434/v1');
    fireEvent.change(input, { target: { value: 'http://lmstudio:1234/v1' } });
    expect(JSON.parse(store.get('stagecraft.ai')).baseUrl).toBe('http://lmstudio:1234/v1');
  });

  it('shows the stored Base URL instead of the default', () => {
    store.set('stagecraft.ai', JSON.stringify({ provider: 'local', model: 'llama-3.3-70b', baseUrl: 'http://lmstudio:1234/v1' }));
    renderSettings();
    expect(screen.getByDisplayValue('http://lmstudio:1234/v1')).toBeInTheDocument();
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
      expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4', maxTokens: 10, temperature: 0 }),
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
    fireEvent.change(ranges[2], { target: { value: '1024' } }); // max tokens
    expect(JSON.parse(store.get('stagecraft.ai')).maxTokens).toBe(1024);
    const routing = container.querySelectorAll('.routing-select select')[0];
    fireEvent.change(routing, { target: { value: 'gpt-4o' } });
    expect(routing.value).toBe('gpt-4o');
    fireEvent.click(screen.getByText('Log prompts locally')); // privacy toggle
    fireEvent.click(screen.getByText('Reset to defaults'));
    expect(JSON.parse(store.get('stagecraft.ai')).provider).toBe('anthropic');
    expect(JSON.parse(store.get('stagecraft.ai')).apiKey).toBe('');
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

  it('general and export rows respond to clicks', () => {
    renderSettings();
    fireEvent.click(screen.getByText('General'));
    fireEvent.click(screen.getByText('4:3'));       // Seg
    fireEvent.click(screen.getByText('Autosave'));  // ToggleRow
    fireEvent.click(screen.getByText('Export defaults'));
    fireEvent.click(screen.getByText('Standard'));      // Seg
    fireEvent.click(screen.getByText('Speaker notes')); // ToggleRow
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
