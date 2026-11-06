/**
 * @fileoverview Model Context Protocol client implementation
 *
 * @module mcp
 */
'use strict';

// ─── MCP (Model Context Protocol) client — zero dependency ─────────────
// Setiap server = proses terpisah (stdio: command/args) atau endpoint HTTP.
// Semua komunikasi JSON-RPC. Desain LEAN: skema tool MCP TIDAK di-inject ke
// prompt AI; agent cukup punya 2 tool tipis: mcp_list (enumerasi on-demand)
// dan mcp_call (satu tool generik). Baseline token tetap ramping.

const { spawn } = require('child_process');

const PROTOCOL_VERSION = '2024-11-05';
const CALL_TIMEOUT = 90000;

function parseArgs(obj) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj) && !Buffer.isBuffer(obj)) {
    return JSON.parse(JSON.stringify(obj));
  }
  if (typeof obj === 'string') {
    try {
      const parsed = JSON.parse(obj);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function extractText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .map((c) => {
        if (c.type === 'text') return c.text || '';
        if (c.type === 'image') return '[image]';
        if (c.type === 'resource') {
          const r = c.resource;
          if (r && r.text != null) return String(r.text);
          if (r && r.blob) return `[resource ${r.uri || ''}]`;
        }
        try {
          return JSON.stringify(c);
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .join('\n');
  }
  if (result.structuredContent) {
    try {
      return JSON.stringify(result.structuredContent, null, 2);
    } catch {}
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

class MCPManager {
  constructor(servers = {}, opts = {}) {
    this.servers = servers || {};
    this.opts = opts || {};
    this.clients = new Map();
  }

  cfgFor(name) {
    return this.servers && this.servers[name];
  }

  has(name) {
    const c = this.cfgFor(name);
    return !!(c && c.enabled !== false);
  }

  names() {
    return Object.keys(this.servers || {}).filter((n) => this.servers[n].enabled !== false);
  }

  isTrusted(name) {
    const c = this.cfgFor(name);
    return !!(c && c.trusted);
  }

  describe(only) {
    const names = (only ? [only] : this.names()).filter((n) => this.has(n));
    for (const nm of names) this._client(nm); // paksa koneksi supaya status termutakhir
    const out = [];
    for (const name of names) {
      const c = this.cfgFor(name);
      const client = this.clients.get(name);
      if (!client || !client.ready) {
        out.push(`${name}${c && c.trusted ? ' (trusted)' : ''}: ${client && client.error ? 'error: ' + client.error : 'connecting…'}`);
        continue;
      }
      const tools = (client.tools || []).map((t) => t.name || '').filter(Boolean);
      out.push(`${name}${c && c.trusted ? ' (trusted)' : ''}: ${tools.length ? tools.join(', ') : '(no tools)'}`);
    }
    return out.join('\n') || '(no active MCP servers — add via /mcp add)';
  }

  // Tunggu sampai (semua | satu nama) klien siap atau error, maksimal timeoutMs.
  async ready(name, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    const targets = (name ? [name] : this.names()).map((n) => this._client(n)).filter(Boolean);
    if (!targets.length) return false;
    while (Date.now() < deadline) {
      if (targets.every((c) => !c || c.ready || c.error)) {
        return targets.some((c) => c && c.ready);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    return targets.some((c) => c && c.ready);
  }

  _client(name) {
    if (this.clients.has(name)) return this.clients.get(name);
    const cfg = this.cfgFor(name);
    if (!cfg || cfg.enabled === false) return null;
    const client = {
      name,
      cfg,
      tools: [],
      ready: false,
      error: null,
      proc: null,
      inflight: new Map(),
      seq: 0,
      _http: null,
    };
    this.clients.set(name, client);
    try {
      if (cfg.url) this._connectHttp(client);
      else this._connectStdio(client);
    } catch (e) {
      client.error = e.message;
    }
    return client;
  }

  _write(client, msg) {
    if (client.cfg.url) {
      throw new Error('http transport handled in _http()');
    }
    if (client.proc && client.proc.stdin) {
      client.proc.stdin.write(JSON.stringify(msg) + '\n');
      return;
    }
    throw new Error('mcp transport not ready');
  }

  _send(client, method, params) {
    const id = ++client.seq;
    const msg = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      client.inflight.set(id, {
        resolve,
        reject,
        timer: setTimeout(() => this._rejectInflight(client, id, new Error(`mcp timeout after ${CALL_TIMEOUT}ms (${method})`)), CALL_TIMEOUT),
      });
      try {
        this._write(client, msg);
      } catch (e) {
        this._rejectInflight(client, id, e);
      }
    });
  }

  _notify(client, method, params) {
    const msg = { jsonrpc: '2.0', method, params };
    try {
      this._write(client, msg);
    } catch {}
  }

  _rejectInflight(client, id, err) {
    const p = client.inflight.get(id);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    client.inflight.delete(id);
    p.reject(err);
  }

  _resolveInflight(client, id, value) {
    const p = client.inflight.get(id);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    client.inflight.delete(id);
    p.resolve(value);
  }

  _failInflight(client, err) {
    for (const [id] of client.inflight) {
      const p = client.inflight.get(id);
      if (p && p.timer) clearTimeout(p.timer);
      client.inflight.delete(id);
      try {
        p.reject(err);
      } catch {}
    }
  }

  _onMessage(client, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.id != null && msg.method == null) {
      // response / error untuk request kita
      if (msg.error) this._rejectInflight(client, msg.id, new Error(msg.error.message || 'mcp error'));
      else this._resolveInflight(client, msg.id, msg.result !== undefined ? msg.result : msg);
      return;
    }
    if (msg.method && msg.method.startsWith('notifications/')) return;
    if (msg.id != null) {
      this._write(client, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not supported by niyusha' } });
    }
  }

  _connectStdio(client) {
    const cfg = client.cfg;
    if (!cfg.command) throw new Error('mcp stdio butuh "command"');
    const child = spawn(cfg.command, cfg.args || [], {
      cwd: cfg.cwd || undefined,
      env: { ...process.env, ...(cfg.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    client.proc = child;
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          this._onMessage(client, JSON.parse(line));
        } catch {}
      }
    });
    if (child.stdin) child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    child.on('error', (e) => {
      if (!client.ready) client.error = e.message;
      this._failInflight(client, new Error(`mcp server error: ${e.message}`));
    });
    child.on('close', () => {
      if (!client.ready) client.error = 'server exited';
      this._failInflight(client, new Error('mcp server exited'));
    });
    this._handshake(client);
  }

  async _handshake(client) {
    try {
      const init = await this._send(client, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'niyusha', version: this.opts.version || '0.1.0' },
      });
      // protocol version bisa dinegosiasikan; lanjut apa adanya.
      this._notify(client, 'notifications/initialized', {});
      const listed = await this._send(client, 'tools/list', {});
      client.tools = Array.isArray(listed) ? listed : Array.isArray(listed && listed.tools) ? listed.tools : [];
      client.ready = true;
      client.error = null;
    } catch (e) {
      client.error = e.message;
    }
  }

  _connectHttp(client) {
    const url = client.cfg.url;
    if (!/^https?:\/\//i.test(String(url))) throw new Error('mcp url tidak valid');
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(client.cfg.headers || {}),
    };
    client._http = async (method, params, isNotif) => {
      const body = isNotif
        ? { jsonrpc: '2.0', method, params }
        : { jsonrpc: '2.0', id: ++client.seq, method, params };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT);
      try {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
        const text = await res.text();
        if (!res.ok) throw new Error(`mcp http ${res.status}: ${text.slice(0, 120)}`);
        if (!text) return undefined;
        const data = text.trim().startsWith('data:') ? this._parseSse(text) : JSON.parse(text);
        if (data && data.error) throw new Error(data.error.message || 'mcp error');
        return data && data.result !== undefined ? data.result : data;
      } catch (e) {
        if (e.name === 'AbortError') throw new Error(`mcp http timeout (${CALL_TIMEOUT}ms)`);
        throw new Error(`mcp http: ${e.message}`);
      } finally {
        clearTimeout(timer);
      }
    };
    this._handshakeHttp(client);
  }

  _parseSse(text) {
    let last;
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) last = line.slice(5).trim();
    }
    if (!last) throw new Error('mcp SSE tanpa data');
    return JSON.parse(last);
  }

  async _handshakeHttp(client) {
    try {
      await client._http('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'niyusha', version: this.opts.version || '0.1.0' },
      });
      await client._http('notifications/initialized', {}, true);
      const listed = await client._http('tools/list', {});
      client.tools = Array.isArray(listed) ? listed : Array.isArray(listed && listed.tools) ? listed.tools : [];
      client.ready = true;
      client.error = null;
    } catch (e) {
      client.error = e.message;
    }
  }

  async call(server, tool, argsIn) {
    let client = this._client(server);
    if (!client || !this.has(server)) throw new Error(`server MCP '${server}' tidak dikenal/nonaktif`);
    if (!client.ready) {
      await this.ready(server, 8000);
      client = this.clients.get(server);
      // kalau proses sudah mati, coba sambung ulang sekali.
      if (client && !client.ready && client.error && (!client.proc || client.proc.exitCode != null)) {
        this.clients.delete(server);
        client = this._client(server);
        await this.ready(server, 8000);
      }
    }
    if (!client || !client.ready) {
      throw new Error(`server '${server}' belum siap: ${client && client.error ? client.error : 'timeout connecting'}`);
    }
    const args = parseArgs(argsIn);
    let res;
    try {
      if (client._http) {
        res = await client._http('tools/call', { name: tool, arguments: args });
      } else {
        res = await this._send(client, 'tools/call', { name: tool, arguments: args });
      }
    } catch (e) {
      throw new Error(`mcp ${server}.${tool}: ${e.message}`);
    }
    const hasErr = res && typeof res === 'object' && res.isError;
    const txt = extractText(res).trim();
    if (hasErr) throw new Error(`mcp ${server}.${tool}: ${txt || 'tool error'}`);
    return txt || `(tool ${tool} tanpa output)`;
  }

  restart(name) {
    this.clients.delete(name);
  }

  stop() {
    for (const [name, client] of this.clients) {
      this._failInflight(client, new Error('mcp stopped'));
      try {
        if (client.proc && client.proc.exitCode == null) {
          client.proc.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGTERM');
          setTimeout(() => {
            try {
              if (client.proc.exitCode == null) client.proc.kill('SIGKILL');
            } catch {}
          }, 500).unref?.();
        }
      } catch {}
      this.clients.delete(name);
    }
  }
}

module.exports = { MCPManager, extractText, parseArgs, PROTOCOL_VERSION };
