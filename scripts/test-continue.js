'use strict';

// ── Tes guard finish_reason 'length' (jawaban terpotong di tengah) ────
// 1) capture finish_reason non-stream & stream → msg.finish_reason
// 2) run(): finish_reason length → sambung otomatis (maks 2×), hasil utuh
// 3) fallback: 3× length berturut → return potongan terakhir tanpa loop

const path = require('path');
const os = require('os');
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

const fakeRes = (obj) => ({
  ok: true,
  headers: { get: () => null },
  text: async () => JSON.stringify(obj),
});
const fakeStream = (lines) => ({
  ok: true,
  headers: { get: () => null },
  body: {
    getReader() {
      let i = 0;
      return {
        read: async () => (i < lines.length ? { done: false, value: Buffer.from(lines[i++] + '\n\n') } : { done: true }),
      };
    },
  },
});

const realFetch = global.fetch;
const mkAgent = (extra = {}) =>
  new Agent({
    vfs: new VirtualFS('t', os.tmpdir()),
    cwd: '/',
    config: { baseUrl: 'https://example.com/v1', apiKey: 'x', model: 'm', provider: 'openrouter', streaming: false, ...extra },
  });

(async () => {
  // 1. Non-stream: finish_reason tercatat.
  global.fetch = async () =>
    fakeRes({ choices: [{ message: { role: 'assistant', content: 'potong di sini' }, finish_reason: 'length' }] });
  const a = mkAgent();
  const m1 = await a.callModel([{ role: 'user', content: 'x' }], {});
  ok('non-stream: finish_reason=length tercatat', m1.finish_reason === 'length', JSON.stringify(m1.finish_reason));

  // 2. Stream: finish_reason dari chunk akhir tercatat.
  const b = mkAgent({ streaming: true });
  global.fetch = async () =>
    fakeStream([
      'data: {"choices":[{"delta":{"content":"pot"}}]}',
      'data: {"choices":[{"delta":{"content":"ong"},"finish_reason":"length"}]}',
      'data: [DONE]',
    ]);
  const m2 = await b.callModel([{ role: 'user', content: 'x' }], { onDelta: () => {} });
  ok('stream: finish_reason=length tercatat', m2.finish_reason === 'length');
  ok('stream: teks utuh tetap terkumpul', m2.content === 'potong', m2.content);

  // 3. run(): potongan + length → auto-sambung sampai jawaban utuh.
  const c = mkAgent();
  const replies = [
    { role: 'assistant', content: 'Bagian satu terpotong', finish_reason: 'length' },
    { role: 'assistant', content: 'Bagian satu terpotong — Bagian dua selesai.' },
  ];
  let calls = 0;
  c.callModel = async () => replies[Math.min(calls++, replies.length - 1)];
  const contEvents = [];
  const result = await c.run('buat briefing', {
    onTool: (name, arg) => contEvents.push(name + ':' + (arg && arg.text)),
  });
  ok('run: hasil final utuh (bagian 1+2)', result === 'Bagian satu terpotong — Bagian dua selesai.', result);
  ok('run: dipanggil 2× (sambungan)', calls === 2, String(calls));
  const nudges = c.history.filter((m) => m.role === 'user' && /TERPOTONG/.test(m.content || ''));
  ok('run: nudge sambung terkirim ke history', nudges.length === 1);
  ok('run: potongan asli di-push ke history sebelum sambung', c.history.some((m) => m.role === 'assistant' && m.content === 'Bagian satu terpotong'));
  ok('run: onTool continue terpicu', contEvents.some((e) => e.startsWith('continue:')), JSON.stringify(contEvents));

  // 4. Tiga length berturut → sambung 2× lalu berhenti (tanpa loop).
  const d = mkAgent();
  let dCalls = 0;
  d.callModel = async () => ({ role: 'assistant', content: `potongan-${++dCalls}`, finish_reason: 'length' });
  const res2 = await d.run('buat briefing lagi', {});
  ok('3× length: hasil = potongan terakhir (tidak loop)', res2 === 'potongan-3', res2);
  ok('3× length: total panggilan 3 (1+2 sambung)', dCalls === 3, String(dCalls));

  global.fetch = realFetch;
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  global.fetch = realFetch;
  console.error('ERROR', e);
  process.exitCode = 1;
});
