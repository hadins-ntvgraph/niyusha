'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent } = require('../bin/ai');
const { VirtualFS } = require('../bin/vfs');
const { archiveFile } = require('../bin/compaction');

const SUMMARY =
  'Tujuan: perbaiki parser JSON. Keputusan: gunakan parser JSON. File: src/parser.js. Error: test gagal. Test: verifikasi. Langkah berikutnya: lanjutkan.';

const SUMMARIES = {
  coding: SUMMARY,
  bigfile:
    'Tujuan: perbaiki bug target() di big.js. Keputusan: edit presisi big.js. File: big.js. Error: target(5) salah. Test: node test.js. Langkah berikutnya: ubah return menjadi x + 1.',
  decision:
    'Tujuan: siapkan frontend. Keputusan: beralih dari React ke Vue. File: src/app.js. Error: build React lama. Test: verifikasi migrasi. Langkah berikutnya: migrasi komponen.',
};

function repeat(text, n) {
  return (text + ' ').repeat(n);
}

function codingHistory(turns = 12) {
  const out = [
    { role: 'user', content: 'Tujuan: perbaiki parser JSON dan pertahankan kontrak API.' },
    { role: 'assistant', content: 'Keputusan: gunakan parser JSON bawaan, bukan regex.' },
  ];
  for (let i = 0; i < turns; i++) {
    out.push({ role: 'user', content: `Langkah ${i}: File: src/parser.js. Error: test gagal pada input ${i}.` });
    out.push({ role: 'assistant', content: `Saya periksa parser.js bagian ${i}. ` + repeat('detail implementasi', 80) });
    out.push({ role: 'tool', tool_call_id: `t${i}`, content: repeat('output tool panjang', 120) });
    out.push({ role: 'assistant', content: `Test: verifikasi ${i} lulus. Langkah berikutnya: lanjutkan.` });
  }
  return out;
}

function bigfileHistory() {
  const out = [
    { role: 'user', content: 'Tujuan: perbaiki bug target() di big.js tanpa membaca ulang seluruh file.' },
    { role: 'assistant', content: 'Keputusan: baca bagian akhir big.js saja lalu edit presisi.' },
    { role: 'tool', tool_call_id: 'b1', content: 'File: big.js\n' + repeat('function f(x) { return x; }', 900) },
    { role: 'user', content: 'Error: target(5) menghasilkan 4, seharusnya 6. Test: node test.js.' },
    { role: 'assistant', content: 'Langkah berikutnya: ubah return x - 1 menjadi x + 1 di big.js.' },
    { role: 'tool', tool_call_id: 'b2', content: repeat('output test gagal', 200) },
  ];
  for (let i = 0; i < 3; i++) {
    out.push({ role: 'user', content: `Langkah ${i}: File: big.js. Test: verifikasi bagian target.` });
    out.push({ role: 'assistant', content: `Saya periksa big.js bagian ${i}. ` + repeat('detail kode', 60) });
    out.push({ role: 'tool', tool_call_id: `b${i + 3}`, content: repeat('output grep big.js', 90) });
  }
  return out;
}

function decisionHistory() {
  const out = [
    { role: 'user', content: 'Tujuan: siapkan frontend proyek.' },
    { role: 'assistant', content: 'Keputusan: gunakan React untuk frontend.' },
  ];
  for (let i = 0; i < 8; i++) {
    out.push({ role: 'user', content: `Catatan ${i}: File: src/app.js. Status: React masih dipakai.` });
    out.push({ role: 'assistant', content: repeat('detail komponen React', 90) });
    out.push({ role: 'tool', tool_call_id: `d${i}`, content: repeat('output build React', 120) });
  }
  out.push({ role: 'user', content: 'Keputusan baru: beralih dari React ke Vue. React sudah digantikan.' });
  out.push({ role: 'assistant', content: 'Keputusan: gunakan Vue untuk frontend. Langkah berikutnya: migrasi komponen.' });
  return out;
}

const SCENARIOS = {
  coding: codingHistory,
  bigfile: bigfileHistory,
  decision: decisionHistory,
};

