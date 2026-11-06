'use strict';

// Stress-test factual recall after native-threshold automatic compaction.
// All modes receive the same long transcript and unmodified context budget.
// Memakai provider/model dari config user (butuh API key). Tidak dijalankan
// oleh `npm test` karena melakukan panggilan jaringan berbayar.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent } = require('../bin/ai');
const { VirtualFS } = require('../bin/vfs');
const { loadConfig } = require('../bin/config');

const long = (text, n) => Array(n).fill(text).join(' ');

function suggestsUnsafeTokenStorage(answer) {
  const text = String(answer || '');
  if (/\b(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|set)\s*\(/i.test(text)) return true;
  return text.split(/[\n.!?;]+/).some((sentence) => {
    const positive = /(?:refresh\s+|access\s+)?token.{0,60}(?:simpan|disimpan|store|stored|save|saved|gunakan|use|set).{0,50}(?:local[\s-]?storage|session[\s-]?storage|memori|memory)|(?:gunakan|use|simpan|store|save|set).{0,50}(?:local[\s-]?storage|session[\s-]?storage|memori|memory).{0,50}(?:refresh\s+|access\s+)?token/i;
    const negative = /(?:jangan|tidak|never|not|dilarang|avoid|don't).{0,40}(?:simpan|disimpan|store|stored|save|saved|gunakan|use|set)|(?:simpan|disimpan|store|stored|save|saved|gunakan|use|set).{0,40}(?:jangan|tidak|never|not|dilarang|avoid)/i;
    return positive.test(sentence) && !negative.test(sentence);
  });
}

function parseArgs(argv) {
  const options = { delayMs: 0, scenario: 'all', modes: ['full', 'legacy', 'urich'], selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--self-test') {
      options.selfTest = true;
    } else if (argv[i] === '--delay-ms') {
      options.delayMs = Number(argv[++i]);
      if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
        throw new Error('--delay-ms harus berupa angka >= 0');
      }
    } else if (argv[i] === '--scenario') {
      options.scenario = String(argv[++i] || '');
      if (!['all', 'auth', 'api'].includes(options.scenario)) {
        throw new Error('--scenario harus all, auth, atau api');
      }
    } else if (argv[i] === '--modes') {
      options.modes = String(argv[++i] || '').split(',').map((mode) => mode.trim()).filter(Boolean);
      if (!options.modes.length || options.modes.some((mode) => !['full', 'legacy', 'urich'].includes(mode))) {
        throw new Error('--modes harus berisi full, legacy, atau urich yang dipisahkan koma');
      }
    }
  }
  return options;
}

function addNoise(history, topic) {
  for (let i = 0; i < 70; i++) {
    history.push(
      { role: 'user', content: `Progress ${i}: lanjutkan implementasi ${topic} dan pertahankan kontrak API.` },
      { role: 'assistant', content: `Pemeriksaan rutin tahap ${i}. ` + long(`detail teknis non-kritis tahap ${i}.`, 125) }
    );
  }
  history.push({ role: 'user', content: `Lanjutkan implementasi ${topic} dan verifikasi.` });
  return history;
}

function buildAuthHistory() {
  const history = [
    { role: 'user', content: 'Tujuan proyek: implementasikan refresh token yang aman di Niyusha Auth. Jangan ubah kontrak publik login().' },
    { role: 'assistant', content: 'Keputusan: gunakan JWT access token 15 menit dan refresh token rotasi. Jangan simpan token di localStorage.' },
    { role: 'user', content: 'File utama src/auth/session.js. File refresh src/auth/refresh.js. Refresh token disimpan di httpOnly cookie bernama rt_v2.' },
    { role: 'assistant', content: 'Error: refresh loop karena token lama masih di memori. Perbaikan: hapus cache token lama sebelum rotasi. ' + long('catatan implementasi tambahan.', 30) },
    { role: 'user', content: 'Dulu frontend memakai React. Sekarang sudah beralih ke Vue. React statusnya superseded.' },
    { role: 'assistant', content: 'Test: npm run test:auth lulus setelah perbaikan. Langkah berikutnya: tambah test expiry atau kedaluwarsa token.' },
    { role: 'user', content: 'Jangan pernah log isi refresh token. Layanan autentikasi bernama auth-v2.' },
    { role: 'assistant', content: long('ringkasan teknis tambahan tanpa fakta baru.', 40) },
    { role: 'user', content: 'Lanjutkan implementasi dan verifikasi.' },
    { role: 'assistant', content: long('status pekerjaan: modul auth stabil, menunggu test tambahan.', 40) },
  ];
  return addNoise(history, 'modul auth');
}

