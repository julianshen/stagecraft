import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { createDeckStore, handleApiRequest } from './src/server/api.js';

// The deck library is persisted to a JSON snapshot so edits (UI and MCP/agent)
// survive a reload and a dev-server restart. Load on boot; write (debounced)
// whenever the store's revision advances. The store logic itself stays pure in
// src/server/api.js — this file only does the file I/O.
const DECKS_FILE = './.stagecraft-decks.json';

function loadStore() {
  try {
    const snap = JSON.parse(readFileSync(DECKS_FILE, 'utf8'));
    if (snap && snap.decks) return createDeckStore(snap);
  } catch { /* no snapshot yet — start empty */ }
  return createDeckStore();
}
const store = loadStore();

let saveTimer = null;
let dirty = false;
function writeSnapshot() {
  dirty = false;
  try {
    writeFileSync(DECKS_FILE, JSON.stringify({ decks: store.decks, activeId: store.activeId }));
  } catch (e) {
    console.error('[stagecraft] failed to persist deck library:', e);
  }
}
function persist() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSnapshot, 300);
}
// Flush any debounced write on shutdown so the last edits aren't lost on Ctrl+C.
process.on('exit', () => { if (dirty) { clearTimeout(saveTimer); writeSnapshot(); } });

function mcpMiddlewarePlugin() {
  return {
    name: 'mcp-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();

        // Buffer + parse the JSON body (if any).
        let raw = '';
        await new Promise((resolve) => {
          req.on('data', (chunk) => { raw += chunk; });
          req.on('end', resolve);
        });
        let body = null;
        if (raw) { try { body = JSON.parse(raw); } catch { /* leave null */ } }

        const beforeRev = store.rev;
        const result = await handleApiRequest(store, { method: req.method, url: req.url, body });
        if (!result) return next();
        if (store.rev !== beforeRev) persist(); // a mutation happened — snapshot it

        res.writeHead(result.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(result.body));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mcpMiddlewarePlugin()],
});