function parseArgs(argv) {
  const out = { budget: 4000, turns: 12, scenario: null, mode: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--budget') out.budget = Number(argv[++i]);
    else if (a === '--turns') out.turns = Number(argv[++i]);
    else if (a === '--scenario') out.scenario = argv[++i];
    else if (a === '--mode') out.mode = argv[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

function sentChars(agent) {
  return agent._countSendChars([{ role: 'system', content: agent.systemPrompt() }, ...agent.history]);
}

async function measure(scenario, mode, opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `niyusha-context-${scenario}-${mode}-`));
  const archiveDir = path.join(root, 'archive');
  const engineDir = path.join(root, 'context');
  const agent = new Agent({
    vfs: new VirtualFS('bench-context', root),
    cwd: root,
    config: {
      contextBudget: opts.budget,
      apiKey: 'x',
      model: 'm',
      provider: 'openrouter',
      compactionMode: mode,
      compactionAuto: true,
      compactionArchiveDir: archiveDir,
      contextEngineDir: engineDir,
    },
  });
  agent.callModel = async () => ({ role: 'assistant', content: SUMMARIES[scenario] || SUMMARY });
  agent.history = SCENARIOS[scenario](opts.turns);
  const beforeUsed = agent.contextTokens().used;
  const beforeSent = sentChars(agent);
  let error = null;
  try {
    await agent.prepareContext();
  } catch (e) {
    error = e.message || String(e);
  }
  const afterUsed = agent.contextTokens().used;
  const afterSent = sentChars(agent);
  const stats = agent.compactionStats();
  const row = {
    scenario,
    mode,
    beforeUsed,
    afterUsed,
    savedUsed: beforeUsed - afterUsed,
    savedPct: beforeUsed ? Number((((beforeUsed - afterUsed) / beforeUsed) * 100).toFixed(1)) : 0,
    beforeSent,
    afterSent,
    savedSentPct: beforeSent ? Number((((beforeSent - afterSent) / beforeSent) * 100).toFixed(1)) : 0,
    history: agent.history.length,
    compactions: agent.compactions,
    trigger: stats.lastTrigger,
    validation: stats.validation ? stats.validation.ok : null,
    atoms: stats.urich ? stats.urich.atoms : null,
    archiveBytes: fileSize(archiveFile({ config: agent.config, workspace: root, sessionId: agent.compactionSessionId })),
    sufficiency: mode === 'urich' ? agent._getContextEngine().retrieve('tujuan', { limit: 8 }).sufficient : null,
    error,
  };
  fs.rmSync(root, { recursive: true, force: true });
  return row;
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const scenarios = opts.scenario ? [opts.scenario] : Object.keys(SCENARIOS);
  const modes = opts.mode ? [opts.mode] : ['off', 'legacy', 'safe', 'shadow', 'urich'];
  const rows = [];
  for (const scenario of scenarios) {
    for (const mode of modes) rows.push(await measure(scenario, mode, opts));
  }
  if (opts.json) {
    console.log(JSON.stringify({ budget: opts.budget, turns: opts.turns, rows }, null, 2));
    return;
  }
  const head = ['scenario', 'mode', 'before', 'after', 'save%', 'sentBefore', 'sentAfter', 'hist', 'comp', 'valid', 'atoms', 'archiveB', 'suff'];
  console.log(head.map((h) => h.padEnd(10)).join(' '));
  for (const r of rows) {
    console.log(
      [
        r.scenario,
        r.mode,
        r.beforeUsed,
        r.afterUsed,
        `${r.savedPct}%`,
        r.beforeSent,
        r.afterSent,
        r.history,
        r.compactions,
        r.validation == null ? '-' : String(r.validation),
        r.atoms == null ? '-' : r.atoms,
        r.archiveBytes,
        r.sufficiency == null ? '-' : String(r.sufficiency),
      ]
        .map((v) => String(v).padEnd(10))
        .join(' ')
    );
  }
})().catch((e) => {
  console.error(e.stack || e);
  process.exitCode = 1;
});
