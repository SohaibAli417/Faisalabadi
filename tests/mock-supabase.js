const http = require('http');
const fs = require('fs');
const path = require('path');

// Minimal mock of the Supabase/PostgREST endpoints used by database.js so the
// sync engine can be tested end-to-end without a real Supabase project.

const storeFile = process.env.MOCK_SUPABASE_STORE || path.join(require('os').tmpdir(), 'mock-supabase-db.json');
let rows = new Map();
if (fs.existsSync(storeFile)) {
  try {
    for (const [key, value] of Object.entries(JSON.parse(fs.readFileSync(storeFile, 'utf8')))) rows.set(key, value);
  } catch (_) {}
}

function persist() {
  try {
    fs.writeFileSync(storeFile, JSON.stringify(Object.fromEntries(rows)));
  } catch (_) {}
}

const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/rest/v1/pos_data') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      return response.end('{"message":"not found"}');
    }

    if (request.method === 'GET') {
      const idParam = url.searchParams.get('id') || '';
      const id = idParam.replace(/^eq\./, '');
      const wantsSingle = String(request.headers.accept || '').includes('vnd.pgrst.object');
      const row = rows.get(id);
      if (wantsSingle) {
        if (!row) {
          response.writeHead(406, { 'Content-Type': 'application/json' });
          return response.end(JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null }));
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        return response.end(JSON.stringify(row));
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify(row ? [row] : []));
    }

    if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT') {
      let payload;
      try { payload = JSON.parse(body || '[]'); } catch (_) { payload = []; }
      const list = Array.isArray(payload) ? payload : [payload];
      for (const row of list) {
        if (!row || !row.id) continue;
        const existing = rows.get(row.id);
        if (existing && request.headers.prefer && String(request.headers.prefer).includes('resolution=merge-duplicates')) {
          rows.set(row.id, { ...existing, ...row });
        } else {
          rows.set(row.id, row);
        }
      }
      persist();
      response.writeHead(201, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify(list));
    }

    response.writeHead(405, { 'Content-Type': 'application/json' });
    response.end('{"message":"method not allowed"}');
  });
});

const port = Number(process.env.MOCK_SUPABASE_PORT || 4000);
server.listen(port, () => console.log(`Mock Supabase listening on http://localhost:${port}`));
