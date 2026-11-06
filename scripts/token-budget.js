#!/usr/bin/env node
'use strict';

// ── Guard anti-bloat ────────────────────────────────────────────────────
// Pastikan overhead token dasar tiap request (systemPrompt aktual + schema
// tool) tidak terus membengkak. Jalankan manual: `npm run token`.
// Juga berjalan otomatis sebelum publish (`prepublishOnly`).
//
// Anggaran diukur ~char/4 (kasar, tapi konsisten untuk memantau tren).
// Kalau lewat HARD → gagal (exit 1) supaya bloat tidak lolos rilis.
// Kalau lewat SOFT → peringatan saja (masih boleh, tapi mulai dekat batas).
// Hitung prompt dinamis default juga (workspace + indeks skill), bukan hanya
// SYSTEM_PROMPT konstan, agar guard sejalan dengan overhead yang benar-benar dikirim.

const { Agent, SYSTEM_PROMPT } = require('../bin/ai.js');

const SOFT = Number(process.env.NIYUSHA_TOKEN_SOFT) || 3500; // peringatan
const HARD = Number(process.env.NIYUSHA_TOKEN_HARD) || 3700; // gagal
const MIN_TOOLS = Number(process.env.NIYUSHA_MIN_TOOLS) || 24;

const agent = new Agent({ vfs: { root: process.cwd() }, cwd: '/', config: {} });
const tools = agent.allTools;
const sysChars = (agent.systemPrompt() || '').length;
const toolChars = JSON.stringify(tools).length;
const sysTok = Math.ceil(sysChars / 4);
const toolTok = Math.ceil(toolChars / 4);
const total = sysTok + toolTok;

console.log('Niyusha token budget');
console.log(`  system prompt : ~${sysTok} tok (${sysChars} chars; static core ${SYSTEM_PROMPT.length} chars)`);
console.log(`  tool schemas  : ~${toolTok} tok (${tools.length} tools, ${toolChars} chars)`);
console.log(`  TOTAL overhead: ~${total} tok   [soft ${SOFT} / hard ${HARD}]`);

let fail = false;
if (tools.length < MIN_TOOLS) {
  console.error(`FAIL: jumlah tool ${tools.length} < ${MIN_TOOLS} — ada tool yang hilang.`);
  fail = true;
}
if (total > HARD) {
  console.error(`FAIL: overhead ~${total} tok > hard ${HARD}. Kurangi bloat sebelum naik versi.`);
  fail = true;
} else if (total > SOFT) {
  console.warn(`WARN: overhead ~${total} tok > soft ${SOFT} — mulai dekat batas, hati-hati menambah prompt/tool.`);
}

if (fail) process.exit(1);
console.log('OK: overhead dalam anggaran.');
