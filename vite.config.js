import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDeckStore, handleApiRequest } from './src/server/api.js';

// Single in-memory deck store shared across the dev session.
const store = createDeckStore();

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

        const result = await handleApiRequest(store, { method: req.method, url: req.url, body });
        if (!result) return next();

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
