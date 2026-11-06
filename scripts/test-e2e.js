#!/usr/bin/env node
'use strict';

// E2E headless (model-driven): Agent.run() sungguhan, callModel di-stub.
// Verifikasi: index skill tampil di prompt; model memanggil use_skill; rules termuat.
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const { Agent } = require(path.join(root, 'bin/ai'));
const { VirtualFS } = require(path.join(root, 'bin/vfs'));

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

function makeAgent(skillsCfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-e2e-'));
  const vfs = new VirtualFS('e2e', dir);
  const config = { apiKey: 'x', model: 'm', providerInfo: { requiredKey: true }, skills: skillsCfg || { auto: true }, websearch: {} };
  const agent = new Agent({ vfs, cwd: '/', config });
  const calls = [];
  agent.callModel = async (messages) => {
    calls.push(messages);
    const hasTool = messages.some((m) => m.role === 'tool');
    if (!hasTool) {
      return { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'use_skill', arguments: JSON.stringify({ name: 'web' }) } }] };
    }
    return { role: 'assistant', content: 'selesai' };
  };
  return { agent, calls, dir };
}

(async () => {
  // Model-driven: index tampil, model memuat skill sendiri.
  const { agent, calls, dir } = makeAgent({ auto: true });
  const reply = await agent.run('tolong bikin website landing page untuk kafe', { autoContinue: 0, maxSteps: 4 });
  const sys0 = calls[0].find((m) => m.role === 'system').content;
  ok('e2e: index skill tampil di prompt', sys0.includes('--- SKILL (WAJIB') && sys0.includes('web —'));
  ok('e2e: tidak ada auto-inject Skill AKTIF', !sys0.includes('Skill AKTIF'));
  ok('e2e: model panggil use_skill → rules termuat', agent.history.some((m) => m.role === 'tool' && /web-development/.test(m.content || '')));
  ok('e2e: skillLog mencatat pemuatan web', agent.skillLog.some((e) => e.ids.includes('web')));
  ok('e2e: reply akhir diterima', /selesai/.test(reply));

  // auto OFF → index tak tampil
  const off = makeAgent({ auto: false });
  await off.agent.run('bikin website', { autoContinue: 0, maxSteps: 2 });
  const sysOff = off.calls[0].find((m) => m.role === 'system').content;
  ok('e2e: auto off → tanpa index', !sysOff.includes('--- SKILL'));

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(off.dir, { recursive: true, force: true });

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