function buildApiHistory() {
  return addNoise([
    { role: 'user', content: 'Tujuan: migrasikan pencarian ke API baru tanpa memutus klien lama.' },
    { role: 'assistant', content: 'Keputusan aktif: endpoint baru adalah GET /v2/search dengan response { items, total, nextCursor }. Endpoint lama GET /v1/query deprecated tetapi harus tetap bekerja selama migrasi.' },
    { role: 'user', content: 'File inti src/api/search.ts. Adapter kompatibilitas ada di src/api/search-compat.ts dan memetakan { results, count } lama ke { items, total } baru.' },
    { role: 'assistant', content: 'Bug yang ditemukan: pagination cursor dibuat dari array index sehingga item duplikat muncul setelah ada insert baru. Cursor harus berdasarkan stable item id.' },
    { role: 'user', content: 'Test terkait: tests/api/search-compat.test.ts. Test response adapter saat ini lulus; test pagination cursor masih gagal.' },
    { role: 'assistant', content: 'Langkah berikutnya: perbaiki cursor dan tambahkan test untuk insert di antara dua page.' },
    { role: 'user', content: 'Jangan hapus endpoint lama sebelum seluruh klien berpindah. Response API baru tidak boleh memakai key results/count.' },
    { role: 'assistant', content: 'Keputusan historis: awalnya migrasi direncanakan langsung menghapus /v1/query, tetapi rencana itu sudah diganti dengan adapter sementara.' },
  ], 'API search');
}

