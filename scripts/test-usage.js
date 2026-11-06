'use strict';

// ── Tes meter Context berbasis usage provider (Bug #9) ─────────────────
// Memverifikasi usage non-stream/stream, akumulasi request, provider anchor
// plus estimated character deltas, dan reset/fallback context estimate.

const path = require('path');
const { Agent } = require(path.join(__dirname, '..', 'bin', 'ai'));
const ideAIPath = path.join(__dirname, '..', '..', 'ide-engine', 'tui', 'bin', 'ai.js');
const IdeAgent = require('fs').existsSync(ideAIPath) ? require(ideAIPath).Agent : null;

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

const realFetch = global.fetch;
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

const mkAgent = (extra = {}) =>
  new Agent({
    vfs: {},
    cwd: '/',
    config: { baseUrl: 'https://example.com/v1', apiKey: 'x', model: 'm', provider: 'openrouter', streaming: false, ...extra },
  });

(async () => {
  // 1. Sebelum request pertama → estimasi chars/4 tanpa provider anchor.
  const a = mkAgent();
  a.history.push({ role: 'user', content: 'halo' });
  const before = a.contextTokens();
  ok('sebelum request: no provider anchor', before.real === false);
  ok('sebelum request: source estimasi karakter', before.source === 'character-estimate');
  ok('sebelum request: used>0 (estimasi)', before.used > 0, String(before.used));

  const retrievalAgent = mkAgent();
  retrievalAgent.history.push({ role: 'user', content: 'pertanyaan' });
  const withoutRetrieval = retrievalAgent.contextTokens().used;
  retrievalAgent._lastRetrievalResult = '\n\nkonteks retrieval relevan';
  const withRetrieval = retrievalAgent.contextTokens();
  ok('context estimate includes URich retrieval text', withRetrieval.used > withoutRetrieval, `${withoutRetrieval} -> ${withRetrieval.used}`);

  // 2. Non-stream + trackUsage → usage.prompt_tokens jadi jangkar (delta 0).
  global.fetch = async () =>
    fakeRes({
      choices: [{ message: { role: 'assistant', content: 'halo juga' } }],
      usage: { prompt_tokens: 4997, completion_tokens: 9, total_tokens: 5006 },
    });
  const sys = a.systemPrompt();
  const msgs = [{ role: 'system', content: sys }, ...a.history];
  await a.callModel(msgs, { trackUsage: true });
  const after = a.contextTokens();
  ok('non-stream: usage.prompt tercatat', a.usage && a.usage.prompt === 4997, JSON.stringify(a.usage));
  ok('non-stream: provider anchor exists', after.real === true);
  ok('non-stream: source provider-anchored estimate', after.source === 'provider-anchored-estimate');
  ok('non-stream: used === prompt_tokens (delta 0)', after.used === 4997, String(after.used));
  ok('non-stream: lastUsage completion ikut', a.usage.completion === 9);
  const su1 = a.getSessionUsage();
  ok(
    'session: akumulasi non-stream',
    su1.prompt === 4997 && su1.completion === 9 && su1.total === 5006 && su1.requests === 1,
    JSON.stringify(su1)
  );

  // 3. History tumbuh → delta chars/4 di atas jangkar.
  a.history.push({ role: 'user', content: 'xxxxxxxx' }); // +4 (msg) +8 chars = 12 → +3
  const grew = a.contextTokens();
  ok('history tumbuh: used = 4997+ceil(3*1.3)', grew.used === 5001, String(grew.used));

  // 4. Panggilan TANPA trackUsage (mis. kompaksi) tidak menimpa angka riil.
  const usageBefore = JSON.stringify(a.usage);
  await a.callModel([{ role: 'system', content: 'kompresor' }], {});
  ok('tanpa trackUsage: usage tidak berubah', JSON.stringify(a.usage) === usageBefore);
  const su2 = a.getSessionUsage();
  ok(
    'session: request non-trackUsage tetap terakumulasi',
    su2.prompt === 9994 && su2.completion === 18 && su2.total === 10012 && su2.requests === 2,
    JSON.stringify(su2)
  );

  // 5. Stream: usage dari chunk akhir tercapture.
  const b = mkAgent({ streaming: true });
  b.history.push({ role: 'user', content: 'halo' });
  global.fetch = async () =>
    fakeStream([
      'data: {"choices":[{"delta":{"content":"ha"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":5200,"completion_tokens":2,"total_tokens":5202}}',
      'data: [DONE]',
    ]);
  let deltas = '';
  await b.callModel([{ role: 'system', content: sys }, ...b.history], { trackUsage: true, onDelta: (d) => (deltas += d.text || '') });
  ok('stream: teks utuh', deltas === 'halo', JSON.stringify(deltas));
  ok('stream: usage.prompt tercatat dari chunk akhir', b.usage && b.usage.prompt === 5200, JSON.stringify(b.usage));
  ok('stream: provider anchor exists', b.contextTokens().real === true);

  // 6. Stream tanpa usage → fallback estimasi, tidak error.
  const c = mkAgent({ streaming: true });
  c.history.push({ role: 'user', content: 'halo' });
  global.fetch = async () =>
    fakeStream(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']);
  await c.callModel([{ role: 'system', content: sys }, ...c.history], { trackUsage: true, onDelta: () => {} });
  ok('stream tanpa usage: usage tetap null', c.usage == null);
  ok('stream tanpa usage: no provider anchor', c.contextTokens().real === false);
  const sc = c.getSessionUsage();
  ok(
    'stream tanpa usage: sesi tetap mencatat estimasi',
    sc.estimated === 1 && sc.requests === 1 && sc.prompt > 0 && sc.completion > 0 && sc.total === sc.prompt + sc.completion,
    JSON.stringify(sc)
  );
  const imageBase = mkAgent();
  const plainChars = imageBase._countSendChars([{ role: 'user', content: [{ type: 'text', text: 'review' }] }]);
  const withImageChars = imageBase._countSendChars([{
    role: 'user',
    content: [{ type: 'text', text: 'review' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(100000)}` } }],
  }]);
  ok('vision image uses bounded token estimate instead of base64 length', withImageChars - plainChars === 4800, String(withImageChars - plainChars));
  if (IdeAgent) {
    const ideImageAgent = new IdeAgent({ config: {} });
    const idePlainChars = ideImageAgent._countSendChars([{ role: 'user', content: [{ type: 'text', text: 'review' }] }]);
    const ideImageChars = ideImageAgent._countSendChars([{
      role: 'user',
      content: [{ type: 'text', text: 'review' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(100000)}` } }],
    }]);
    ok('IDE vision image uses the same bounded token estimate', ideImageChars - idePlainChars === 4800, String(ideImageChars - idePlainChars));
  }

  // 7. compactIfNeeded → jangkar usage dibuang (kembali estimasi).
  const d = mkAgent();
  d.usage = { prompt: 5000, completion: 0, total: 5000, baseChars: 12000, at: Date.now() };
  for (let i = 0; i < 8; i++) d.history.push({ role: i % 2 ? 'assistant' : 'user', content: 'pesan ' + i + ' yang cukup panjang isinya' });
  global.fetch = async () => fakeRes({ choices: [{ message: { role: 'assistant', content: 'ringkasan singkat' } }] });
  await d.compactIfNeeded(true);
  ok('compact: usage di-reset', d.usage == null);
  ok('compact: no provider anchor after compaction', d.contextTokens().real === false);

  // 8. setSessionUsage + reset() → usage & akumulasi sesi bersih.
  d.setSessionUsage({ prompt: 10, completion: 5, total: 0, requests: 2, estimated: 1 });
  ok(
    'setSessionUsage: normalisasi total',
    d.getSessionUsage().total === 15 && d.getSessionUsage().requests === 2 && d.getSessionUsage().estimated === 1
  );
  d.usage = { prompt: 1, completion: 0, total: 1, baseChars: 1, at: Date.now() };
  d.reset();
  ok('reset: usage null', d.usage == null);
  ok('reset: sessionUsage nol', d.getSessionUsage().total === 0 && d.getSessionUsage().requests === 0);

  // 9. Benchmark/evaluation requests may explicitly disable tool calls.
  const toolChoiceBodies = [];
  global.fetch = async (_url, init) => {
    toolChoiceBodies.push(JSON.parse(init.body));
    return fakeRes({ choices: [{ message: { role: 'assistant', content: 'jawaban' } }] });
  };
  await d.callModel([{ role: 'user', content: 'jawab dari konteks saja' }], { toolChoice: 'none' });
  await d.callModel([{ role: 'user', content: 'gunakan tool bila perlu' }], {});
  ok('request: toolChoice none dihormati', toolChoiceBodies[0] && toolChoiceBodies[0].tool_choice === 'none');
  ok('request: toolChoice default tetap auto', toolChoiceBodies[1] && toolChoiceBodies[1].tool_choice === 'auto');

  global.fetch = realFetch;
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  global.fetch = realFetch;
  console.error('ERROR', e);
  process.exitCode = 1;
});
