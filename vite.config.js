import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In-memory deck state for MCP server
let deckState = null;

function mcpMiddlewarePlugin() {
  return {
    name: 'mcp-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();

        // Parse body
        let body = '';
        await new Promise(resolve => {
          req.on('data', chunk => { body += chunk; });
          req.on('end', resolve);
        });
        let parsedBody = null;
        if (body) {
          try { parsedBody = JSON.parse(body); } catch {}
        }

        const send = (data, status = 200) => {
          res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(data));
        };

        const url = req.url.split('?')[0];
        const method = req.method;

        // Health
        if (url === '/api/health' && method === 'GET') {
          return send({ ok: true, version: '1.0.0' });
        }

        // Deck CRUD
        if (url === '/api/deck') {
          if (method === 'GET') return send(deckState || {});
          if (method === 'PUT') { deckState = parsedBody; return send({ ok: true }); }
        }

        // Slides
        if (url === '/api/slides') {
          if (method === 'GET') return send(deckState?.slides || []);
          if (method === 'POST') {
            if (!deckState) return send({ error: 'No deck loaded' }, 400);
            const newSlide = {
              id: `slide-${Date.now()}`,
              layout: 'text',
              title: 'New slide',
              ...parsedBody,
            };
            deckState.slides.push(newSlide);
            if (deckState.sections && deckState.sections.length > 0) {
              deckState.sections[deckState.sections.length - 1].slides.push(newSlide.id);
            }
            return send(newSlide);
          }
        }

        // Slide by ID
        const slideMatch = url.match(/^\/api\/slides\/(.+)$/);
        if (slideMatch) {
          const id = slideMatch[1];
          if (method === 'PUT') {
            if (!deckState) return send({ error: 'No deck loaded' }, 400);
            const idx = deckState.slides.findIndex(s => s.id === id);
            if (idx < 0) return send({ error: 'Not found' }, 404);
            deckState.slides[idx] = { ...deckState.slides[idx], ...parsedBody };
            return send(deckState.slides[idx]);
          }
          if (method === 'DELETE') {
            if (!deckState) return send({ error: 'No deck loaded' }, 400);
            deckState.slides = deckState.slides.filter(s => s.id !== id);
            if (deckState.sections) {
              deckState.sections = deckState.sections.map(sec => ({
                ...sec, slides: sec.slides.filter(sid => sid !== id)
              }));
            }
            return send({ ok: true });
          }
        }

        // Export trigger
        if (url === '/api/export/pptx' && method === 'POST') {
          return send({ ok: true, message: 'Export triggered — use client-side exportToPPTX()' });
        }

        // LLM proxy
        if (url === '/api/llm' && method === 'POST') {
          const { messages, provider, model, apiKey, baseUrl, apiFormat, temperature, maxTokens } = parsedBody || {};

          try {
            let responseText = '';

            if (provider === 'anthropic' || (!provider && !apiFormat)) {
              // Anthropic API
              const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': apiKey || '',
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: model || 'claude-sonnet-4',
                  max_tokens: maxTokens || 2048,
                  temperature: temperature || 0.7,
                  messages: messages || [],
                }),
              });
              const data = await anthropicResponse.json();
              responseText = data.content?.[0]?.text || data.error?.message || 'No response';
            } else {
              // OpenAI-compatible
              const apiBase = baseUrl || 'https://api.openai.com/v1';
              const openaiResponse = await fetch(`${apiBase}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey || ''}`,
                },
                body: JSON.stringify({
                  model: model || 'gpt-4o',
                  max_tokens: maxTokens || 2048,
                  temperature: temperature || 0.7,
                  messages: messages || [],
                }),
              });
              const data = await openaiResponse.json();
              responseText = data.choices?.[0]?.message?.content || data.error?.message || 'No response';
            }

            return send({ text: responseText });
          } catch (err) {
            return send({ error: err.message }, 500);
          }
        }

        // MCP capabilities manifest
        if (url === '/api/mcp' && method === 'GET') {
          return send({
            version: '1.0',
            name: 'Stagecraft',
            description: 'Presentation editor MCP server',
            tools: [
              { name: 'get_deck', description: 'Get the current presentation deck', inputSchema: {} },
              { name: 'add_slide', description: 'Add a new slide', inputSchema: { type: 'object', properties: { layout: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } } },
              { name: 'update_slide', description: 'Update a slide', inputSchema: { type: 'object', properties: { id: { type: 'string' }, updates: { type: 'object' } } } },
              { name: 'delete_slide', description: 'Delete a slide', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
              { name: 'reorder_slides', description: 'Reorder slides', inputSchema: { type: 'object', properties: { order: { type: 'array', items: { type: 'string' } } } } },
              { name: 'set_theme', description: 'Change deck theme', inputSchema: { type: 'object', properties: { theme: { type: 'string', enum: ['indigo', 'emerald', 'amber', 'coral', 'magenta', 'slate'] } } } },
            ],
          });
        }

        // MCP tool execution
        if (url === '/api/mcp/tools/call' && method === 'POST') {
          const { name, arguments: args } = parsedBody || {};
          switch (name) {
            case 'get_deck':
              return send({ result: deckState });
            case 'add_slide': {
              if (!deckState) return send({ error: 'No deck loaded' }, 400);
              const s = { id: `slide-${Date.now()}`, layout: 'text', title: 'New slide', ...args };
              deckState.slides.push(s);
              if (deckState.sections?.length) deckState.sections[deckState.sections.length - 1].slides.push(s.id);
              return send({ result: s });
            }
            case 'update_slide': {
              if (!deckState) return send({ error: 'No deck loaded' }, 400);
              const idx = deckState.slides.findIndex(s => s.id === args.id);
              if (idx < 0) return send({ error: 'Not found' }, 404);
              deckState.slides[idx] = { ...deckState.slides[idx], ...args.updates };
              return send({ result: deckState.slides[idx] });
            }
            case 'delete_slide': {
              if (!deckState) return send({ error: 'No deck loaded' }, 400);
              deckState.slides = deckState.slides.filter(s => s.id !== args.id);
              if (deckState.sections) deckState.sections = deckState.sections.map(sec => ({ ...sec, slides: sec.slides.filter(sid => sid !== args.id) }));
              return send({ result: { ok: true } });
            }
            case 'reorder_slides': {
              if (!deckState) return send({ error: 'No deck loaded' }, 400);
              const order = args.order || [];
              deckState.slides = order.map(id => deckState.slides.find(s => s.id === id)).filter(Boolean);
              return send({ result: { ok: true } });
            }
            case 'set_theme': {
              if (!deckState) return send({ error: 'No deck loaded' }, 400);
              deckState.theme = args.theme;
              return send({ result: { ok: true } });
            }
            default:
              return send({ error: `Unknown tool: ${name}` }, 400);
          }
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mcpMiddlewarePlugin()],
});
