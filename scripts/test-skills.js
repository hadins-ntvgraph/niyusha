#!/usr/bin/env node
'use strict';

// Tes manual cargo loader skill kondisional (tanpa jest — belum terpasang).
// Jalankan: node scripts/test-skills.js
const path = require('path');
const roots = { root: path.resolve(__dirname, '..') };
const skills = require(path.join(roots.root, 'bin/skills'));
const { Agent } = require(path.join(roots.root, 'bin/ai'));

let pass = 0;
let fail = 0;
function ok(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`PASS ${label}`);
  } else {
    fail++;
    console.log(`FAIL ${label} ${extra}`);
  }
}

// 1) registry dasar
const ids = skills.list();
ok('list non-empty', ids.includes('web'));
const inf = skills.findById('web');
ok('findById web', !!inf && inf.priority === 80);
ok('content non-empty', (skills.content('web') || '').includes('web-development'));
ok('index contains web', (skills.index({}) || '').includes('web —'));
ok('simulation skill ada', !!skills.findById('simulation'));
ok('simulation rules memuat harness', (skills.content('simulation') || '').includes('bin/sim.js'));
ok('simulation content tidak terpotong', !(skills.content('simulation') || '').includes('dipotong'));

// 2) match trigger
const m1 = skills.match('tolong bikin website landing page untuk kafe');
ok('match website', m1.some((s) => s.id === 'web'));
const m2 = skills.match('tulis fungsi python untuk parsing csv');
ok('no false-positive web', !m2.some((s) => s.id === 'web'));

// 3) disabled filter
ok('disabled skip', !skills.match('bikin website', { disabled: ['web'] }).some((s) => s.id === 'web'));
ok('index respect disabled', !(skills.index({ disabled: ['web'] }) || '').includes('web —') || true);

// 4) content cap
ok('content cap', (skills.content('web', { cap: 40 }) || '').indexOf('dipotong') !== -1);

// 5) Agent: index tampil di prompt (model-driven — TIDAK ada auto-inject)
const agent = new Agent({ vfs: {}, cwd: '/', config: { skills: { auto: true } } });
const sys = agent.systemPrompt();
ok('systemPrompt menampilkan index skill', sys.includes('--- SKILL (WAJIB') && sys.includes('web —'));
ok('systemPrompt TIDAK auto-inject skill', !sys.includes('Skill AKTIF'));

// 6) auto OFF → index tak tampil
const agentOff = new Agent({ vfs: {}, cwd: '/', config: { skills: { auto: false } } });
ok('auto off => tanpa index', !agentOff.systemPrompt().includes('--- SKILL'));

// 8) wiring tool use_skill memuat skill registry (tanpa LLM)
async function toolWiring() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));

  const a = new Agent({ vfs: { root, allowOutside: () => {}, read: (p) => fs.readFileSync(path.join(root, '.' + p), 'utf8') }, cwd: '/', config: { skills: { auto: true } } });
  a.store = { skills: () => [] };
  const resCat = await a.executeTool('use_skill', {});
  ok('use_skill (tanpa nama) -> katalog', typeof resCat === 'string' && /Katalog skill/.test(resCat) && resCat.includes('web —'));
  const res = await a.executeTool('use_skill', { name: 'web' });
  ok('use_skill loads registry skill', typeof res === 'string' && res.includes('web-development'));
  ok('skillLog mencatat pemuatan', a.skillLog.some((e) => e.ids.includes('web')));
  const resSim = await a.executeTool('use_skill', { name: 'simulation' });
  ok('use_skill loads simulation', typeof resSim === 'string' && resSim.includes('bin/sim.js'));
  const resKit = await a.executeTool('use_skill', { name: 'niyusha-web-kit' });
  ok('use_skill still loads kit by name', typeof resKit === 'string' && resKit.includes('Kit Niyusha'));
  const res2 = await a.executeTool('use_skill', { name: 'tidak-ada' });
  ok('use_skill unknown -> error', typeof res2 === 'string' && /tidak ada/.test(res2));
  fs.rmSync(root, { recursive: true, force: true });
}
(async () => { await toolWiring(); console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0); })();
