'use strict';

// Deterministic, network-free recall and context-size benchmark.
// Legacy compaction uses a fixture-authored summary response; it does not
// measure an LLM's ability to produce a Legacy summary.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent } = require('../bin/ai');
const { VirtualFS } = require('../bin/vfs');

const repeat = (text, count) => Array(count).fill(text).join(' ');

const SCENARIOS = {
  auth: {
    label: 'Auth refresh continuity',
    history: [
      { role: 'user', content: 'Tujuan proyek: implementasikan refresh token aman. Jangan ubah kontrak publik login().' },
      { role: 'assistant', content: 'Keputusan: access token berlaku 15 menit dan refresh token memakai rotasi.' },
      { role: 'user', content: 'File utama src/auth/session.js. File refresh src/auth/refresh.js. Cookie refresh bernama rt_v2 dan wajib httpOnly.' },
      { role: 'assistant', content: 'Dulu frontend memakai React. Sekarang frontend beralih ke Vue.' },
      { role: 'user', content: 'Error: refresh loop terjadi karena token lama masih di cache. Hapus cache token sebelum rotasi.' },
      { role: 'assistant', content: 'Test: npm run test:auth lulus setelah perbaikan. Langkah berikutnya: tambahkan test expiry token.' },
      { role: 'user', content: 'Jangan pernah menyimpan token di localStorage atau mencatat isi refresh token ke log.' },
    ],
    legacySummary: [
      'Tujuan aktif: implementasikan refresh token aman tanpa mengubah kontrak publik login().',
      'Keputusan: access token 15 menit dan refresh token rotasi.',
      'Cookie refresh rt_v2 harus httpOnly; file terkait src/auth/session.js dan src/auth/refresh.js.',
      'Frontend sekarang Vue; React adalah framework sebelumnya.',
      'Error refresh loop disebabkan token lama di cache; cache harus dihapus sebelum rotasi.',
      'Test npm run test:auth lulus; berikutnya tambahkan test expiry token.',
      'Jangan simpan token di localStorage atau log isi refresh token.',
    ].join('\n'),
    facts: [
      { id: 'cookie', critical: true, query: 'refresh cookie rt_v2 httpOnly', groups: [['rt_v2'], ['httponly']] },
      {
        id: 'framework',
        critical: true,
        query: 'framework frontend sekarang dan sebelumnya',
        groups: [['vue'], ['react']],
        checks: [
          (text) => /(?:sekarang|saat ini|aktif|current|uses|replaced_by|beralih ke).{0,80}vue|vue.{0,80}(?:sekarang|saat ini|aktif|current|uses|replaced_by)/i.test(text),
          (text) => /(?:dulu|sebelumnya|historical|historis|superseded|replaced_by).{0,80}react|react.{0,80}(?:dulu|sebelumnya|historical|historis|superseded)/i.test(text),
        ],
      },
      { id: 'failure', critical: true, query: 'penyebab refresh loop dan perbaikan cache', groups: [['refresh loop'], ['token lama', 'cache']] },
      { id: 'negative-constraints', critical: true, query: 'larangan penyimpanan dan logging token', groups: [['localstorage'], ['jangan', 'tidak', 'never'], ['log', 'catat']] },
      { id: 'next-step', critical: false, query: 'langkah berikutnya auth', groups: [['test'], ['expiry', 'kedaluwarsa']] },
      { id: 'token-policy', critical: false, query: 'durasi access token dan strategi refresh', groups: [['15 menit', '15-minute'], ['rotasi']] },
    ],
  },
  api: {
    label: 'API migration and pagination',
    history: [
      { role: 'user', content: 'Tujuan: migrasikan pencarian ke API baru tanpa memutus klien lama.' },
      { role: 'assistant', content: 'Keputusan aktif: GET /v2/search mengembalikan items, total, nextCursor.' },
      { role: 'user', content: 'GET /v1/query deprecated tetapi harus tetap bekerja selama migrasi. Jangan hapus sebelum semua klien berpindah.' },
      { role: 'assistant', content: 'File inti src/api/search.ts. Adapter src/api/search-compat.ts mengubah results/count lama menjadi items/total.' },
      { role: 'user', content: 'Bug pagination: cursor dari array index membuat item duplikat setelah insert. Gunakan stable immutable item ID.' },
      { role: 'assistant', content: 'Test tests/api/search-compat.test.ts lulus; test pagination cursor masih gagal.' },
      { role: 'user', content: 'Langkah berikutnya: perbaiki cursor dan tambahkan test insert di antara dua page.' },
      { role: 'assistant', content: 'Keputusan historis: rencana awal menghapus /v1/query, tetapi sudah diganti menjadi adapter sementara.' },
      { role: 'user', content: 'Response API baru tidak boleh menggunakan key results/count.' },
    ],
    legacySummary: [
      'Tujuan: migrasikan pencarian tanpa memutus klien lama.',
      'Endpoint aktif GET /v2/search mengembalikan items, total, nextCursor. GET /v1/query deprecated tetapi tetap dipertahankan selama migrasi.',
      'src/api/search.ts dan src/api/search-compat.ts; adapter mengubah results/count menjadi items/total.',
      'Bug pagination: cursor berbasis array index menyebabkan duplikat setelah insert; gunakan stable immutable item ID.',
      'tests/api/search-compat.test.ts lulus, tetapi test pagination cursor gagal. Berikutnya perbaiki cursor dan test insert di antara dua page.',
      'Keputusan menghapus /v1/query sudah superseded; jangan gunakan results/count di response baru.',
    ].join('\n'),
    facts: [
      { id: 'active-endpoint', critical: true, query: 'endpoint pencarian aktif v2', groups: [['/v2/search'], ['items'], ['nextcursor']] },
      { id: 'legacy-endpoint', critical: true, query: 'status endpoint lama selama migrasi klien', groups: [['/v1/query'], ['deprecated', 'lama'], ['tetap', 'sementara', 'dipertahankan']] },
      { id: 'adapter-mapping', critical: false, query: 'adapter kompatibilitas mapping response', groups: [['src/api/search-compat.ts'], ['results'], ['items']] },
      { id: 'pagination-cause', critical: true, query: 'penyebab pagination duplicate after insert', groups: [['index'], ['duplikat', 'duplicate'], ['insert']] },
      { id: 'pagination-invariant', critical: true, query: 'stable cursor identity requirement', groups: [['stable', 'immutable'], ['item id', 'item-id', 'identifier']] },
      { id: 'failing-test', critical: true, query: 'test pagination yang masih gagal', groups: [['tests/api/search-compat.test.ts'], ['pagination'], ['gagal', 'fail']] },
      { id: 'next-step', critical: false, query: 'langkah berikutnya pagination', groups: [['cursor'], ['test'], ['insert']] },
      { id: 'superseded-plan', critical: false, query: 'rencana hapus endpoint lama status keputusan terbaru', groups: [['/v1/query'], ['superseded', 'historis', 'diganti'], ['adapter', 'dipertahankan']] },
    ],
  },
};

