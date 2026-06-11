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
    const { container } = renderSettings();
    fireEvent.click(screen.getByText('General'));
    fireEvent.click(screen.getByText('4:3'));       // Seg
    fireEvent.click(screen.getByText('Autosave'));  // ToggleRow: switch flips off
    expect(container.querySelectorAll('.switch.on').length).toBe(3);
    fireEvent.click(screen.getByText('Export defaults'));
    fireEvent.click(screen.getByText('Standard'));      // Seg
    fireEvent.click(screen.getByText('Speaker notes')); // ToggleRow
    expect(container.querySelectorAll('.switch.on').length).toBe(2);
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
