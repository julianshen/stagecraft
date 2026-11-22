import { jsonEqual as equal } from '../lib/jsonEqual.js';

export class EditorError extends Error {
  constructor(code, message = code) { super(message); this.name = 'EditorError'; this.code = code; }
}
const fail = (code, message) => { throw new EditorError(code, message); };
const sync = value => {
  if (value && (typeof value === 'object' || typeof value === 'function')) {
    // Do not evaluate an accessor on a returned document while detecting promises.
    for (let object = value; object; object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, 'then');
      if (!descriptor) continue;
      if (!('value' in descriptor)) fail('INVALID_JSON');
      if (typeof descriptor.value === 'function') {
        // Observe native rejected promises without invoking arbitrary thenables.
        try { Promise.prototype.then.call(value, undefined, () => {}); } catch { /* Not a native promise. */ }
        fail('ASYNC_UNSUPPORTED');
      }
      break;
    }
  }
  return value;
};

/** Copy data without invoking getters or retaining caller-owned objects. */
export function cloneJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || !value || ancestors.has(value)) fail('INVALID_JSON');
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('INVALID_JSON');
  ancestors.add(value);
  const output = array ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('INVALID_JSON');
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail('INVALID_JSON');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !('value' in descriptor)) fail('INVALID_JSON');
    output[key] = cloneJson(descriptor.value, ancestors);
  }
  if (array && Object.keys(output).length !== value.length) fail('INVALID_JSON');
  ancestors.delete(value);
  return output;
}
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const immutable = value => freeze(cloneJson(value));

