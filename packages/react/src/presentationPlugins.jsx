import { Component, createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

const PluginRegistryContext = createContext(null);

function normalizePlugin(plugin) {
  if (!plugin || typeof plugin !== 'object' || typeof plugin.id !== 'string' || !plugin.id) {
    throw new Error('Presentation UI plugin must be an object with a non-empty string id.');
  }
  return plugin;
}

export function createPresentationPluginRegistry(initialPlugins = []) {
  let entries = [];
  let snapshot = Object.freeze([]);
  const listeners = new Set();

  const notify = () => {
    snapshot = Object.freeze(entries.map((e) => e.plugin));
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* listener errors must not break registry */ }
    }
  };

  function getPlugins() {
    return snapshot;
  }

  function registerPlugin(plugin) {
    const valid = normalizePlugin(plugin);
    const token = {};
    const idx = entries.findIndex((e) => e.plugin.id === valid.id);
    if (idx >= 0) {
      entries = entries.map((e, i) => (i === idx ? { token, plugin: valid } : e));
    } else {
      entries = [...entries, { token, plugin: valid }];
    }
    notify();
    return () => {
      const next = entries.filter((e) => e.token !== token);
      if (next.length !== entries.length) {
        entries = next;
        notify();
      }
    };
  }

  for (const p of initialPlugins) registerPlugin(p);

  function subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return { getPlugins, registerPlugin, subscribe };
}

const EMPTY_PLUGINS = Object.freeze([]);

export function PresentationPluginProvider({ plugins = EMPTY_PLUGINS, children }) {
  const parent = useContext(PluginRegistryContext);
  const registryRef = useRef(null);
  if (!registryRef.current) {
    registryRef.current = createPresentationPluginRegistry();
  }

  useEffect(() => {
    const cleanups = [];
    for (const plugin of plugins) {
      if (plugin) cleanups.push(registryRef.current.registerPlugin(plugin));
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [plugins]);

  const value = useMemo(() => {
    if (!parent) return registryRef.current;
    let cachedParent = parent.getPlugins();
    let cachedSelf = registryRef.current.getPlugins();
    let cachedMerged = mergePlugins(cachedParent, cachedSelf);
    return {
      getPlugins: () => {
        const nextParent = parent.getPlugins();
        const nextSelf = registryRef.current.getPlugins();
        if (nextParent !== cachedParent || nextSelf !== cachedSelf) {
          cachedParent = nextParent;
          cachedSelf = nextSelf;
          cachedMerged = mergePlugins(nextParent, nextSelf);
        }
        return cachedMerged;
      },
      registerPlugin: (plugin) => registryRef.current.registerPlugin(plugin),
      subscribe: (listener) => {
        const u1 = parent.subscribe(listener);
        const u2 = registryRef.current.subscribe(listener);
        return () => { u1(); u2(); };
      },
    };
  }, [parent]);

  return <PluginRegistryContext.Provider value={value}>{children}</PluginRegistryContext.Provider>;
}

export function usePresentationPlugins() {
  const registry = useContext(PluginRegistryContext);
  const plugins = useSyncExternalStore(
    registry ? registry.subscribe : () => () => {},
    registry ? registry.getPlugins : () => EMPTY_PLUGINS,
    () => EMPTY_PLUGINS,
  );
  return {
    plugins,
    registerPlugin: registry ? registry.registerPlugin : () => () => {},
  };
}

export function mergePlugins(...lists) {
  const byId = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const plugin of list) {
      if (plugin && typeof plugin.id === 'string' && plugin.id) {
        byId.set(plugin.id, plugin);
      }
    }
  }
  return [...byId.values()];
}

export class PluginErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, prevKey: props.resetKey, prevIdentity: props.resetIdentity };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.prevKey || props.resetIdentity !== state.prevIdentity) {
      return { failed: false, prevKey: props.resetKey, prevIdentity: props.resetIdentity };
    }
    return null;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    try {
      this.props.onError?.(error);
    } catch { /* isolate error reporting */ }
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}

export function PluginRenderSlot({ render, arg }) {
  return render(arg);
}

export function usePluginErrorReporter(reportError) {
  const pendingRef = useRef([]);
  const report = (err) => {
    pendingRef.current.push(err);
  };
  useEffect(() => {
    if (!pendingRef.current.length) return;
    const errs = pendingRef.current.splice(0);
    const seen = new Set();
    for (const err of errs) {
      const key = err instanceof Error ? `${err.name}:${err.message}` : String(err);
      if (seen.has(key)) continue;
      seen.add(key);
      try { reportError?.(err); } catch { /* isolate error reporting */ }
    }
  });
  return report;
}

export function safePluginCall(fn, fallback, reportError, ...args) {
  if (typeof fn !== 'function') return fallback;
  try {
    return fn(...args);
  } catch (err) {
    try { reportError?.(err); } catch { /* isolate error reporting */ }
    return fallback;
  }
}

export function collectToolbarActions(plugins, tab, ctx, reportError) {
  const items = [];
  for (const plugin of plugins) {
    if (!Array.isArray(plugin.toolbarActions)) continue;
    for (const action of plugin.toolbarActions) {
      if (!action || (action.tab ?? 'Home') !== tab) continue;
      const visible = action.visible ? Boolean(safePluginCall(action.visible, false, reportError, ctx)) : true;
      if (!visible) continue;
      items.push({ pluginId: plugin.id, action });
    }
  }
  return items.sort((a, b) => (a.action.order ?? 0) - (b.action.order ?? 0));
}

export function collectInspectorSections(plugins, ctx, reportError) {
  const items = [];
  for (const plugin of plugins) {
    if (!Array.isArray(plugin.inspectorSections)) continue;
    for (const section of plugin.inspectorSections) {
      if (!section || typeof section.render !== 'function') continue;
      const show = section.when ? Boolean(safePluginCall(section.when, false, reportError, ctx)) : true;
      if (!show) continue;
      items.push({ pluginId: plugin.id, section });
    }
  }
  return items.sort((a, b) => (a.section.order ?? 0) - (b.section.order ?? 0));
}

export function resolveObjectRenderer(plugins, object, ctx, reportError) {
  let best = null;
  for (const plugin of plugins) {
    if (!Array.isArray(plugin.objectRenderers)) continue;
    for (const renderer of plugin.objectRenderers) {
      if (!renderer || typeof renderer.match !== 'function' || typeof renderer.render !== 'function') continue;
      const matched = Boolean(safePluginCall(renderer.match, false, reportError, object, ctx));
      if (!matched) continue;
      const priority = renderer.priority ?? 0;
      if (!best || priority > best.priority) {
        best = { pluginId: plugin.id, renderer, priority };
      }
    }
  }
  return best;
}
