'use strict';

// ── Tes hardening robustness (regresi v0.2.4 & guard baru) ──────────────
// 1) output kosong → placeholder assistant NON-kosong + nudge (tanpa 400 NIM)
// 2) tool call terpotong (args invalid / hilang required) → hasil tool ERROR
//    sintetis, TIDAK dieksekusi, pasangan assistant↔tool selalu lengkap
// 3) _sanitizeHistory: assistant kosong / tool yatim / leading tool dibuang
// 4) _extraBodyParams: reasoning_budget hanya utk nemotron NIM, di body asli
// 5) retry 400: sanitize → rebuild → panggil ulang sekali → pulih
// 6) compactIfNeeded memotong di tengah grup tool → riwayat tetap valid

const path = require('path');
const os = require('os');
const { Agent, classifyCommand } = require(path.join(__dirname, '..', 'bin/ai'));
const { VirtualFS } = require(path.join(__dirname, '..', 'bin/vfs'));
const { DEFAULT_PERMISSIONS } = require(path.join(__dirname, '..', 'bin/config'));

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

const realFetch = global.fetch;
const mkAgent = (extra = {}) =>
  new Agent({
    vfs: new VirtualFS('t', os.tmpdir()),
    cwd: '/',
    config: { baseUrl: 'https://example.com/v1', apiKey: 'x', model: 'm', provider: 'openrouter', streaming: false, ...extra },
  });

