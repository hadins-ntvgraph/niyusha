'use strict';

// ── Tes MCP (stdio + HTTP) tanpa API key ───────────────────────────────
// Menjalankan server MCP tiruan: stdio (echo) dan HTTP (ping), lalu menguji
// MCPManager.ready/describe/call dan tool agent mcp_list/mcp_call.

const http = require('http');
const path = require('path');
const { MCPManager } = require(path.join(__dirname, '..', 'bin/mcp'));
const { Agent } = require(path.join(__dirname, '..', 'bin/ai'));
const { VirtualFS } = require(path.join(__dirname, '..', 'bin/vfs'));

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`PASS ${label}`);
  } else {
    fail++;
    console.log(`FAIL ${label} ${extra}`);
  }
};

function stdioServer() {
  process.stdin.setEncoding('utf8');
  let buf = '';
  const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } } });
      else if (m.method === 'notifications/initialized') { /* noop */ }
      else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { msg: { type: 'string' } } } }] } });
      else if (m.method === 'tools/call') {
        const t = m.params && m.params.name;
        const a = (m.params && m.params.arguments) || {};
        if (t === 'echo') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo: ' + (a.msg || '') }] } });
        else send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'unknown' }], isError: true } });
      } else if (m.id != null) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } });
    }
  });
}

const httpServer = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    let m = {};
    try {
      m = JSON.parse(b);
    } catch {}
    res.setHeader('content-type', 'application/json');
    if (m.method === 'initialize') return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'httpecho', version: '1' } } }));
    if (m.method === 'notifications/initialized') return res.end('');
    if (m.method === 'tools/list') return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object' } }] } }));
    if (m.method === 'tools/call') {
      const t = m.params && m.params.name;
      if (t === 'ping') return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'pong' }] } }));
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'unknown' }], isError: true } }));
    }
    res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } }));
  });
});

httpServer.listen(0, async () => {
  const port = httpServer.address().port;
  const mgr = new MCPManager({
    echo: { command: process.execPath, args: ['-e', `(${stdioServer.toString()})()`], trusted: true },
    httpecho: { url: `http://127.0.0.1:${port}`, trusted: true },
  });

  const ready = await mgr.ready(undefined, 6000);
  ok('stdio+http ready', ready);
  ok('names berisi echo & httpecho', mgr.names().includes('echo') && mgr.names().includes('httpecho'), JSON.stringify(mgr.names()));
  ok('describe memuat tool echo', /echo/.test(mgr.describe()), mgr.describe());
  ok('describe memuat tool ping (HTTP)', /ping/.test(mgr.describe()), mgr.describe());

  const e = await mgr.call('echo', 'echo', { msg: 'hi' });
  ok('stdio call echo', e === 'echo: hi', e);
  const e2 = await mgr.call('echo', 'echo', '{"msg":"json"}');
  ok('stdio call (args JSON string)', e2 === 'echo: json', e2);

  const p = await mgr.call('httpecho', 'ping', {});
  ok('http call ping -> pong (unwrap result)', p === 'pong', JSON.stringify(p));

  let threw = false;
  try {
    await mgr.call('echo', 'nope', {});
  } catch {
    threw = true;
  }
  ok('tool tidak dikenal -> error', threw);

  threw = false;
  try {
    await mgr.call('ghost', 'x', {});
  } catch {
    threw = true;
  }
  ok('server tidak dikenal -> error', threw);

  const vfs = new VirtualFS('mcp', '/tmp', {});
  const agent = new Agent({ vfs, cwd: '/tmp', config: { apiKey: 'x', model: 'm' }, mcp: mgr, permission: async () => true });
  const list = await agent.executeTool('mcp_list', {});
  ok('agent mcp_list menyebut ping', /ping/.test(list), list);
  const call = await agent.executeTool('mcp_call', { server: 'httpecho', tool: 'ping', arguments: {} });
  ok('agent mcp_call ping -> pong', call === 'pong', call);

  mgr.stop();
  httpServer.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail) process.exitCode = 1;
  setTimeout(() => process.exit(fail ? 1 : 0), 200).unref?.();
});