function parseArgs(argv) {
  const options = { scenario: 'all', json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scenario') {
      options.scenario = String(argv[++i] || '');
      if (!['all', ...Object.keys(SCENARIOS)].includes(options.scenario)) {
        throw new Error(`Unknown scenario: ${options.scenario}`);
      }
    } else if (argv[i] === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown option: ${argv[i]}`);
    }
  }
  return options;
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9/._-]+/g, ' ').trim();
}

function scoreFact(text, fact) {
  const normalized = normalize(text);
  return fact.groups.every((group) => group.some((variant) => normalized.includes(normalize(variant)))) &&
    (fact.checks || []).every((check) => check(text));
}

function appendNoise(history, count) {
  for (let i = 0; i < count; i++) {
    history.push(
      { role: 'user', content: `Progress ${i}: lanjutkan implementasi dan pertahankan kontrak yang telah disepakati.` },
      { role: 'assistant', content: `Pemeriksaan rutin tahap ${i}. ${repeat(`detail teknis non-kritis ${i}.`, 115)}` },
      { role: 'tool', tool_call_id: `noise-${i}`, content: repeat(`output diagnostik non-kritis ${i}`, 100) }
    );
  }
  history.push(
    { role: 'user', content: 'Lanjutkan pekerjaan dari checkpoint sebelumnya.' },
    { role: 'assistant', content: 'Siap, saya akan meneruskan pemeriksaan.' }
  );
  return history;
}

function sentChars(agent, retrievalContext = '') {
  return agent._countSendChars([
    { role: 'system', content: agent.systemPrompt() + retrievalContext },
    ...agent.history,
  ]);
}

async function evaluate(scenarioId, mode, root) {
  const scenario = SCENARIOS[scenarioId];
  const workspace = path.join(root, scenarioId, mode);
  const agent = new Agent({
    vfs: new VirtualFS(`offline-${scenarioId}-${mode}`, workspace),
    cwd: workspace,
    config: {
      contextBudget: 4000,
      compactionMode: mode === 'full' ? 'off' : mode,
      compactionAuto: true,
      contextEngineMemoryChars: 2200,
      contextEngineDir: path.join(workspace, 'context'),
      compactionArchiveDir: path.join(workspace, 'archive'),
    },
  });
  agent.tools = [];
  agent.history = appendNoise(scenario.history.map((message) => ({ ...message })), 20);
  const before = agent.contextTokens();
  const beforeChars = sentChars(agent);
  if (mode === 'legacy') {
    agent.callModel = async () => ({ role: 'assistant', content: scenario.legacySummary });
  }

  let error = null;
  try {
    await agent.compactIfNeeded(true, { trigger: 'manual' });
  } catch (caught) {
    error = caught.message || String(caught);
  }

  const requestChars = [];
  const scoredFacts = [];
  if (!error) {
    for (const fact of scenario.facts) {
      const retrieval = mode === 'urich' ? agent._urichRetrievalContext(fact.query) : '';
      requestChars.push(sentChars(agent, retrieval));
      const evidence = `${agent.summary || ''}\n${JSON.stringify(agent.history)}\n${retrieval}`;
      const missingGroups = fact.groups
        .map((group, index) => group.some((variant) => normalize(evidence).includes(normalize(variant))) ? null : index + 1)
        .filter(Boolean);
      const checksPassed = (fact.checks || []).every((check) => check(evidence));
      scoredFacts.push({
        id: fact.id,
        critical: fact.critical,
        passed: missingGroups.length === 0 && checksPassed && scoreFact(evidence, fact),
        missingGroups,
        checksPassed,
        archiveRetrieved: mode === 'urich' && /fallback arsip=ya/i.test(retrieval),
        retrievalExcerpt: missingGroups.length || !checksPassed ? retrieval.replace(/\s+/g, ' ').slice(0, 500) : undefined,
      });
    }
  } else {
    for (const fact of scenario.facts) scoredFacts.push({ id: fact.id, critical: fact.critical, passed: false, archiveRetrieved: false });
  }

  const critical = scoredFacts.filter((fact) => fact.critical);
  const retrievalStats = agent.compactionStats().urichRetrieval;
  const afterChars = requestChars.length ? Math.round(requestChars.reduce((sum, chars) => sum + chars, 0) / requestChars.length) : beforeChars;
  return {
    scenario: scenarioId,
    mode,
    baselineNote: mode === 'legacy' ? 'fixture-authored summary; not an LLM-generated Legacy result' : null,
    beforeChars,
    afterChars,
    beforeEstimatedTokens: Math.ceil(beforeChars / 4),
    afterEstimatedTokens: Math.ceil(afterChars / 4),
    savedPct: beforeChars ? Number(((1 - afterChars / beforeChars) * 100).toFixed(1)) : 0,
    factsPassed: scoredFacts.filter((fact) => fact.passed).length,
    factsTotal: scoredFacts.length,
    criticalPassed: critical.filter((fact) => fact.passed).length,
    criticalTotal: critical.length,
    archiveRetrievals: scoredFacts.filter((fact) => fact.archiveRetrieved).length,
    facts: scoredFacts,
    validation: agent.compactionStats().validation ? agent.compactionStats().validation.ok : null,
    compactionError: error,
    retrieval: retrievalStats || null,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-context-offline-'));
  try {
    const scenarioIds = options.scenario === 'all' ? Object.keys(SCENARIOS) : [options.scenario];
    const rows = [];
    for (const scenarioId of scenarioIds) {
      for (const mode of ['full', 'legacy', 'urich']) {
        rows.push(await evaluate(scenarioId, mode, root));
      }
    }
    const failures = [];
    for (const scenarioId of scenarioIds) {
      const modes = rows.filter((row) => row.scenario === scenarioId);
      const full = modes.find((row) => row.mode === 'full');
      const legacy = modes.find((row) => row.mode === 'legacy');
      const urich = modes.find((row) => row.mode === 'urich');
      if (full.factsPassed !== full.factsTotal) failures.push(`${scenarioId}: full-history fixture is not fully scoreable`);
      if (legacy.factsPassed !== legacy.factsTotal) failures.push(`${scenarioId}: authored Legacy reference summary missed facts`);
      if (urich.criticalPassed !== urich.criticalTotal) failures.push(`${scenarioId}: URich missed a critical fact`);
      if (urich.validation !== true) failures.push(`${scenarioId}: URich compaction failed validation`);
    }
    const report = {
      network: false,
      note: 'Offline recall fixtures test deterministic retention/retrieval, not semantic quality of a live model.',
      rows,
      passed: failures.length === 0,
      failures,
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (failures.length) process.exitCode = 1;
      return;
    }
    console.log('Offline context recall (synthetic fixtures; no model/network calls)');
    console.log('Legacy summary is fixture-authored, not generated by the Legacy LLM path.\n');
    console.log('scenario  mode    facts  critical  est.tokens saved% archive  validation');
    for (const row of rows) {
      console.log(
        `${row.scenario.padEnd(9)} ${row.mode.padEnd(7)} ` +
        `${String(row.factsPassed).padStart(2)}/${String(row.factsTotal).padEnd(2)}   ` +
        `${String(row.criticalPassed).padStart(2)}/${String(row.criticalTotal).padEnd(2)}      ` +
        `${String(row.afterEstimatedTokens).padStart(5)}      ${String(`${row.savedPct}%`).padStart(5)} ` +
        `${String(row.archiveRetrievals).padStart(3)}       ${row.validation == null ? '-' : row.validation ? 'PASS' : 'FAIL'}`
      );
      const misses = row.facts.filter((fact) => !fact.passed).map((fact) => fact.id);
      if (misses.length) {
        console.log(`  missed: ${misses.join(', ')}`);
        for (const fact of row.facts.filter((item) => !item.passed)) {
          if (fact.retrievalExcerpt) console.log(`  ${fact.id} missing groups ${fact.missingGroups}: ${fact.retrievalExcerpt}`);
        }
      }
      if (row.compactionError) console.log(`  compaction error: ${row.compactionError}`);
    }
    console.log('\nThis is a deterministic retention benchmark, not evidence that URich is semantically superior in live model use.');
    if (failures.length) {
      console.error(`\nFAIL offline quality gate: ${failures.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log('PASS offline quality gate: all critical facts are retained/retrievable and URich validates.');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
