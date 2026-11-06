'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ContextEngine,
  atomizeHistory,
  buildRelationGraph,
  entityKeys,
  selectAtoms,
} = require('../bin/context-engine');

function makeConfig(root, name) {
  return {
    contextBudget: 4000,
    contextEngineDir: path.join(root, `context-${name}`),
    compactionArchiveDir: path.join(root, `archive-${name}`),
    contextEngineMemoryChars: 1400,
    compactionMode: 'urich',
  };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-urich-evidence-'));
  try {
    const config = makeConfig(root, 'retrieval');
    const workspace = root;

    const engine = new ContextEngine({ config, workspace, sessionId: 'independent-retrieval' });
    engine.compress({
      history: [
        { role: 'user', content: 'Tujuan: stabilkan migrasi database tanpa downtime.' },
        { role: 'assistant', content: 'Keputusan: migrasi memakai PostgreSQL 16 dengan logical replication.' },
        { role: 'user', content: 'Autentikasi beralih ke OAuth device flow, password grant dihapus.' },
        { role: 'assistant', content: 'Error: migrasi gagal saat kolom created_at bernilai null.' },
        { role: 'user', content: 'Test: setelah perbaikan, 42 test lulus.' },
      ],
      maxChars: 1400,
    });

    const database = engine.retrieve('postgresql versi berapa yang dipakai', { limit: 4 });
    assert.ok(/postgresql/i.test(database.context), 'independent query: fakta database harus ditemukan');
    assert.strictEqual(database.sufficient, true, 'independent query: database harus sufficient');

    const auth = engine.retrieve('metode login setelah password grant dihapus', { limit: 4 });
    assert.ok(/password grant/i.test(auth.context), 'independent query: fakta auth harus ditemukan');

    const failure = engine.retrieve('penyebab migrasi gagal', { limit: 4 });
    assert.ok(/null|created_at/i.test(failure.context), 'independent query: error migrasi harus ditemukan');
    assert.strictEqual(failure.sufficient, true, 'independent query: error harus sufficient');

    const tests = engine.retrieve('berapa test yang lulus setelah perbaikan', { limit: 4 });
    assert.ok(/42/.test(tests.context), 'independent query: hasil test harus ditemukan');
    assert.strictEqual(tests.sufficient, true, 'independent query: test harus sufficient');

    const unanswerable = engine.retrieve('berapa biaya lisensi kubernetes di region singapura', { limit: 4 });
    assert.strictEqual(unanswerable.atoms.length, 0, 'unanswerable query tidak boleh memaksakan atom');
    assert.strictEqual(unanswerable.sufficient, false, 'unanswerable query harus sufficient=false');

    const priorityAtoms = [
      { atom_id: 'priority_code', type: 'CODE_CONTEXT', content: 'kode prioritas', normalized_text: 'aaa code', effective_importance: 1, centrality: 0, temporal_status: 'ACTIVE', invariant: true },
      { atom_id: 'priority_goal', type: 'GOAL', content: 'goal prioritas', normalized_text: 'zzz goal', effective_importance: 1, centrality: 0, temporal_status: 'ACTIVE', invariant: true },
    ];
    assert.strictEqual(selectAtoms(priorityAtoms, 300)[0].type, 'GOAL', 'ablation: type priority harus memilih GOAL');
    assert.strictEqual(
      selectAtoms(priorityAtoms, 300, { respectTypePriority: false })[0].type,
      'CODE_CONTEXT',
      'ablation: tanpa type priority, tie-break kembali ke urutan teks'
    );

    const invariantAtoms = [
      { atom_id: 'inv', type: 'CODE_CONTEXT', content: 'invariant low rank', normalized_text: 'aaa invariant', effective_importance: 0.1, centrality: 0, temporal_status: 'ACTIVE', invariant: true },
      { atom_id: 'rank', type: 'CODE_CONTEXT', content: 'rank high normal', normalized_text: 'zzz normal', effective_importance: 1, centrality: 0, temporal_status: 'ACTIVE', invariant: false },
    ];
    assert.strictEqual(selectAtoms(invariantAtoms, 300)[0].atom_id, 'inv', 'ablation: invariant harus diprioritaskan');
    assert.strictEqual(
      selectAtoms(invariantAtoms, 300, { respectInvariant: false })[0].atom_id,
      'rank',
      'ablation: tanpa prioritas invariant, rank harus menentukan'
    );

    const relationAtoms = atomizeHistory([
      { role: 'user', content: 'Tujuan: rapikan graph relasi.' },
      { role: 'assistant', content: 'src/parser.js memanggil src/tokenize.js.' },
      { role: 'user', content: 'Compressor bergantung pada tokenizer.' },
      { role: 'assistant', content: 'src/auth.js memakai src/crypto.js.' },
      { role: 'assistant', content: 'src/crypto.js dipakai oleh src/auth.js.' },
      { role: 'assistant', content: 'auth.js memakai src/crypto.js.' },
      { role: 'assistant', content: 'File src/auth.js sudah diperiksa.' },
      { role: 'assistant', content: 'Dulu frontend memakai React. Sekarang frontend beralih ke Vue.' },
      { role: 'user', content: 'React digantikan oleh Vue.' },
      { role: 'user', content: 'React menggantikan Vue.' },
    ], {});
    const relationTypes = new Set(relationAtoms.flatMap((atom) => (atom.relations || []).map((rel) => rel.type)));
    assert.ok(relationTypes.has('CALLS'), 'relation: CALLS harus diekstrak');
    assert.ok(relationTypes.has('DEPENDS_ON'), 'relation: DEPENDS_ON harus diekstrak');
    assert.ok(relationTypes.has('USES'), 'relation: USES harus diekstrak');
    assert.ok(relationTypes.has('REPLACED_BY'), 'relation: REPLACED_BY harus diekstrak');
    assert.ok(
      relationAtoms.some((atom) => (atom.relations || []).some(
        (rel) => rel.type === 'USES' && rel.source === 'src/auth.js' && rel.target === 'src/crypto.js'
      )),
      'relation: pasif "dipakai oleh" harus menghasilkan arah source yang benar'
    );
    assert.ok(
      relationAtoms.some((atom) => (atom.relations || []).some(
        (rel) => rel.type === 'REPLACED_BY' && rel.source === 'vue' && rel.target === 'react'
      )),
      'relation: "menggantikan" harus menghasilkan arah REPLACED_BY yang benar'
    );

    const relationGraph = buildRelationGraph(relationAtoms);
    assert.ok(relationGraph.edges.some((edge) => edge.kind === 'explicit'), 'graph: edge eksplisit harus ada');
    assert.ok(
      relationGraph.edges.some((edge) => edge.kind === 'cooccurrence' && edge.type === 'SHARES_ENTITY'),
      'graph: edge co-occurrence harus ada'
    );
    const authIds = relationAtoms
      .filter((atom) => atom.entity && entityKeys(atom.entity).includes('auth.js'))
      .map((atom) => atom.atom_id);
    assert.ok(authIds.length >= 2, 'graph: alias auth.js dan src/auth.js harus terdeteksi');
    assert.ok(
      relationGraph.edges.some((edge) => edge.kind === 'cooccurrence'
        && authIds.includes(edge.from) && authIds.includes(edge.to)),
      'graph: alias path harus terhubung'
    );
    assert.ok(
      relationAtoms.some((atom) => authIds.includes(atom.atom_id) && atom.centrality > 0),
      'graph: centrality harus terisi untuk atom yang terhubung'
    );

    const guardedRelations = atomizeHistory([
      { role: 'assistant', content: 'saat CALLS Hanya' },
      { role: 'assistant', content: 'please use browser' },
      { role: 'assistant', content: 'system calls only when ready' },
      { role: 'assistant', content: 'the service is used by client' },
      { role: 'assistant', content: 'module is called by runner' },
      { role: 'assistant', content: 'React was replaced by Vue' },
      { role: 'assistant', content: 'the parser was replaced by a new parser' },
    ], {});
    const guardedRelationAtoms = guardedRelations.filter((atom) => atom.type === 'RELATION');
    assert.strictEqual(
      guardedRelationAtoms.filter((atom) => /saat|please|system/i.test(atom.content)
        && (atom.relations || []).length > 0).length,
      0,
      'relation guard: discourse/instruction tokens tidak boleh menjadi entity'
    );
    assert.ok(
      guardedRelationAtoms.some((atom) => atom.relations.some(
        (rel) => rel.type === 'USES' && (rel.source || atom.entity) === 'client' && rel.target === 'service'
      )),
      'relation passive: auxiliary "is used by" harus mempertahankan arah'
    );
    assert.ok(
      guardedRelationAtoms.some((atom) => atom.relations.some(
        (rel) => rel.type === 'CALLS' && (rel.source || atom.entity) === 'runner' && rel.target === 'module'
      )),
      'relation passive: auxiliary "is called by" harus mempertahankan arah'
    );
    assert.ok(
      guardedRelationAtoms.some((atom) => atom.relations.some(
        (rel) => rel.type === 'REPLACED_BY' && (rel.source || atom.entity) === 'react' && rel.target === 'vue'
      )),
      'relation passive: auxiliary "was replaced by" harus mempertahankan arah'
    );
    assert.ok(
      guardedRelationAtoms.some((atom) => atom.relations.some(
        (rel) => rel.type === 'REPLACED_BY' && rel.source === 'parser' && rel.target === 'parser'
      )) === false,
      'relation guard: self-replacement dari filler tidak boleh dibuat'
    );
    const guardedGraph = buildRelationGraph(guardedRelations);
    const semanticEdges = guardedGraph.edges.filter((edge) => edge.kind === 'explicit')
      .map((edge) => `${edge.type}|${edge.fromEntity}|${edge.toEntity}`);
    assert.strictEqual(
      new Set(semanticEdges).size,
      semanticEdges.length,
      'graph: semantic relation yang sama tidak boleh menghasilkan edge duplikat'
    );

    const big = Array.from({ length: 1000 }, (_, i) => {
      if (i === 0) return { role: 'user', content: 'Tujuan: uji skala 1000 pesan dengan arsip besar.' };
      if (i === 500) return { role: 'user', content: 'Error kritis: kode kegagalan E_SCALE_0500 pada file src/scale/module-500.js.' };
      if (i === 999) return { role: 'user', content: 'Fakta akhir: kode kegagalan E_SCALE_9999 pada file src/scale/final.js.' };
      return {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Catatan langkah ${i}: modul-${i} diperiksa dengan status unik-${i}.`,
      };
    });

    const scaleCompress = new ContextEngine({ config: makeConfig(root, 'scale-compress'), workspace, sessionId: 'scale-compress' });
    const compressStart = Date.now();
    const compressed = scaleCompress.compress({ history: big, maxChars: 1400 });
    const compressMs = Date.now() - compressStart;
    assert.ok(compressed.summary.length <= 1400, `skala: summary harus <= 1400 (${compressed.summary.length})`);
    assert.ok(compressed.totalAtoms > 500, `skala: atomisasi harus mencakup ribuan atom (${compressed.totalAtoms})`);
    assert.ok(compressMs < 20000, `skala: compress 1000 pesan terlalu lambat (${compressMs} ms)`);

    const scaleArchive = new ContextEngine({ config: makeConfig(root, 'scale-archive'), workspace, sessionId: 'scale-archive' });
    scaleArchive.checkpoint({ history: big });
    scaleArchive.compress({ history: [{ role: 'user', content: 'Tujuan: uji skala 1000 pesan.' }], maxChars: 1400 });
    const retrieveStart = Date.now();
    const archived = scaleArchive.retrieve('kode kegagalan E_SCALE_0500', { limit: 4 });
    const retrieveMs = Date.now() - retrieveStart;
    assert.strictEqual(archived.fallback, true, 'skala: fakta tengah arsip harus memicu fallback');
    assert.ok(/E_SCALE_0500/.test(archived.context), 'skala: fakta tengah arsip harus ditemukan');
    assert.ok(retrieveMs < 10000, `skala: retrieve arsip 1000 pesan terlalu lambat (${retrieveMs} ms)`);

    console.log(
      `PASS urich evidence: independent queries + abstention, ablation, scale ${compressed.totalAtoms} atoms ` +
      `(budget 1400, compress ${compressMs} ms, archive retrieve ${retrieveMs} ms)`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL urich evidence:', error.stack || error);
  process.exitCode = 1;
});
