#!/usr/bin/env node
'use strict';

// ── Self-test sub-agent (tanpa API key) ─────────────────────────────────
// Menguji: role `explore` (read-only) vs `build` (staged write), penegakan
// toolSubset, dan event progress live. Jalankan: `npm run test:subagent`.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Agent } = require('../bin/ai.js');
const { VirtualFS } = require('../bin/vfs.js');

// Model tiruan: sub-agent mencoba write_file /out.txt; agen utama mendelegasi.
Agent.prototype.callModel = async function (messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = typeof (lastUser && lastUser.content) === 'string' ? lastUser.content : '';
  const isSub = /Role: (explore|build)/.test(text);
  const hasToolResult = messages.some((m) => m.role === 'tool');
  if (isSub) {
    if (!hasToolResult) {
      return { content: '', tool_calls: [{ id: 's1', function: { name: 'write_file', arguments: JSON.stringify({ path: '/out.txt', content: 'hi' }) } }] };
    }
    return { content: 'done', tool_calls: null };
  }
  if (!hasToolResult) {
    return {
      content: '',
      tool_calls: [{ id: 'm1', function: { name: 'task', arguments: JSON.stringify({ description: 'mk', subagent_type: process.env.ROLE || 'build', prompt: 'create /out.txt' }) } }],
    };
  }
  return { content: 'all done', tool_calls: null };
};

async function scenario(role) {
  const root = path.join(os.tmpdir(), 'niyusha-selftest-' + role);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const vfs = new VirtualFS('t', root, {});
  const agent = new Agent({ vfs, cwd: '/', config: { apiKey: 'x', model: 'm', baseUrl: 'http://x', provider: 'openai' } });
  const events = [];
  await agent.run('do it', { onTool: (n) => events.push(n) });
  const pending = vfs.pendingChanges();
  const realWritten = fs.existsSync(path.join(root, 'out.txt'));
  return { events, staged: pending.map((p) => `${p.path}(${p.op})`), realWritten };
}

(async () => {
  let ok = true;
  const check = (label, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
    if (!cond) ok = false;
  };

  process.env.ROLE = 'build';
  const b = await scenario('build');
  console.log('\n[build] events:', b.events.join(','), '| staged:', b.staged.join(',') || '(none)');
  check('build: memicu sub-agent', b.events.includes('subagent'));
  check('build: progress live (subtool)', b.events.includes('subtool'));
  check('build: file ter-stage (create)', b.staged.some((s) => s === '/out.txt(create)'));
  check('build: file nyata BELUM ditulis (hanya staging)', b.realWritten === false);

  process.env.ROLE = 'explore';
  const e = await scenario('explore');
  console.log('\n[explore] events:', e.events.join(','), '| staged:', e.staged.join(',') || '(none)');
  check('explore: memicu sub-agent', e.events.includes('subagent'));
  check('explore: TIDAK ada yang ter-stage (write diblokir)', e.staged.length === 0);
  check('explore: file nyata tidak ditulis', e.realWritten === false);

  console.log('\n' + (ok ? 'ALL PASS ✅' : 'ADA YANG FAIL ❌'));
  process.exit(ok ? 0 : 1);
})();