export function createEditor({ document, plugins = [], validateDocument, authorize, onError, historyLimit = 100 } = {}) {
  if (!Number.isInteger(historyLimit) || historyLimit < 0) fail('INVALID_HISTORY_LIMIT');
  let disposed = false, busy = true, revision = 0;
  let current = immutable(document), past = [], future = [], snapshot;
  const listeners = new Map(), subscribers = new Set(), registry = new Map(), commands = new Map();
  const check = () => { if (disposed) fail('DISPOSED'); if (busy) fail('REENTRANT'); };
  const validate = doc => { if (validateDocument && sync(validateDocument(doc)) === false) fail('INVALID_DOCUMENT'); };
  validate(current);
  const refresh = () => { snapshot = Object.freeze({ document: current, revision, canUndo: past.length > 0, canRedo: future.length > 0 }); };
  refresh();
  const report = error => {
    try { if (onError) sync(onError(error)); } catch { /* Notifications cannot invalidate commits. */ }
    for (const listener of [...(listeners.get('error') || [])]) { try { sync(listener(error)); } catch { /* Avoid recursive error events. */ } }
  };
  const notify = (name, event) => {
    for (const listener of [...(listeners.get(name) || [])]) {
      try { sync(listener(event)); } catch (error) { report(error); }
    }
  };
  const run = (operation, entries, meta = {}, updater) => {
    check(); busy = true;
    try {
      meta = immutable(meta);
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) fail('INVALID_META');
      if (meta.expectedRevision !== undefined && meta.expectedRevision !== revision) fail('STALE_REVISION');
      if (meta.dryRun !== undefined && typeof meta.dryRun !== 'boolean') fail('INVALID_META');
      const requests = immutable(entries);
      let candidate = cloneJson(current);
      if (operation === 'undo') candidate = past.length ? past[past.length - 1] : current;
      else if (operation === 'redo') candidate = future.length ? future[future.length - 1] : current;
      else if (updater) candidate = sync(updater(candidate));
      else for (const request of requests) {
        const command = commands.get(request.type);
        if (!command) fail('UNKNOWN_COMMAND', `Unknown command: ${request.type}`);
        if (command.validate && sync(command.validate(request.payload)) === false) fail('INVALID_PAYLOAD');
        candidate = sync(command.apply(cloneJson(candidate), request.payload, Object.freeze({ meta })));
      }
      candidate = immutable(candidate);
      const event = Object.freeze({ operation, document: current, candidate, commands: requests, meta });
      if (authorize && sync(authorize(event)) !== true) fail('UNAUTHORIZED');
      validate(candidate);
      const changed = !equal(current, candidate);
      if (meta.dryRun) return Object.freeze({ document: candidate, revision, changed, dryRun: true });
      for (const listener of [...(listeners.get('beforeTransaction') || [])]) {
        if (sync(listener(event)) === false) fail('CANCELLED');
      }
      if (!changed) return Object.freeze({ document: current, revision, changed: false, dryRun: false });
      if (operation === 'undo') { future.push(current); past.pop(); }
      else if (operation === 'redo') { past.push(current); future.pop(); }
      else { past.push(current); future = []; }
      if (past.length > historyLimit) past.splice(0, past.length - historyLimit);
      current = candidate; revision++; refresh();
      const result = Object.freeze({ document: current, revision, changed: true, dryRun: false });
      notify('transaction', Object.freeze({ ...event, result }));
      notify('change', snapshot);
      for (const subscriber of [...subscribers]) { try { sync(subscriber()); } catch (error) { report(error); } }
      return result;
    } finally { busy = false; }
  };
  const editor = {
    getSnapshot: () => snapshot,
    subscribe(listener) { if (disposed) fail('DISPOSED'); subscribers.add(listener); return () => subscribers.delete(listener); },
    on(name, listener) { if (disposed) fail('DISPOSED'); if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); return () => listeners.get(name)?.delete(listener); },
    dispatch: (type, payload = null, meta) => run('dispatch', [{ type, payload }], meta),
    transact: (entries, meta) => {
      check();
      if (!Array.isArray(entries)) fail('INVALID_PAYLOAD');
      const copied = cloneJson(entries);
      if (copied.some(entry => !entry || typeof entry.type !== 'string')) fail('INVALID_PAYLOAD');
      return run('transact', copied.map(entry => ({ type: entry.type, payload: entry.payload === undefined ? null : entry.payload })), meta);
    },
    update: (updater, meta) => { check(); if (typeof updater !== 'function') fail('INVALID_UPDATER'); return run('update', [], meta, updater); },
    undo: meta => run('undo', [], meta),
    redo: meta => run('redo', [], meta),
    getCommands: () => Object.freeze([...commands.values()].map(({ id, description, inputSchema }) => Object.freeze({ id, description, inputSchema }))),
    registerPlugin(plugin) {
      check(); busy = true;
      try {
        if (!plugin || typeof plugin.id !== 'string' || !plugin.id || typeof plugin.version !== 'string' || !plugin.version) fail('INVALID_PLUGIN');
        if (registry.has(plugin.id)) fail('DUPLICATE_PLUGIN');
        const requires = [...(plugin.requires || [])];
        for (const id of requires) if (!registry.has(id)) fail('MISSING_DEPENDENCY');
        const definitions = new Map();
        for (const command of plugin.commands || []) {
          if (!command || typeof command.id !== 'string' || !command.id || typeof command.apply !== 'function' || (command.description !== undefined && typeof command.description !== 'string') || (command.validate !== undefined && typeof command.validate !== 'function')) fail('INVALID_PLUGIN');
          if (commands.has(command.id) || definitions.has(command.id)) fail('DUPLICATE_COMMAND');
          definitions.set(command.id, Object.freeze({ id: command.id, description: command.description, inputSchema: command.inputSchema === undefined ? undefined : immutable(command.inputSchema), apply: command.apply, validate: command.validate }));
        }
        // Setup may subscribe, so save subscriptions for activation rollback.
        const savedListeners = new Map([...listeners].map(([name, set]) => [name, new Set(set)]));
        const savedSubscribers = new Set(subscribers);
        for (const [id, definition] of definitions) commands.set(id, definition);
        let cleanup;
        try {
          cleanup = plugin.setup ? sync(plugin.setup(editor)) : undefined;
          if (cleanup !== undefined && typeof cleanup !== 'function') fail('INVALID_PLUGIN');
        } catch (error) {
          for (const id of definitions.keys()) commands.delete(id);
          listeners.clear(); for (const [name, set] of savedListeners) listeners.set(name, set);
          subscribers.clear(); for (const listener of savedSubscribers) subscribers.add(listener);
          throw error;
        }
        registry.set(plugin.id, { requires, ids: [...definitions.keys()], cleanup });
        notify('plugin', Object.freeze({ action: 'register', id: plugin.id }));
      } finally { busy = false; }
    },
    unregisterPlugin(id) {
      check(); busy = true;
      try {
        if (!registry.has(id)) fail('UNKNOWN_PLUGIN');
        for (const plugin of registry.values()) if (plugin.requires.includes(id)) fail('PLUGIN_REQUIRED');
        const plugin = registry.get(id);
        for (const commandId of plugin.ids) commands.delete(commandId);
        registry.delete(id);
        try { if (plugin.cleanup) sync(plugin.cleanup()); } catch (error) { report(error); }
        notify('plugin', Object.freeze({ action: 'unregister', id }));
      } finally { busy = false; }
    },
    dispose() {
      if (disposed) return;
      check(); busy = true; disposed = true;
      for (const plugin of [...registry.values()].reverse()) { try { if (plugin.cleanup) sync(plugin.cleanup()); } catch (error) { report(error); } }
      registry.clear(); commands.clear(); listeners.clear(); subscribers.clear(); past = []; future = [];
      busy = false;
    },
  };
  busy = false;
  try { for (const plugin of plugins) editor.registerPlugin(plugin); } catch (error) { editor.dispose(); throw error; }
  return Object.freeze(editor);
}
