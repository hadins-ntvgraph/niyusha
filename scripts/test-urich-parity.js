'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ideRoot = path.join(__dirname, '..', '..', 'ide-engine', 'tui');
if (!fs.existsSync(path.join(ideRoot, 'bin', 'ai.js'))) {
  process.stdout.write('SKIP URich parity: IDE source is not present in this checkout\n');
  process.exit(0);
}

const bundles = [
  {
    name: 'TUI',
    ...require('../bin/ai'),
    ...require('../bin/context-engine'),
    VirtualFS: require('../bin/vfs').VirtualFS,
  },
  {
    name: 'IDE',
    ...require(path.join(ideRoot, 'bin', 'ai')),
    ...require(path.join(ideRoot, 'bin', 'context-engine')),
    VirtualFS: require(path.join(ideRoot, 'bin', 'vfs')).VirtualFS,
  },
];

const fixture = [
  { role: 'user', content: 'Tujuan: stabilkan parser dan pertahankan kontrak API v1.' },
  { role: 'assistant', content: 'Keputusan [api]: gunakan adapter kompatibel v2.' },
  { role: 'user', content: 'File: src/parser.js. Error: input kosong memicu kegagalan.' },
  { role: 'assistant', content: 'Test: parser mempertahankan field unknown tanpa mengubah kontrak.' },
  { role: 'tool', tool_call_id: 'tool-1', content: 'hasil tool '.repeat(80) },
  { role: 'user', content: 'Langkah berikutnya: validasi kompatibilitas client lama.' },
];

const progressFixture = [
  { role: 'user', content: 'Tujuan: perbaiki parser tanpa mengubah kontrak API.' },
];
for (let i = 0; i < 70; i++) {
  progressFixture.push(
    {
      role: 'user',
      content: i % 3 === 0
        ? `Progress ${i}: lanjutkan implementasi parser.`
        : i % 3 === 1
          ? `Update ${i}: parser cleanup masih berjalan, keep public API stable.`
          : `Pemeriksaan rutin tahap ${i}: lanjutkan pekerjaan.`,
    },
    { role: 'assistant', content: `Status tahap ${i}: pemeriksaan rutin tanpa perubahan kontrak.` }
  );
  if (i === 37) {
    progressFixture.push({
      role: 'user',
      content: 'Critical: regression test tests/parser-empty.test.js gagal pada input null; pertahankan error code E_PARSE.',
    });
  }
}

function atomProjection(atoms) {
  return atoms.map((atom) => ({
    type: atom.type,
    content: atom.content,
    invariant: atom.invariant,
    temporal_status: atom.temporal_status,
    superseded_by: atom.superseded_by || null,
  })).sort((a, b) => `${a.type}|${a.content}|${a.temporal_status}`.localeCompare(`${b.type}|${b.content}|${b.temporal_status}`));
}

function retrievalProjection(result) {
  return {
    context: canonicalSummary(result.context),
    fallback: result.fallback,
    missing: result.missing,
    sufficient: result.sufficient,
    atoms: atomProjection(result.atoms),
  };
}

function canonicalSummary(summary) {
  return String(summary || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort().join('\n');
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-urich-parity-'));
  try {
    const atomResults = bundles.map((bundle) => atomProjection(bundle.atomizeHistory(fixture)));
    assert.deepStrictEqual(atomResults[1], atomResults[0], 'TUI and IDE atomization should match');

    const configFor = (bundle) => ({
      contextEngineDir: path.join(root, bundle.name, 'context'),
      compactionArchiveDir: path.join(root, bundle.name, 'archive'),
      contextEngineMemoryChars: 1400,
      compactionMode: 'urich',
      compactionAuto: true,
      contextBudget: 4000,
    });
    const engines = bundles.map((bundle) => ({
      bundle,
      config: configFor(bundle),
      engine: new bundle.ContextEngine({
        config: configFor(bundle),
        workspace: root,
        sessionId: 'parity-session',
      }),
    }));

    const compressed = engines.map(({ engine }) => engine.compress({
      history: fixture,
      summary: 'Ringkasan sebelumnya: task parser.',
      state: {
        goal: 'Tujuan: stabilkan parser.',
        goalLedger: [{ text: 'Tujuan: stabilkan parser.', status: 'active' }],
        decisions: [{ scope: 'api', text: 'gunakan adapter kompatibel v2', status: 'active' }],
        failures: ['input kosong memicu kegagalan'],
      },
      maxChars: 1400,
    }));
    assert.strictEqual(canonicalSummary(compressed[1].summary), canonicalSummary(compressed[0].summary), 'TUI and IDE summary facts should match');
    assert.deepStrictEqual(compressed[1].taskState, compressed[0].taskState, 'TUI and IDE task state should match');
    assert.deepStrictEqual(atomProjection(compressed[1].atoms), atomProjection(compressed[0].atoms), 'TUI and IDE selected memory should match');
    assert.deepStrictEqual(compressed[1].stats, compressed[0].stats, 'TUI and IDE compression diagnostics should match');

    const progressCompressed = engines.map(({ engine }) => engine.compress({
      history: progressFixture,
      maxChars: 1400,
    }));
    assert.strictEqual(
      canonicalSummary(progressCompressed[1].summary),
      canonicalSummary(progressCompressed[0].summary),
      'TUI and IDE varied-progress summaries should match'
    );
    for (const result of progressCompressed) {
      assert.ok(result.summary.length <= 1400, 'varied-progress summary should fit memory budget');
      assert.ok(result.summary.includes('E_PARSE'), 'critical fact amid progress should survive');
      assert.ok((result.summary.match(/Status tahap \d+:/g) || []).length <= 1, 'repeated numbered status should collapse');
    }

    for (const { engine } of engines) {
      engine.checkpoint({ history: fixture, summary: compressed[0].summary, mode: 'urich' });
    }
    const retrieval = engines.map(({ engine }) => retrievalProjection(engine.retrieve('parser API input kosong', { limit: 8 })));
    assert.deepStrictEqual(retrieval[1], retrieval[0], 'TUI and IDE archive retrieval should match');

    const agents = bundles.map((bundle) => {
      const config = configFor(bundle);
      const agent = new bundle.Agent({
        vfs: new bundle.VirtualFS(`parity-${bundle.name}`, root),
        cwd: root,
        config,
      });
      agent._recordGoal('Tujuan: stabilkan parser dan pertahankan kontrak API v1');
      agent._recordDecisionUpdates('Keputusan [api]: gunakan adapter kompatibel v2.');
      agent.history = fixture.concat(fixture);
      return agent;
    });
    const summaries = [];
    for (const agent of agents) {
      await agent.compactIfNeeded(true, { trigger: 'manual' });
      summaries.push(agent.summary);
    }
    assert.strictEqual(canonicalSummary(summaries[1]), canonicalSummary(summaries[0]), 'TUI and IDE agent compaction facts should match');
    assert.deepStrictEqual(
      agents[1].history.map(({ role, content }) => ({ role, content })),
      agents[0].history.map(({ role, content }) => ({ role, content })),
      'TUI and IDE retained history should match'
    );
    process.stdout.write('PASS URich parity: atomization, compression, varied-progress guard, retrieval, and agent compaction match\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