const noEmptyAssistant = (h) => h.every((m) => !(m && m.role === 'assistant' && !m.content && !(Array.isArray(m.tool_calls) && m.tool_calls.length)));
const pairingOk = (h) => {
  const answered = new Set(h.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
  return h.every((m) => !(m && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) || m.tool_calls.every((tc) => answered.has(tc.id)));
};

(async () => {
  // 0) Risiko tinggi harus tetap meminta konfirmasi meski sudah di-allow.
  const riskyCommand = 'Remove-Item -Recurse C:\\temp\\example';
  const riskyDecision = classifyCommand(
    riskyCommand,
    { allow: [riskyCommand], deny: [] },
    [riskyCommand]
  );
  ok('permissions: dangerous command tetap ask meski allow sesi/config', riskyDecision.decision === 'ask', JSON.stringify(riskyDecision));
  ok('permissions: dangerous command wajib konfirmasi ulang', riskyDecision.alwaysConfirm === true, JSON.stringify(riskyDecision));
  const aliasDecision = classifyCommand('ri -Recurse C:\\temp\\example', { allow: [], deny: [] }, []);
  ok('permissions: alias PowerShell penghapusan dikenali berisiko', aliasDecision.alwaysConfirm === true, JSON.stringify(aliasDecision));
  const safePowerShell = classifyCommand('Get-Content README.md', DEFAULT_PERMISSIONS, []);
  ok('permissions: PowerShell read-only umum tidak meminta izin', safePowerShell.decision === 'allow', JSON.stringify(safePowerShell));
  const broadNpmRun = classifyCommand('npm run deploy', DEFAULT_PERMISSIONS, []);
  ok('permissions: npm run arbitrary tidak lagi auto-allow', broadNpmRun.decision === 'ask', JSON.stringify(broadNpmRun));
  const deniedDanger = classifyCommand('rm -rf /', { allow: [], deny: ['rm -rf /'] }, []);
  ok('permissions: explicit deny tetap memblokir dangerous command', deniedDanger.decision === 'deny', JSON.stringify(deniedDanger));

  // 1. Output kosong → placeholder non-kosong + nudge, run tetap lanjut.
  const a = mkAgent();
  const replies = [
    { role: 'assistant', content: '', finish_reason: 'stop' },
    { role: 'assistant', content: 'jawaban final' },
  ];
  let aCalls = 0;
  a.callModel = async () => replies[Math.min(aCalls++, replies.length - 1)];
  const res1 = await a.run('halo', {});
  ok('empty: hasil run tetap keluar', res1 === 'jawaban final', res1);
  ok('empty: tanpa assistant content kosong di history', noEmptyAssistant(a.history));
  ok(
    'empty: placeholder + nudge terkirim',
    a.history.some((m) => m.role === 'assistant' && m.content === '(tidak ada output — model diam)') &&
      a.history.some((m) => m.role === 'user' && /Jawabanmu kosong/.test(m.content || ''))
  );

  // 2. Tool call terpotong: args invalid JSON + finish_reason length.
  const b = mkAgent();
  const bReplies = [
    {
      role: 'assistant',
      content: '',
      finish_reason: 'length',
      tool_calls: [{ id: 'tc1', function: { name: 'write_file', arguments: '{"path":"/a.html","content":"<htm' } }],
    },
    { role: 'assistant', content: 'selesai' },
  ];
  let bCalls = 0;
  b.callModel = async () => bReplies[Math.min(bCalls++, bReplies.length - 1)];
  const executedB = [];
  b.executeTool = async (name, args) => {
    executedB.push(name);
    return 'OK';
  };
  const res2 = await b.run('buat file', {});
  ok('tool-terpotong: args rusak TIDAK dieksekusi', executedB.length === 0, JSON.stringify(executedB));
  ok('tool-terpotong: run tetap selesai', res2 === 'selesai', res2);
  const bToolMsgs = b.history.filter((m) => m.role === 'tool');
  ok('tool-terpotong: hasil tool ERROR sintetis', bToolMsgs.length === 1 && /tidak valid/.test(bToolMsgs[0].content || ''), JSON.stringify(bToolMsgs));
  ok('tool-terpotong: pasangan assistant↔tool lengkap', pairingOk(b.history));

  // 2b. Terpotong di karakter ke-0 (args kosong tapi tool wajib punya param).
  const b2 = mkAgent();
  const b2Replies = [
    {
      role: 'assistant',
      content: '',
      finish_reason: 'length',
      tool_calls: [{ id: 'tc1', function: { name: 'write_file', arguments: '' } }],
    },
    { role: 'assistant', content: 'beres' },
  ];
  let b2Calls = 0;
  b2.callModel = async () => b2Replies[Math.min(b2Calls++, b2Replies.length - 1)];
  const executedB2 = [];
  b2.executeTool = async (name) => {
    executedB2.push(name);
    return 'OK';
  };
  const res2b = await b2.run('buat file', {});
  ok('args kosong + required: tidak dieksekusi', executedB2.length === 0, JSON.stringify(executedB2));
  ok('args kosong + required: run selesai', res2b === 'beres', res2b);

  // 2c. Args valid '{}' untuk tool required → tetap dieksekusi (valid JSON).
  const c2 = mkAgent();
  const c2Replies = [
    { role: 'assistant', content: '', tool_calls: [{ id: 'tc1', function: { name: 'write_file', arguments: '{}' } }] },
    { role: 'assistant', content: 'ok' },
  ];
  let c2Calls = 0;
  c2.callModel = async () => c2Replies[Math.min(c2Calls++, c2Replies.length - 1)];
  const executedC2 = [];
  c2.executeTool = async (name, args) => {
    executedC2.push({ name, args });
    return 'ERROR: write_file butuh "path" yang valid.';
  };
  await c2.run('x', {});
  ok('args \'{}\' valid JSON: dieksekusi (validasi di executeTool)', executedC2.length === 1, JSON.stringify(executedC2));

  // 3. _sanitizeHistory.
  const s = mkAgent();
  s.history = [
    { role: 'tool', tool_call_id: 'zzz', content: 'yatim' },
    { role: 'assistant', content: '' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'oke', tool_calls: [{ id: 'tc9', function: { name: 'read_file', arguments: '{}' } }] },
  ];
  const changed = s._sanitizeHistory();
  ok('sanitize: ada perubahan', changed === true);
  ok('sanitize: leading tool dibuang', s.history[0].role !== 'tool');
  ok('sanitize: assistant kosong dibuang', noEmptyAssistant(s.history));
  ok(
    'sanitize: tool_calls tak terjawab dilepas',
    s.history.every((m) => !(m && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length))
  );
  ok('sanitize: idempoten (run ke-2 bersih)', s._sanitizeHistory() === false);

  // 4. reasoning_budget hanya utk nemotron NIM, dan masuk ke body request.
  const n1 = mkAgent({ provider: 'nvidianim', model: 'nvidia/nemotron-3.5-lightning-30b-a3b', maxTokens: 8192 });
  ok('body: reasoning_budget lightning = 4096', JSON.stringify(n1._extraBodyParams()) === JSON.stringify({ reasoning_budget: 4096 }));
  const n2 = mkAgent({ provider: 'nvidianim', model: 'nvidia/nemotron-3-nano-30b-a3b' });
  ok('body: nano tanpa reasoning_budget', Object.keys(n2._extraBodyParams()).length === 0);
  const n3 = mkAgent({ provider: 'openrouter', model: 'openai/gpt-oss-120b' });
  ok('body: openrouter tanpa reasoning_budget', Object.keys(n3._extraBodyParams()).length === 0);

  let captured = null;
  global.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return fakeRes({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] });
  };
  await n1.callModel([{ role: 'user', content: 'x' }], {});
  ok('callModel: reasoning_budget terkirim di body', captured && captured.reasoning_budget === 4096, JSON.stringify(captured && captured.reasoning_budget));
  ok('callModel: max_tokens 8192 terkirim', captured && captured.max_tokens === 8192, String(captured && captured.max_tokens));

  // 4b. Metadata internal (createdAt/user) tidak boleh ikut ke provider ketat.
  captured = null;
  await n1.callModel(
    [
      { role: 'system', content: 's' },
      { createdAt: 1793844531219, role: 'user', content: 'halo', user: { createdAt: 1 } },
      { createdAt: 1, role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', index: 0, function: { name: 'x', arguments: '{}' }, extra: true }] },
      { createdAt: 2, role: 'tool', tool_call_id: 't1', content: 'ok' },
    ],
    {}
  );
  const sent = captured.messages || [];
  ok('body: metadata createdAt/user tidak terkirim', sent.every((m) => m.createdAt === undefined && m.user === undefined), JSON.stringify(sent));
  ok('body: field non-standar tool_calls dibuang', sent[2].tool_calls.every((tc) => tc.index === undefined && tc.extra === undefined), JSON.stringify(sent[2].tool_calls));

  // 5. Retry 400: korupsi muncul di tengah ronde → sanitize → rebuild → pulih.
  const r = mkAgent();
  let rCalls = 0;
  r.callModel = async () => {
    rCalls++;
    if (rCalls === 1) {
      r.history.push({ role: 'assistant', content: '' });
      const e = new Error('HTTP 400 — request/model tidak valid');
      e.status = 400;
      throw e;
    }
    return { role: 'assistant', content: 'pulih' };
  };
  const res5 = await r.run('halo', {});
  ok('retry-400: hasil pulih', res5 === 'pulih', res5);
  ok('retry-400: callModel dipanggil 2x', rCalls === 2, String(rCalls));
  ok('retry-400: history bersih setelah pulih', noEmptyAssistant(r.history));

  // 6. compact di tengah grup tool → riwayat valid (tidak leading tool / yatim).
  const k = mkAgent();
  k.history = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'x', tool_calls: [{ id: 'tc2', function: { name: 'read_file', arguments: '{"path":"/f"}' } }] },
    { role: 'user', content: 'b' },
    { role: 'assistant', content: 'y' },
    { role: 'tool', tool_call_id: 'tc2', content: 'isi lama' },
    { role: 'user', content: 'c' },
    { role: 'assistant', content: 'z' },
    { role: 'user', content: 'd' },
    { role: 'assistant', content: 'e' },
    { role: 'user', content: 'f' },
  ];
  k.callModel = async () => ({ role: 'assistant', content: 'ringkasan padat' });
  await k.compactIfNeeded(true);
  ok('compact: tidak diawali tool', k.history[0].role !== 'tool', k.history[0].role);
  ok('compact: pasangan tool tetap valid', pairingOk(k.history));
  ok('compact: sanitize idempoten sesudahnya', k._sanitizeHistory() === false);

  global.fetch = realFetch;
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  global.fetch = realFetch;
  console.error('ERROR', e);
  process.exitCode = 1;
});
