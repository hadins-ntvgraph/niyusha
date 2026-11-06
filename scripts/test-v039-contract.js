'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent } = require('../bin/ai');
const { VirtualFS } = require('../bin/vfs');
const { ContextEngine, atomizeHistory } = require('../bin/context-engine');

function tempRoot(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `niyusha-v039-${name}-`));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function engineFor(root, name = 'session') {
  return new ContextEngine({
    config: { contextEngineDir: path.join(root, 'context'), contextEngineMemoryChars: 1400 },
    workspace: root,
    sessionId: name,
  });
}

async function testAiLayerAndFallback() {
  const first = tempRoot('ai-primary');
  try {
    const agent = new Agent({
      vfs: new VirtualFS('v039-ai-primary', first.root),
      cwd: first.root,
      config: {
        contextBudget: 4000,
        contextEngineDir: path.join(first.root, 'context'),
        compactionArchiveDir: path.join(first.root, 'archive'),
        contextEngineMemoryChars: 1400,
        compactionMode: 'urich',
        compactionAuto: true,
        apiKey: 'test',
        model: 'test-model',
        provider: 'openrouter',
      },
    });
    agent.callModel = async () => ({
      role: 'assistant',
      content: JSON.stringify({
        atoms: [{
          type: 'FACT',
          content: 'AI semantic claim: parser preserves unknown keys.',
          semantic_key: 'parser-unknown-keys',
          confidence: 0.91,
          invariant: true,
        }],
      }),
    });
    agent.history = [
      { role: 'user', content: 'Tujuan: uji pemisahan semantic dan structural layer.' },
      { role: 'assistant', content: 'Detail implementasi.' },
    ];
    await agent.compactIfNeeded(true, { trigger: 'manual' });
    assert.strictEqual(agent.lastUrich.ai, true, 'AI atomization harus menjadi jalur utama saat berhasil');
    assert.ok(agent._getContextEngine().getAtoms().some((atom) => atom.content.includes('AI semantic claim')),
      'atom hasil AI harus masuk ke ContextEngine');
  } finally {
    first.cleanup();
  }

  const fallback = tempRoot('ai-fallback');
  try {
    const agent = new Agent({
      vfs: new VirtualFS('v039-ai-fallback', fallback.root),
      cwd: fallback.root,
      config: {
        contextBudget: 4000,
        contextEngineDir: path.join(fallback.root, 'context'),
        compactionArchiveDir: path.join(fallback.root, 'archive'),
        contextEngineMemoryChars: 1400,
        compactionMode: 'urich',
        compactionAuto: true,
        apiKey: 'test',
        model: 'test-model',
        provider: 'openrouter',
      },
    });
    agent.callModel = async () => ({ role: 'assistant', content: 'invalid atom JSON' });
    agent.history = [{ role: 'user', content: 'Tujuan: pertahankan parser.' }];
    await agent.compactIfNeeded(true, { trigger: 'manual' });
    assert.strictEqual(agent.lastUrich.ai, false, 'fallback structural harus aktif saat AI gagal');
    assert.strictEqual(Boolean(agent.lastUrich.aiError), true, 'kegagalan AI harus tercatat');
    assert.ok(agent.summary.length > 0, 'fallback harus tetap menghasilkan memory');
  } finally {
    fallback.cleanup();
  }
}

function testStructuralContracts() {
  const t = tempRoot('structural');
  try {
    const engine = engineFor(t.root);
    const low = engine.ingestAtoms([{
      type: 'FACT', content: 'Low confidence claim', semantic_key: 'low-claim', confidence: 0.2,
    }], { maxChars: 2000 });
    assert.ok(low.atoms.some((atom) => atom.low_confidence && atom.needs_review),
      'confidence rendah harus tetap tersimpan tetapi perlu review');
    assert.ok(engine.load().review_queue.length > 0, 'confidence rendah harus masuk review queue');

    const exact = engine.ingestAtoms([{
      type: 'FACT', content: 'Low confidence claim', semantic_key: 'low-claim', confidence: 0.2,
    }], { maxChars: 2000 });
    assert.ok(exact.duplicates > 0, 'exact semantic duplicate harus digabung');

    const conflict = engine.ingestAtoms([
      { type: 'DECISION', content: 'Gunakan React untuk frontend.', semantic_key: 'frontend-choice', confidence: 0.9 },
      { type: 'DECISION', content: 'Gunakan Vue untuk frontend.', semantic_key: 'frontend-choice', confidence: 0.9 },
      { type: 'DECISION', content: 'Gunakan PostgreSQL untuk database.', semantic_key: 'database-choice', confidence: 0.9 },
    ], { maxChars: 4000 });
    assert.ok(conflict.atoms.filter((atom) => atom.potential_conflict).length >= 2,
      'conflict belum terselesaikan harus ditandai');
    assert.ok(conflict.atoms.filter((atom) => /React|Vue/.test(atom.content)).length === 2,
      'pernyataan konflik harus tetap dipertahankan');
    assert.ok(conflict.atoms.some((atom) => atom.content.includes('PostgreSQL')),
      'semantic intent berbeda harus tetap dipertahankan');

    const first = atomizeHistory([{ role: 'user', content: 'Fakta chronology awal.' }]);
    const next = atomizeHistory([{ role: 'user', content: 'Fakta chronology berikutnya.' }], { previousAtoms: first });
    const maxFirst = Math.max(...first.map((atom) => Number(atom.sequence)));
    const minNext = Math.min(...next.filter((atom) => !first.some((old) => old.atom_id === atom.atom_id)).map((atom) => Number(atom.sequence)));
    assert.ok(Number.isFinite(minNext) && minNext > maxFirst, 'sequence harus monoton setelah ingest berulang');

    const multilingual = engine.compress({
      history: [
        { role: 'user', content: 'Tujuan: pertahankan API publik.' },
        { role: 'assistant', content: 'La décision est de garder le contrat API. 日本語の事実を保持する。' },
      ],
      maxChars: 1400,
    });
    const raw = multilingual.atoms.map((atom) => atom.content).join('\n');
    assert.ok(raw.includes('La décision') && raw.includes('日本語'),
      'content bahasa asli harus dipertahankan sampai storage atom');

    const huge = engine.ingestAtoms([{
      type: 'INSTRUCTION',
      content: `INVARIANT-START ${'isi penting '.repeat(200)}`,
      semantic_key: 'huge-invariant',
      confidence: 1,
      invariant: true,
    }], { maxChars: 200 });
    assert.ok(huge.summary.length <= 200, 'reconstruct harus mematuhi maxChars');
    assert.ok(huge.summary.includes('INVARIANT-START'), 'invariant harus tetap terwakili');
    assert.ok(huge.summary.includes('dipotong'), 'invariant overflow harus ditandai truncation');
  } finally {
    t.cleanup();
  }
}

(async () => {
  await testAiLayerAndFallback();
  testStructuralContracts();
  console.log('PASS v0.3.9 contract: AI layer, fallback, confidence, conflict, dedup, chronology, multilingual, maxChars');
})().catch((error) => {
  console.error(`FAIL v0.3.9 contract: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