const SCENARIOS = {
  auth: {
    label: 'auth/session continuity',
    buildHistory: buildAuthHistory,
    questions: [
      {
        q: 'Di mana refresh token disimpan, dan apa nama cookie-nya?',
        priority: 'critical',
        groups: [['httponly', 'http only', 'http-only'], ['rt_v2', 'rtv2', 'rt v2']],
        checks: [
          (answer) => /cookie/i.test(answer),
          (answer) => !suggestsUnsafeTokenStorage(answer),
        ],
      },
      {
        q: 'Framework apa yang dipakai sekarang, dan framework apa yang digantikan?',
        priority: 'critical',
        groups: [['vue'], ['react']],
        checks: [
          (answer) => /(sekarang|saat ini|aktif|current).{0,80}vue/i.test(answer) || /vue.{0,80}(sekarang|saat ini|aktif|current)/i.test(answer),
          (answer) => /(digantikan|diganti|superseded|sebelumnya|former|replaced).{0,80}react/i.test(answer) || /react.{0,80}(digantikan|diganti|superseded|sebelumnya|former|replaced)/i.test(answer),
          (answer) => !/(?:frontend|aplikasi|app).{0,40}(?:uses|memakai|menggunakan)\s+react/i.test(answer),
        ],
      },
      {
        q: 'File mana yang menangani refresh, dan error apa yang pernah terjadi?',
        priority: 'important',
        groups: [['refresh.js'], ['loop', 'cache', 'token lama']],
      },
      {
        q: 'Apa larangan terkait penyimpanan atau log token?',
        priority: 'critical',
        groups: [['localstorage', 'local storage'], ['jangan', 'tidak', 'never', 'dilarang']],
        checks: [
          (answer) => /(?:jangan|tidak|never|not|dilarang|avoid).{0,60}(?:local[\s-]?storage|simpan|store)|(?:local[\s-]?storage).{0,60}(?:jangan|tidak|never|not|dilarang|avoid)/i.test(answer),
          (answer) => /(?:jangan|tidak|never|not|dilarang|avoid).{0,60}(?:log|catat)|(?:log|catat).{0,60}(?:jangan|tidak|never|not|dilarang|avoid)/i.test(answer),
          (answer) => !suggestsUnsafeTokenStorage(answer),
        ],
      },
      {
        q: 'Apa langkah berikutnya?',
        priority: 'important',
        groups: [['test'], ['expiry', 'kedaluwarsa', 'expire']],
      },
      {
        q: 'Apa durasi access token dan strategi rotasi refresh token?',
        priority: 'important',
        groups: [['15 menit', '15-minute', '15 minutes'], ['rotasi', 'rotation']],
        checks: [(answer) => !suggestsUnsafeTokenStorage(answer)],
      },
    ],
  },
  api: {
    label: 'API migration and code continuity',
    buildHistory: buildApiHistory,
    questions: [
      {
        q: 'Apa endpoint pencarian yang aktif dan endpoint mana yang masih dipertahankan sementara?',
        priority: 'critical',
        groups: [['/v2/search'], ['/v1/query']],
        checks: [
          (answer) => /\/v2\/search.{0,100}(aktif|baru|current)/i.test(answer) || /(aktif|baru|current).{0,100}\/v2\/search/i.test(answer),
          (answer) => /\/v1\/query.{0,100}(lama|deprecated|sementara|legacy|dipertahankan)/i.test(answer) || /(lama|deprecated|sementara|legacy|dipertahankan).{0,100}\/v1\/query/i.test(answer),
        ],
      },
      {
        q: 'File inti dan file adapter apa yang terlibat, dan apa fungsi adapter?',
        priority: 'important',
        groups: [['src/api/search.ts'], ['src/api/search-compat.ts'], ['results', 'count'], ['items', 'total']],
        checks: [
          (answer) => /results.{0,40}count.{0,100}items.{0,40}total/i.test(norm(answer)),
          (answer) => /(adapter|adaptor|compatib)/i.test(answer),
          (answer) => !/(vice versa|sebaliknya|both directions|dua arah|kedua arah)/i.test(answer),
        ],
      },
      {
        q: 'Apa penyebab bug pagination dan berdasarkan apa cursor harus dibuat?',
        priority: 'critical',
        groups: [
          ['index', 'indeks'],
          [
            'stable item id',
            'stable id',
            'item id',
            'id item',
            'unique id',
            'unique identifier',
            'primary key',
            'immutable id',
            'id unik',
            'identifier unik',
            'stable identifier',
            'identifier yang stabil',
            'unik untuk item',
            'id terakhir',
          ],
        ],
      },
      {
        q: 'Test mana yang masih gagal dan langkah perbaikan berikutnya apa?',
        priority: 'critical',
        groups: [
          ['tests/api/search-compat.test.ts'],
          ['pagination', 'cursor'],
          ['insert', 'penyisipan', 'menyisipkan', 'antara dua halaman', 'ditambahkan', 'added', 'add test'],
        ],
        checks: [
          (answer) => /(gagal|fail|failing|failed)/i.test(answer),
          (answer) => /(langkah berikutnya|selanjutnya|berikutnya|next step|tambahkan|add|buat)/i.test(answer),
          (answer) => !/(belum ada nama file spesifik|no specific file|file .* kemungkinan)/i.test(answer),
        ],
      },
    ],
  },
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function hit(answer, item) {
  const a = norm(answer);
  const groupsPassed = item.groups.every((group) => group.some((k) => a.includes(norm(k))));
  return groupsPassed && (item.checks || []).every((check) => check(answer));
}

function looksLikeToolCall(text) {
  return /(?:\{\s*"tool"\s*:|<\|tool_call\|>|<\s*\/?\s*tool_call\s*>|<function_calls?>)/i.test(String(text || ''));
}

async function makeAgent(mode, scenarioId, root, baseConfig) {
  const config = {
    ...baseConfig,
    compactionMode: mode === 'full' ? 'off' : mode,
    contextEngineDir: path.join(root, 'context'),
    compactionArchiveDir: path.join(root, 'archive'),
    temperature: 0,
    streaming: false,
    retries: 5,
    retryBaseMs: 25000,
    timeoutMs: 60000,
  };
  const agent = new Agent({ vfs: new VirtualFS(`quality-${scenarioId}-${mode}`, root), cwd: root, config });
  agent.tools = [];
  agent.history = SCENARIOS[scenarioId].buildHistory();
  const before = agent.contextTokens();
  let compactionError = null;
  if (mode !== 'full') {
    agent.pruneOldToolResults();
    try {
      if (agent.history.length > 8) await agent.compactIfNeeded(false, { trigger: 'auto' });
    } catch (error) {
      compactionError = error.message || String(error);
    }
  }
  const after = agent.contextTokens();
  const compactionUsage = agent.getSessionUsage();
  if (mode !== 'full' && !agent.compactions && !compactionError) {
    const reasons = agent.lastCompactionValidation && agent.lastCompactionValidation.reasons;
    compactionError = reasons && reasons.length
      ? `compaction candidate rejected: ${reasons.join('; ')}`
      : `compaction did not complete (context ${before.used}/${before.budget}; trigger=${agent.compactionStats().lastTrigger || 'not triggered'})`;
  }
  agent.tools = [];
  agent.qualityCompactionError = compactionError;
  agent.qualityCompaction = {
    before: before.used,
    after: after.used,
    budget: before.budget,
    compactions: agent.compactions,
    trigger: agent.compactionStats().lastTrigger,
    usage: compactionUsage,
    validation: agent.lastCompactionValidation,
    urich: agent.lastUrich,
  };
  return agent;
}

async function ask(agent, question) {
  const system = agent.systemPrompt() + agent._urichRetrievalContext(question);
  let messages = [
    { role: 'system', content: system },
    ...agent.history,
    { role: 'user', content: `Jawab ringkas dan langsung; jawab semua bagian pertanyaan.\n${question}` },
  ];
  const usageBefore = agent.getSessionUsage();
  let msg;
  let attempts = 0;
  do {
    attempts++;
    msg = await agent.callModel(messages, {
      retries: 5,
      retryBaseMs: 25000,
      trackContext: false,
      toolChoice: 'none',
    });
    if ((!msg.tool_calls || !msg.tool_calls.length) && !looksLikeToolCall(msg.content) && String(msg.content || '').trim()) break;
    messages = messages.concat({
      role: 'user',
      content: 'Jawab hanya dengan teks biasa berdasarkan riwayat yang diberikan. Jangan panggil tool.',
    });
  } while (attempts < 2);
  const usageAfter = agent.getSessionUsage();
  return {
    text: String(msg.content || '').trim(),
    finishReason: msg.finish_reason || null,
    toolCalls: (Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0) + (looksLikeToolCall(msg.content) ? 1 : 0),
    attempts,
    chars: agent._countSendChars(messages),
    usage: {
      prompt: usageAfter.prompt - usageBefore.prompt,
      completion: usageAfter.completion - usageBefore.completion,
      total: usageAfter.total - usageBefore.total,
      requests: usageAfter.requests - usageBefore.requests,
      estimated: usageAfter.estimated - usageBefore.estimated,
    },
  };
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    const assert = require('assert');
    const cookieQuestion = SCENARIOS.auth.questions[0];
    const frameworkQuestion = SCENARIOS.auth.questions[1];
    const storageQuestion = SCENARIOS.auth.questions[3];
    const rotationQuestion = SCENARIOS.auth.questions[5];
    assert.strictEqual(hit('Refresh token disimpan di httpOnly cookie bernama rt_v2.', cookieQuestion), true);
    assert.strictEqual(hit('Refresh token disimpan di httpOnly cookie bernama rt_v2, lalu simpan token di memory.', cookieQuestion), false);
    assert.strictEqual(hit('Jangan simpan token di localStorage atau log nilainya. Gunakan sessionStorage untuk access token.', storageQuestion), false);
    assert.strictEqual(hit('Sekarang memakai Vue, React sudah digantikan.', frameworkQuestion), true);
    assert.strictEqual(hit('Sekarang memakai Vue, React sudah digantikan, tetapi frontend uses React.', frameworkQuestion), false);
    assert.strictEqual(hit('Access token 15 menit dengan rotasi. Refresh token hanya disimpan di memory.', rotationQuestion), false);
    console.log('PASS quality-context scoring self-test');
    return;
  }
  const baseConfig = loadConfig();
  console.log(`Provider/model: ${baseConfig.provider}/${baseConfig.model} · context budget=${baseConfig.contextBudget || 'default'} · modes=${options.modes.join(',')}`);
  if (baseConfig.provider !== 'ollama' && !baseConfig.apiKey) {
    console.error('SKIP quality: API key belum diset.');
    process.exitCode = 2;
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-quality-'));
  const rows = [];
  const scenarioIds = options.scenario === 'all' ? Object.keys(SCENARIOS) : [options.scenario];
  for (const scenarioId of scenarioIds) {
    const scenario = SCENARIOS[scenarioId];
    console.log(`\n=== ${scenario.label} ===`);
    for (const mode of options.modes) {
      const agent = await makeAgent(mode, scenarioId, path.join(root, scenarioId, mode), baseConfig);
      const used = agent.contextTokens().used;
      const summaryChars = (agent.summary || '').length;
      const modeRows = [];
      let passed = 0;
      const eligible = mode === 'full' || !agent.qualityCompactionError;
      if (eligible) {
        for (let i = 0; i < scenario.questions.length; i++) {
          const item = scenario.questions[i];
          process.stdout.write(`  ${mode} Q${i + 1}/${scenario.questions.length} ... `);
          let out;
          try {
            out = await ask(agent, item.q);
          } catch (error) {
            out = {
              text: '',
              finishReason: null,
              toolCalls: 0,
              attempts: 0,
              chars: 0,
              error: error.message || String(error),
              usage: { prompt: 0, completion: 0, total: 0, requests: 0, estimated: 0 },
            };
          }
          const ok = !out.error && out.toolCalls === 0 && hit(out.text, item);
          if (ok) passed++;
          console.log(ok ? 'PASS' : 'FAIL');
          const row = {
            scenario: scenarioId,
            mode,
            ok,
            q: item.q,
            used,
            summaryChars,
            chars: out.chars,
            answer: out.text,
            finishReason: out.finishReason,
            toolCalls: out.toolCalls,
            attempts: out.attempts,
            error: out.error || null,
            usage: out.usage,
          };
          rows.push(row);
          modeRows.push(row);
          if (options.delayMs > 0) await new Promise((r) => setTimeout(r, options.delayMs));
        }
      }
      const avgPromptChars = modeRows.length
        ? Math.round(modeRows.reduce((sum, r) => sum + r.chars, 0) / modeRows.length)
        : 0;
      const compactStatus = agent.qualityCompactionError
        ? `invalid: ${agent.qualityCompactionError}`
        : mode === 'full' ? 'baseline' : 'ok';
      const measured = [agent.qualityCompaction.usage, ...modeRows.map((r) => r.usage)];
      const usageTotal = measured.reduce((sum, item) => sum + item.total, 0);
      const estimated = measured.reduce((sum, item) => sum + item.estimated, 0);
      const answerUsage = modeRows.reduce((sum, item) => sum + item.usage.total, 0);
      console.log(
        `${mode.padEnd(7)} ${eligible ? `${passed}/${scenario.questions.length}` : 'NOT SCORED'} · compact=${compactStatus} ` +
        `· native=${agent.qualityCompaction.before}→${agent.qualityCompaction.after}/${agent.qualityCompaction.budget} est tok ` +
        `· trigger=${agent.qualityCompaction.trigger || '-'} · compactions=${agent.qualityCompaction.compactions} · prompt=${avgPromptChars} chars avg ` +
        `· summary=${summaryChars} chars · history=${agent.history.length} ` +
        `· usage compact=${agent.qualityCompaction.usage.total}, answers=${answerUsage}, total=${usageTotal}` +
        `${estimated ? ` (estimated requests=${estimated})` : ' (provider-reported)'}`
      );
      if (agent.qualityCompactionError) {
        const validation = agent.qualityCompaction.validation;
        const urich = agent.qualityCompaction.urich;
        console.log(`  compaction diagnostics: ${JSON.stringify({
          validation: validation ? { ok: validation.ok, reasons: validation.reasons, candidateMessages: validation.candidateMessages } : null,
          urich: urich ? {
            ai: urich.ai,
            aiChunks: urich.aiChunks,
            aiError: urich.aiError,
            atoms: urich.atoms,
            totalAtoms: urich.totalAtoms,
            chars: urich.chars,
            memoryChars: urich.memoryChars,
            validation: urich.validation,
            diagnostics: urich.diagnostics,
          } : null,
        })}`);
      }
    }
  }

  console.log('\nDetail:');
  for (const r of rows) {
    console.log(`\n[${r.scenario}/${r.mode}] ${r.ok ? 'PASS' : 'FAIL'} · ${r.q}`);
    console.log(
      `  finish=${r.finishReason || '-'} · tools=${r.toolCalls} · attempts=${r.attempts}` +
      `${r.error ? ` · error=${r.error}` : ''} · answer: ${r.answer.replace(/\s+/g, ' ').slice(0, 700)}`
    );
  }

  const score = (scenario, mode) => {
    const modeRows = rows.filter((r) => r.scenario === scenario && r.mode === mode);
    const critical = modeRows.filter((r) => SCENARIOS[scenario].questions.find((item) => item.q === r.q).priority === 'critical');
    return {
      passed: modeRows.filter((r) => r.ok).length,
      count: modeRows.length,
      criticalPassed: critical.filter((r) => r.ok).length,
      criticalCount: critical.length,
    };
  };
  for (const scenarioId of scenarioIds) {
    const count = SCENARIOS[scenarioId].questions.length;
    const format = (mode) => {
      const result = score(scenarioId, mode);
      return `${result.passed}/${count} critical=${result.criticalPassed}/${result.criticalCount}`;
    };
    console.log(`QUALITY ${scenarioId}: ${options.modes.map((mode) => `${mode}=${format(mode)}`).join(' ')}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
})().catch((error) => {
  console.error('FAIL quality:', error.stack || error);
  process.exitCode = 1;
});
