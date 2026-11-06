#!/usr/bin/env node
'use strict';

// Regresi: history yang ter-abort di tengah tool-call HARUS dibersihkan agar
// provider tidak menolak ("Not the same number of function calls and responses").
const path = require('path');
const { Agent } = require(path.join(__dirname, '..', 'bin/ai'));

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
const mk = () => new Agent({ vfs: {}, cwd: '/', config: { apiKey: 'x', model: 'm', providerInfo: { requiredKey: true } } });

// 1) abort: assistant 2 tool_calls, 1 dijawab → tool_calls dibuang, tool yatim dibuang
const a = mk();
a.history = [
  { role: 'user', content: 'do' },
  { role: 'assistant', content: null, tool_calls: [
    { id: 'a', type: 'function', function: { name: 'read_file', arguments: '{}' } },
    { id: 'b', type: 'function', function: { name: 'write_file', arguments: '{}' } },
  ] },
  { role: 'tool', tool_call_id: 'a', content: 'ok' },
  { role: 'user', content: 'halo' },
];
a._sanitizeHistory();
ok('abort: assistant.tool_calls dibuang', !a.history.some((m) => m.role === 'assistant' && m.tool_calls));
ok('abort: tool yatim dibuang', !a.history.some((m) => m.role === 'tool'));
ok('abort: assistant punya teks pengganti', a.history.some((m) => m.role === 'assistant' && /dibatalkan/.test(m.content || '')));

// 2) pasangan lengkap → TIDAK diubah
const b = mk();
b.history = [
  { role: 'user', content: 'do' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'a', content: 'ok' },
];
b._sanitizeHistory();
ok('lengkap: tetap utuh (assistant+tool)', b.history.length === 3 && !!b.history[1].tool_calls && b.history[2].role === 'tool');

// 3) history tanpa tool → tak berubah
const c = mk();
c.history = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'lagi' }];
c._sanitizeHistory();
ok('tanpa tool: tak berubah', c.history.length === 3 && c.history.every((m) => m.role !== 'tool'));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
