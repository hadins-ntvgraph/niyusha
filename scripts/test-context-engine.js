'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent } = require('../bin/ai');
const { VirtualFS } = require('../bin/vfs');
const { ContextEngine, ATOM_TYPES, atomizeHistory, classifyText, reconstructAtoms, selectAtoms, tokenize } = require('../bin/context-engine');
const { archiveFile, normalizeCompactionMode, validateCompactionResult, latestArchive } = require('../bin/compaction');

function history() {
  return [
    { role: 'user', content: 'Tujuan: perbaiki parser JSON. Jangan ubah kontrak API.' },
    { role: 'assistant', content: 'Keputusan: gunakan parser JSON bawaan.' },
    { role: 'user', content: 'File: src/parser.js. Error: test gagal pada input kosong.' },
    { role: 'tool', tool_call_id: 't1', content: 'output tool panjang '.repeat(80) },
    { role: 'assistant', content: 'Test: verifikasi lulus. Langkah berikutnya: lanjutkan.' },
  ];
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-context-engine-'));
  const archiveDir = path.join(root, 'archive');
  const engineDir = path.join(root, 'context');
  const config = { contextBudget: 4000, contextEngineDir: engineDir, compactionArchiveDir: archiveDir };
  const workspace = root;

  assert.strictEqual(normalizeCompactionMode('urich'), 'urich');
  const adaptiveAgent = (budget) => new Agent({
    vfs: new VirtualFS(`adaptive-${budget}`, root),
    cwd: root,
    config: { ...config, contextBudget: budget, contextEngineMemoryChars: 1400, contextEngineMemoryMaxChars: 3600 },
  });
  assert.strictEqual(adaptiveAgent(2000)._adaptiveUrichMemoryChars(), 1400, 'budget kecil harus mempertahankan baseline memory');
  assert.strictEqual(adaptiveAgent(4000)._adaptiveUrichMemoryChars(), 1400, 'budget baseline tidak boleh menaikkan memory');
  assert.strictEqual(adaptiveAgent(8000)._adaptiveUrichMemoryChars(), 2800, 'budget besar harus menaikkan memory secara proporsional');
  assert.strictEqual(adaptiveAgent(16000)._adaptiveUrichMemoryChars(), 3600, 'adaptive memory tidak boleh melewati cap');

  const atoms = atomizeHistory(history());
  const types = new Set(atoms.map((a) => a.type));
  for (const type of ['GOAL', 'NEGATIVE_FACT', 'DECISION', 'CODE_CONTEXT', 'ERROR', 'TEST_RESULT']) {
    assert.ok(types.has(type), `atom ${type} harus terdeteksi`);
  }
  const instructionAtoms = atomizeHistory([{ role: 'user', content: 'Wajib jalankan test parser.' }]);
  assert.ok(instructionAtoms.some((a) => a.type === 'INSTRUCTION'), 'instruksi eksplisit harus tetap terdeteksi');
  assert.ok(atoms.some((a) => a.invariant), 'atom metadata harus invariant');
  assert.ok(atoms.some((a) => /parser\.js/.test(a.content)), 'path file harus tersimpan di atom');

  const manySentences = Array.from({ length: 15 }, (_, i) => `Fakta ${i}: detail unik ${i} tetap tersedia`);
  const longMessage = `${'Keterangan teknis tambahan. '.repeat(40)}${manySentences.join('. ')}.`;
  const longMessageAtoms = atomizeHistory([{ role: 'assistant', content: longMessage }]);
  assert.ok(longMessageAtoms.length > 12, 'atomisasi harus mencakup lebih dari 12 kalimat dalam satu pesan');
  assert.ok(longMessageAtoms.some((a) => a.content.includes('detail unik 14')), 'atomisasi harus mencakup kalimat paling akhir');
  assert.ok(longMessageAtoms.every((a) => a.content.length <= 480), 'atom panjang harus dibagi tanpa melebihi ukuran chunk');
  const longSentenceAtoms = atomizeHistory([{ role: 'assistant', content: `${'detail teknis '.repeat(100)}TAIL-MARKER-UNIQUE` }]);
  assert.ok(longSentenceAtoms.length > 1, 'kalimat panjang harus dipecah menjadi beberapa atom');
  assert.ok(longSentenceAtoms.some((a) => a.content.includes('TAIL-MARKER-UNIQUE')), 'bagian akhir kalimat panjang tidak boleh hilang');

  const engine = new ContextEngine({ config, workspace, sessionId: 's1' });
  const compressed = engine.compress({ history: history() });
  assert.ok(compressed.summary.includes('Tujuan'), 'summary harus memuat tujuan');
  assert.ok(compressed.summary.includes('Keputusan'), 'summary harus memuat keputusan');
  assert.ok(compressed.summary.toLowerCase().includes('src/parser.js'), 'summary harus memuat path');
  const validation = validateCompactionResult({ originalHistory: history(), candidateHistory: history(), summary: compressed.summary });
  assert.strictEqual(validation.ok, true, `validasi harus lolos: ${validation.reasons.join(', ')}`);

  const engine2 = new ContextEngine({ config, workspace, sessionId: 's1' });
  assert.ok(engine2.getStats().atoms > 0, 'compressed memory harus persisten');
  const retrieved = engine2.retrieve('parser json');
  assert.ok(retrieved.atoms.length > 0, 'retrieval harus menemukan atom relevan');
  assert.ok(retrieved.context.toLowerCase().includes('parser'), 'konteks retrieval memuat parser');
  assert.strictEqual(retrieved.fallback, false, 'retrieval memory tidak perlu fallback');

  const archiveEngine = new ContextEngine({ config, workspace, sessionId: 's2' });
  archiveEngine.checkpoint({ history: history(), summary: null });
  const archiveRetrieved = new ContextEngine({ config, workspace, sessionId: 's2' }).retrieve('src/parser.js');
  assert.strictEqual(archiveRetrieved.fallback, true, 'memory kosong harus fallback ke archive');
  assert.ok(archiveRetrieved.context.toLowerCase().includes('parser'), 'fallback archive memuat informasi');

  const archiveQueryEngine = new ContextEngine({ config, workspace, sessionId: 'archive-query' });
  archiveQueryEngine.checkpoint({
    history: [{ role: 'user', content: 'Pagination cursor harus memakai stable immutable item ID agar insert tidak menyebabkan duplikat.' }],
  });
  archiveQueryEngine.compress({
    history: [{ role: 'assistant', content: 'Cursor pagination saat ini bermasalah.' }],
  });
  const archiveExpanded = archiveQueryEngine.retrieve('stable cursor item ID', { limit: 8 });
  assert.ok(archiveExpanded.atoms.some((a) => a.source === 'archive'), 'archive harus dipertimbangkan meski memory aktif memberi hasil');
  assert.ok(archiveExpanded.context.toLowerCase().includes('immutable item id'), 'detail arsip yang lebih relevan harus masuk ke konteks');

  const agent = new Agent({
    vfs: new VirtualFS('context-engine-test', root),
    cwd: root,
    config: { ...config, apiKey: 'x', model: 'm', provider: 'openrouter', compactionMode: 'urich', compactionAuto: true },
  });
  agent.callModel = async () => ({ role: 'assistant', content: 'tidak dipakai urich' });
  agent.history = history().concat(history());
  const before = agent.contextTokens().used;
  await agent.compactIfNeeded(false, { trigger: 'auto' });
  const stats = agent.compactionStats();
  assert.ok(agent.history.length < history().concat(history()).length, 'urich harus memangkas history');
  assert.ok(agent.contextTokens().used < before, 'urich harus mengurangi token');
  assert.strictEqual(stats.lastTrigger, 'auto', 'urich auto harus tercatat auto');
  assert.strictEqual(stats.urich.validation, true, 'urich harus lolos validasi');
  assert.ok(stats.urich.atoms > 0, 'urich harus menyimpan atom');
  assert.strictEqual(stats.urich.memoryChars, 1400, 'telemetry harus mencatat memory adaptive efektif');
  assert.strictEqual(stats.urich.diagnostics.summaryWithinBudget, true, 'compaction telemetry harus mengekspos budget diagnostics');
  assert.ok(stats.urich.diagnostics.selectedByType, 'compaction telemetry harus mengekspos distribusi tipe atom');
  assert.ok(fs.existsSync(archiveFile({ config: agent.config, workspace: root, sessionId: agent.compactionSessionId })), 'urich harus membuat archive');

  const repeatedConfig = {
    ...config,
    contextEngineDir: path.join(root, 'context-repeated'),
    compactionArchiveDir: path.join(root, 'archive-repeated'),
    contextEngineMemoryChars: 1400,
    compactionMode: 'urich',
    compactionAuto: true,
  };
  const repeatedAgent = new Agent({
    vfs: new VirtualFS('context-engine-repeated', root),
    cwd: root,
    config: repeatedConfig,
  });
  repeatedAgent._recordGoal('Perbaiki parser tanpa mengubah kontrak API');
  repeatedAgent._recordGoal('Tujuan baru: stabilkan parser dan pertahankan API v1');
  repeatedAgent._recordDecisionUpdates('Keputusan [api]: Pertahankan endpoint v1 dengan adapter.');
  repeatedAgent._recordDecisionUpdates('Keputusan [api]: Gunakan adapter kompatibel v2.');
  repeatedAgent._recordDecisionUpdates('Keputusan [frontend]: Tetap gunakan Vue.');
  repeatedAgent.history = Array.from({ length: 18 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0
      ? `Fakta implementasi ${i}: parser mempertahankan field unknown-${i} dan kontrak lama.`
      : `Pemeriksaan ${i}: validasi parser tetap kompatibel dengan client-${i}.`,
  }));
  for (let cycle = 0; cycle < 3; cycle++) {
    await repeatedAgent.compactIfNeeded(true, { trigger: 'manual' });
    assert.ok(repeatedAgent.summary.includes('Tujuan baru: stabilkan parser'), `compaction ${cycle + 1} mempertahankan tujuan aktif`);
    assert.ok(repeatedAgent.summary.includes('[active] [api] Gunakan adapter kompatibel v2'), `compaction ${cycle + 1} mempertahankan keputusan API aktif`);
    assert.ok(repeatedAgent.summary.includes('[superseded] [api] Pertahankan endpoint v1 dengan adapter'), `compaction ${cycle + 1} menandai keputusan lama superseded`);
    assert.ok(repeatedAgent.summary.includes('[active] [frontend] Tetap gunakan Vue'), `compaction ${cycle + 1} mempertahankan keputusan scope lain`);
    assert.ok(repeatedAgent.summary.length <= repeatedConfig.contextEngineMemoryChars, `compaction ${cycle + 1} mematuhi hard memory budget`);
    repeatedAgent.history.push(
      { role: 'user', content: `Tambahan sesi ${cycle}: field unknown tetap harus dipertahankan.` },
      { role: 'assistant', content: `Hasil sesi ${cycle}: kompatibilitas terverifikasi.` }
    );
  }
  const repeatedArchivePath = archiveFile({
    config: repeatedConfig,
    workspace: root,
    sessionId: repeatedAgent.compactionSessionId,
  });
  const repeatedRecords = fs.readFileSync(repeatedArchivePath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.ok(repeatedRecords.length >= 3, 'setiap siklus compaction menyimpan checkpoint tersendiri');
  assert.ok(repeatedRecords.every((record) => record.state.goalLedger.length === 2), 'checkpoint berulang menyimpan riwayat transisi goal');
  assert.ok(repeatedRecords.every((record) => record.state.decisions.length === 3), 'checkpoint berulang menyimpan ledger keputusan lengkap');

  const savedSummary = agent.summary;
  const savedSessionId = agent.compactionSessionId;
  assert.ok(savedSummary && /parser/i.test(savedSummary), 'summary urich harus tersimpan di agent');
  const restored = new Agent({
    vfs: new VirtualFS('context-engine-restore', root),
    cwd: root,
    config: { ...config, apiKey: 'x', model: 'm', provider: 'openrouter', compactionMode: 'urich', compactionAuto: true },
  });
  restored.reset();
  restored.history = agent.history.map((m) => ({ ...m }));
  restored.summary = savedSummary;
  restored.compactionSessionId = savedSessionId;
  const restoredPrompt = restored.systemPrompt();
  assert.ok(restoredPrompt.includes('parser.js'), 'summary hasil kompaksi dipulihkan ke prompt');
  assert.ok(restoredPrompt.includes('Keputusan'), 'keputusan hasil kompaksi tidak hilang setelah restore');
  const restoredRetrieval = new ContextEngine({ config, workspace: root, sessionId: savedSessionId }).retrieve('parser json');
  assert.ok(restoredRetrieval.atoms.length > 0, 'memory hasil kompaksi tetap bisa diakses setelah restore');

  const codeAtoms = atomizeHistory([{ role: 'user', content: 'File: src/parser.js.' }]);
  assert.strictEqual(codeAtoms[0] && codeAtoms[0].code_kind, 'FILE', 'coding context atom harus mengekstrak code_kind FILE');

  const relationAtoms = atomizeHistory([{ role: 'user', content: 'src/a.js memanggil src/b.js' }]);
  assert.ok(relationAtoms.some((a) => a && a.type === 'RELATION' && /src\/b\.js/.test(a.content)), 'relasi source->target harus diproduksi');

  const temporalAtoms = atomizeHistory([
    { role: 'user', content: 'Dulu frontend memakai React.' },
    { role: 'assistant', content: 'Sekarang frontend memakai Vue.' },
  ]);
  assert.ok(temporalAtoms.some((a) => a && /React/.test(a.content) && a.temporal_status === 'HISTORICAL'), 'atom React harus berstatus HISTORICAL');
  assert.ok(temporalAtoms.some((a) => a && /Vue/.test(a.content) && a.temporal_status === 'ACTIVE'), 'atom Vue harus berstatus ACTIVE');

  const conflictAtoms = atomizeHistory([
    { role: 'user', content: 'Keputusan: gunakan React.' },
    { role: 'assistant', content: 'Keputusan: gunakan Vue.' },
  ]);
  const reactConflict = conflictAtoms.find((a) => a && /React/.test(a.content));
  const vueConflict = conflictAtoms.find((a) => a && /Vue/.test(a.content));
  assert.ok(reactConflict && reactConflict.superseded_by, 'keputusan lama harus ditandai superseded');

  const replacementHistory = [
    { role: 'assistant', content: 'Dulu frontend memakai React. Sekarang frontend beralih ke Vue.' },
    { role: 'user', content: 'React digantikan oleh Vue.' },
  ];
  const replacementEngine = new ContextEngine({
    config: { ...config, contextEngineMemoryChars: 1400 },
    workspace: root,
    sessionId: 'replacement-retrieval',
  });
  const replacementCompressed = replacementEngine.compress({ history: replacementHistory, maxChars: 1400 });
  const replacementRelation = replacementCompressed.atoms.find((a) =>
    a.type === 'RELATION' && (a.relations || []).some((r) => r.type === 'REPLACED_BY')
  );
  assert.ok(replacementRelation && replacementRelation.temporal_status === 'ACTIVE', 'relasi penggantian harus tetap aktif');
  const replacementRetrieved = replacementEngine.retrieve('framework frontend sebelumnya dan sekarang', { limit: 8 });
  assert.ok(replacementRetrieved.atoms.some((a) =>
    a.type === 'RELATION' && (a.relations || []).some((r) => r.type === 'REPLACED_BY')
  ), 'retrieval harus mempertahankan relasi historis penggantian');

  const repetitiveHistory = [
    { role: 'user', content: 'Tujuan: selesaikan refresh token tanpa mengubah kontrak API.' },
    { role: 'assistant', content: 'Keputusan: refresh token memakai rotasi.' },
    { role: 'assistant', content: 'Dulu frontend memakai React. Sekarang frontend beralih ke Vue.' },
    { role: 'user', content: 'React digantikan oleh Vue.' },
  ];
  for (let i = 0; i < 70; i++) {
    repetitiveHistory.push(
      { role: 'user', content: `Progress ${i}: lanjutkan implementasi dan pertahankan kontrak yang telah disepakati.` },
      { role: 'assistant', content: `Pemeriksaan rutin tahap ${i}. detail teknis non-kritis ${i}.` },
    );
  }
  const repetitiveEngine = new ContextEngine({
    config: { ...config, contextEngineMemoryChars: 1400 },
    workspace: root,
    sessionId: 'repetitive-progress',
  });
  const repetitiveCompressed = repetitiveEngine.compress({ history: repetitiveHistory, maxChars: 1400 });
  assert.ok(repetitiveCompressed.summary.length <= 1400, 'summary tidak boleh melewati hard character budget');
  assert.strictEqual(repetitiveCompressed.stats.summaryWithinBudget, true, 'compression diagnostics harus mencatat budget compliance');
  assert.strictEqual(repetitiveCompressed.stats.requestedBudgetChars, 1400, 'compression diagnostics harus melaporkan budget yang diminta');
  assert.ok(repetitiveCompressed.stats.selectedByType.GOAL, 'compression diagnostics harus mengelompokkan atom terpilih per tipe');
  assert.ok((repetitiveCompressed.summary.match(/Progress \d+:/g) || []).length <= 1, 'progress boilerplate harus dikolaps menjadi satu');
  assert.ok((repetitiveCompressed.summary.match(/detail teknis non-kritis \d+/g) || []).length <= 1, 'detail progress boilerplate harus dikolaps');
  assert.ok(repetitiveCompressed.summary.includes('Tujuan'), 'compressi bloat harus tetap mempertahankan tujuan');
  assert.ok(repetitiveCompressed.summary.includes('Vue'), 'compressi bloat harus tetap mempertahankan fakta aktif');
  const historicalFramework = repetitiveEngine.retrieve('framework frontend sebelumnya React digantikan Vue', { limit: 8 });
  assert.ok(historicalFramework.context.includes('React') && historicalFramework.context.includes('Vue'), 'arsip/memory harus tetap bisa mengembalikan relasi historis');
  console.log(
    `PASS progress-bloat regression: ${repetitiveHistory.length} messages, ` +
    `${repetitiveCompressed.summary.length}/1400 summary chars, ` +
    `${(repetitiveCompressed.summary.match(/Progress \d+:/g) || []).length} progress markers, ` +
    'historical React-to-Vue retrieval retained'
  );

  const variedProgressHistory = [
    { role: 'user', content: 'Tujuan: perbaiki parser tanpa mengubah kontrak API.' },
    { role: 'assistant', content: 'Keputusan: gunakan parser JSON bawaan.' },
  ];
  for (let i = 0; i < 70; i++) {
    variedProgressHistory.push(
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
      variedProgressHistory.push({
        role: 'user',
        content: 'Critical: regression test tests/parser-empty.test.js gagal pada input null; pertahankan error code E_PARSE.',
      });
    }
  }
  const variedProgressEngine = new ContextEngine({
    config: { ...config, contextEngineMemoryChars: 1400 },
    workspace: root,
    sessionId: 'varied-progress',
  });
  const variedProgressCompressed = variedProgressEngine.compress({ history: variedProgressHistory, maxChars: 1400 });
  assert.ok(variedProgressCompressed.summary.length <= 1400, 'paraphrased progress summary harus mematuhi budget');
  assert.ok(variedProgressCompressed.summary.includes('E_PARSE'), 'fakta kritis baru di tengah progress harus dipertahankan');
  assert.ok(
    (variedProgressCompressed.summary.match(/Status tahap \d+:/g) || []).length <= 1,
    'template status rutin bernomor yang sama harus dikolaps'
  );
  assert.ok(
    (variedProgressCompressed.summary.match(/Update \d+:/g) || []).length <= 1,
    'template update rutin bernomor yang sama harus dikolaps'
  );
  assert.ok(
    variedProgressCompressed.stats.selectedByType.CODE_CONTEXT &&
      variedProgressCompressed.stats.selectedByType.CODE_CONTEXT.contentChars > 0,
    'diagnostics harus menunjukkan file/fakta kritis terpilih dan kontribusi karakternya'
  );
  assert.strictEqual(variedProgressCompressed.stats.invariantSelected > 0, true, 'diagnostics harus menghitung invariant terpilih');
  const variedArchive = new ContextEngine({
    config,
    workspace: root,
    sessionId: 'varied-progress-archive',
  });
  variedArchive.checkpoint({ history: variedProgressHistory });
  for (let cycle = 0; cycle < 3; cycle++) {
    variedArchive.compress({
      history: [{ role: 'assistant', content: `Cycle ${cycle}: pemeriksaan lanjutan.` }],
      maxChars: 1400,
    });
    const recovered = variedArchive.retrieve('regression test null E_PARSE parser', { limit: 8 });
    assert.ok(recovered.context.includes('E_PARSE'), `kompaksi ke-${cycle + 1} harus tetap mengambil fakta kritis dari arsip`);
  }
  console.log(
    `PASS varied-progress regression: ${variedProgressHistory.length} messages, ` +
    `${variedProgressCompressed.summary.length}/1400 summary chars, ` +
    `${(variedProgressCompressed.summary.match(/Status tahap \d+:/g) || []).length} repeated status markers, ` +
    'critical fact retained and archive retrieval passed after 3 compactions'
  );

  const taskHistory = [
    { role: 'user', content: 'File: src/parser.js.' },
    { role: 'assistant', content: 'Fungsi parse digunakan oleh src/parser.js.' },
    { role: 'user', content: 'Dependency: lodash.' },
  ];
  const taskEngine = new ContextEngine({ config, workspace: root, sessionId: 's8' });
  const taskCompressed = taskEngine.compress({ history: taskHistory, summary: null });
  assert.deepStrictEqual(taskCompressed.taskState.files, ['src/parser.js'], 'task state harus mengumpulkan file');
  assert.ok(taskCompressed.taskState.functions.includes('parse'), 'task state harus mengumpulkan fungsi');
  assert.ok(taskCompressed.taskState.dependencies.includes('lodash'), 'task state harus mengumpulkan dependensi');

  let sentMessages = null;
  agent.callModel = async (messages) => {
    sentMessages = messages;
    return { role: 'assistant', content: 'ok' };
  };
  // Simulasikan summary yang sudah dipangkas: path file tidak ada di summary
  // maupun history terbaru, jadi hanya retrieval yang bisa menyelamatkannya.
  agent.history = [
    { role: 'user', content: 'Lanjutkan pekerjaan sebelumnya.' },
    { role: 'assistant', content: 'Siap.' },
  ];
  agent.summary = 'Ringkasan sesi: pekerjaan parser.';
  await agent.run('File src/parser.js statusnya apa?');
  assert.ok(sentMessages && sentMessages[0] && sentMessages[0].role === 'system', 'run harus mengirim system prompt');
  assert.ok(sentMessages[0].content.includes('KONTEKS RETRIEVAL DIS-URICH'), 'urich harus menyuntikkan hasil retrieval ke prompt');
  assert.ok(sentMessages[0].content.includes('src/parser.js'), 'detail yang tidak ada di summary harus dipulihkan retrieval');
  const retrievalStats = agent.compactionStats().urichRetrieval;
  assert.ok(retrievalStats && retrievalStats.atoms > 0, 'retrieval urich harus tercatat dan menemukan atom');

  const off = new Agent({
    vfs: new VirtualFS('context-engine-off', root),
    cwd: root,
    config: { ...config, apiKey: 'x', model: 'm', provider: 'openrouter', compactionMode: 'urich', compactionAuto: false },
  });
  off.history = history().concat(history());
  const offBefore = JSON.stringify(off.history);
  await off.prepareContext();
  assert.strictEqual(JSON.stringify(off.history), offBefore, 'auto off tidak boleh menjalankan urich');

  const resetAgent = new Agent({
    vfs: new VirtualFS('context-engine-reset', root),
    cwd: root,
    config: { ...config, apiKey: 'x', model: 'm', provider: 'openrouter', compactionMode: 'urich', compactionAuto: true },
  });
  const priorSessionId = resetAgent.compactionSessionId;
  resetAgent._getContextEngine().checkpoint({
    history: [{ role: 'user', content: 'Rahasia dari task sebelumnya: BLUE-ORCHID-91.' }],
  });
  resetAgent._lastRetrievalQuery = 'same query';
  resetAgent._lastRetrievalResult = 'stale context';
  resetAgent.reset();
  assert.notStrictEqual(resetAgent.compactionSessionId, priorSessionId, 'reset harus memulai compaction memory dengan session id baru');
  assert.strictEqual(resetAgent._lastRetrievalQuery, null, 'reset harus menghapus retrieval query cache');
  assert.strictEqual(resetAgent._lastRetrievalResult, undefined, 'reset harus menghapus retrieval result cache');
  const resetRetrieval = resetAgent._getContextEngine().retrieve('BLUE-ORCHID-91');
  assert.strictEqual(resetRetrieval.atoms.length, 0, 'session baru tidak boleh mengambil memory/archive sesi lama');

  const stateAtoms = atomizeHistory([], { state: { goal: 'Tujuan: perbaiki auth.', goalLedger: [{ text: 'Tujuan lama', status: 'superseded' }, { text: 'Tujuan baru', status: 'active' }], decisions: [{ scope: 'api', text: 'Pertahankan adapter v1', status: 'active' }], failures: ['refresh loop'], resolved: [{ text: 'token rotasi' }], evidence: ['test lulus'], touchedFiles: ['src/auth/refresh.js'], contextNotes: [{ text: 'note undo' }] } });
  assert.ok(stateAtoms.some((a) => a.type === 'GOAL'), 'state atom GOAL harus terdeteksi');
  assert.ok(stateAtoms.some((a) => a.type === 'GOAL' && a.content.includes('[superseded]')), 'status goal lama harus dipertahankan di atom');
  assert.ok(stateAtoms.some((a) => a.type === 'DECISION' && a.content.includes('[api]')), 'decision ledger harus ter-atomisasi dengan scope');
  assert.ok(stateAtoms.some((a) => a.type === 'FAILURE'), 'state atom FAILURE harus terdeteksi');
  assert.ok(stateAtoms.some((a) => a.type === 'RESOLVED'), 'state atom RESOLVED harus terdeteksi');
  assert.ok(stateAtoms.some((a) => a.type === 'EVIDENCE'), 'state atom EVIDENCE harus terdeteksi');
  assert.ok(stateAtoms.some((a) => a.type === 'TOUCHED_FILE'), 'state atom TOUCHED_FILE harus terdeteksi');

  const stateEngine = new ContextEngine({ config, workspace: root, sessionId: 's9' });
  const stateCompressed = stateEngine.compress({ history: history(), summary: null, state: { goal: 'Tujuan: perbaiki auth.', goalLedger: [{ text: 'Tujuan lama', status: 'superseded' }], decisions: [{ scope: 'api', text: 'Pertahankan adapter v1', status: 'active' }], failures: ['refresh loop'], resolved: [{ text: 'token rotasi' }], evidence: ['test lulus'], touchedFiles: ['src/auth/refresh.js'] } });
  assert.ok(stateCompressed.atoms.some((a) => a.type === 'GOAL'), 'compress harus menyertakan state atom GOAL');
  assert.ok(stateCompressed.atoms.some((a) => a.type === 'DECISION' && a.content.includes('Pertahankan adapter v1')), 'compress harus menyertakan decision ledger');
  const cp = stateEngine.checkpoint({ history: history(), summary: null, state: { goal: 'Tujuan: perbaiki auth.', failures: ['refresh loop'] } });
  const rec = latestArchive({ config, workspace: root, sessionId: 's9' });
  assert.ok(rec && rec.state && rec.state.goal, 'archive harus menyimpan state');

  const taskAtoms = atomizeHistory([], { state: { todos: [{ text: 'implement refresh', status: 'in_progress' }, { text: 'add test', status: 'completed' }] } });
  assert.ok(taskAtoms.some((a) => a.type === 'TASK' && a.content.includes('[in_progress]')), 'task lifecycle atom harus menyertakan status in_progress');
  assert.ok(taskAtoms.some((a) => a.type === 'TASK' && a.content.includes('[completed]')), 'task lifecycle atom harus menyertakan status completed');

  const goalAtoms = atomizeHistory([], { state: { goal: 'Tujuan baru: migrasi ke Vue.' } });
  assert.ok(goalAtoms.some((a) => a.type === 'GOAL'), 'goal dinamis harus ter-atomisasi');

  const explicitGoalHistory = [
    { role: 'user', content: 'Tujuan: perbaiki parser JSON dan pertahankan kontrak API.' },
    { role: 'assistant', content: 'Keputusan: gunakan parser JSON bawaan, bukan regex.' },
    { role: 'user', content: 'File: src/parser.js. Error: test gagal pada input kosong.' },
  ];
  const explicitGoalEngine = new ContextEngine({
    config,
    workspace: root,
    sessionId: 'goal-retrieval',
  });
  explicitGoalEngine.compress({ history: explicitGoalHistory, maxChars: 1400 });
  const goalRetrieval = explicitGoalEngine.retrieve('tujuan', { limit: 8 });
  assert.ok(goalRetrieval.atoms.some((a) => a.type === 'GOAL'), 'retrieval tujuan harus menemukan atom GOAL');
  assert.strictEqual(goalRetrieval.sufficient, true, 'atom GOAL harus memenuhi intent tujuan');

  const budgetAtoms = ['GOAL', 'INSTRUCTION', 'DECISION', 'CODE_CONTEXT', 'FILE', 'STATE', 'FACT', 'HISTORY']
    .flatMap((type, typeIndex) => [40, 55, 70, 90, 110, 130].map((length, index) => ({
      atom_id: `budget_${type}_${index}`,
      type,
      content: `${type.toLowerCase()} ${String(typeIndex * 10 + index).repeat(length)}`.slice(0, length),
      normalized_text: `budget ${type.toLowerCase()} ${index}`,
      effective_importance: 0.9,
      centrality: 0,
      temporal_status: 'ACTIVE',
      invariant: true,
    })));
  for (const budget of [237, 282, 330, 383, 443, 650, 800, 1000, 1400]) {
    const rendered = reconstructAtoms(selectAtoms(budgetAtoms, budget), { maxChars: budget });
    assert.ok(
      rendered.length <= budget,
      `selectAtoms harus menghitung biaya heading secara akurat pada budget ${budget}: ${rendered.length} > ${budget}`
    );
  }

  for (const type of ['TOUCHED_FILE', 'ERROR', 'TEST_RESULT']) {
    assert.ok(ATOM_TYPES.includes(type), `ATOM_TYPES harus memuat ${type}`);
  }
  assert.strictEqual(classifyText('Saya sedang memeriksa hasilnya hari ini.', 'user'), 'HISTORY', 'kalimat netral bukan instruksi');
  const relationSchemaAtoms = atomizeHistory([{ role: 'assistant', content: 'src/a.js memanggil src/b.js' }]);
  const relationSchema = relationSchemaAtoms.find((a) => a.type === 'RELATION');
  assert.ok(relationSchema && relationSchema.relations.every((r) => r.source), 'setiap relasi harus menyimpan source eksplisit');
  const truncatedRender = reconstructAtoms(Array.from({ length: 8 }, (_, i) => ({
    atom_id: `r04_${i}`,
    type: 'FACT',
    content: `${'x'.repeat(90)}${i}`,
    normalized_text: `r04_${i}`,
    effective_importance: 0.7,
    centrality: 0,
    temporal_status: 'ACTIVE',
    invariant: false,
  })), { maxChars: 100 });
  assert.ok(truncatedRender.length <= 100, `reconstructAtoms harus mematuhi maxChars: ${truncatedRender.length}`);
  const invariantAtom = {
    atom_id: 'r05_invariant',
    type: 'INSTRUCTION',
    content: 'y'.repeat(556),
    normalized_text: 'r05_invariant',
    effective_importance: 1,
    centrality: 0,
    temporal_status: 'ACTIVE',
    invariant: true,
  };
  const invariantSelected = selectAtoms([invariantAtom], 200);
  assert.ok(invariantSelected.some((a) => a.atom_id === 'r05_invariant'), 'atom invariant harus tetap terpilih meski melebihi budget');
  assert.ok(reconstructAtoms(invariantSelected, { maxChars: 200 }).length <= 200, 'render overflow invariant harus tetap dibatasi');

  const chronologyConfig = { ...config, contextEngineDir: path.join(root, 'context-chronology') };
  const chronologyEngine = new ContextEngine({ config: chronologyConfig, workspace: root, sessionId: 'chronology' });
  const chronologyStart = Date.parse('2026-11-05T08:00:00Z');
  const chronologyHistory = [
    { role: 'user', content: 'Nama proyek ini Z. Awal percakapan.', createdAt: chronologyStart },
    { role: 'assistant', content: 'Baik, proyek Z.', createdAt: chronologyStart + 60000 },
    { role: 'user', content: 'Catatan: kita ganti fokus ke modul auth.', createdAt: chronologyStart + 3600000 },
    { role: 'assistant', content: 'Fokus auth dicatat.', createdAt: chronologyStart + 3660000 },
    { role: 'user', content: 'Terakhir: deploy dilakukan jam 9 malam.', createdAt: chronologyStart + 7200000 },
    { role: 'assistant', content: 'Deploy jam 9 malam dicatat.', createdAt: chronologyStart + 7260000 },
  ];
  const firstChronology = chronologyEngine.compress({ history: chronologyHistory, maxChars: 2000 });
  const firstZ = firstChronology.atoms.find((a) => /Nama proyek ini Z/.test(a.content));
  const firstDeploy = firstChronology.atoms.find((a) => /Terakhir: deploy/.test(a.content));
  assert.ok(firstZ && firstDeploy && firstZ.sequence < firstDeploy.sequence, 'urutan awal harus kronologis');
  const secondChronology = chronologyEngine.compress({
    history: [{ role: 'user', content: 'Fakta baru: rilis kandidat dibuat.', createdAt: chronologyStart + 10800000 }],
    summary: firstChronology.summary,
    maxChars: 2000,
  });
  const secondZ = secondChronology.atoms.find((a) => /Nama proyek ini Z/.test(a.content));
  const secondDeploy = secondChronology.atoms.find((a) => /Terakhir: deploy/.test(a.content));
  const newFact = secondChronology.atoms.find((a) => /Fakta baru: rilis kandidat/.test(a.content));
  const firstMaxSeq = Math.max(...firstChronology.atoms.map((a) => Number(a.sequence) || 0));
  assert.ok(secondZ && secondDeploy && newFact, 'fakta lama dan baru harus tersedia setelah kompaksi kedua');
  assert.strictEqual(secondZ.sequence, firstZ.sequence, 'sequence fakta lama tidak boleh berubah');
  assert.strictEqual(secondZ.created_at, firstZ.created_at, 'timestamp fakta lama tidak boleh berubah');
  assert.strictEqual(secondDeploy.sequence, firstDeploy.sequence, 'sequence pesan lama tidak boleh berubah');
  assert.ok(secondZ.sequence < secondDeploy.sequence, 'fakta lama tidak boleh menjadi lebih baru dari pesan berikutnya');
  assert.ok(newFact.sequence > firstMaxSeq, 'pesan baru harus mendapat sequence setelah atom lama');
  assert.ok(!secondChronology.atoms.some((a) => /(?:DIS-URICH CONTEXT|DCM)/.test(a.content)), 'ringkasan lama tidak boleh di-ingest ulang sebagai percakapan baru');

  const priorityAtoms = [
    { atom_id: 'priority_code', type: 'CODE_CONTEXT', content: 'kode prioritas', normalized_text: 'aaa code', effective_importance: 1, centrality: 0, temporal_status: 'ACTIVE', invariant: true },
    { atom_id: 'priority_goal', type: 'GOAL', content: 'goal prioritas', normalized_text: 'zzz goal', effective_importance: 1, centrality: 0, temporal_status: 'ACTIVE', invariant: true },
  ];
  const prioritySelected = selectAtoms(priorityAtoms, 300);
  assert.strictEqual(prioritySelected[0].type, 'GOAL', 'tie-break harus mengikuti TYPE_ORDER, bukan urutan alfabetis');

  const narrowAtoms = atomizeHistory([
    { role: 'assistant', content: 'Log menyebut src/noise.js tanpa perubahan.' },
    { role: 'user', content: 'Tolong periksa src/parser.js.' },
  ], { state: { touchedFiles: ['src/core.js'] } });
  const noisePathAtom = narrowAtoms.find((a) => a.type === 'CODE_CONTEXT' && /noise\.js/.test(a.content));
  const userPathAtom = narrowAtoms.find((a) => a.type === 'CODE_CONTEXT' && /parser\.js/.test(a.content));
  assert.strictEqual(noisePathAtom.invariant, false, 'path non-touched dari asisten tidak boleh otomatis invariant');
  assert.strictEqual(userPathAtom.invariant, true, 'path eksplisit dari user tetap invariant');
  const touchedAtoms = atomizeHistory([{ role: 'assistant', content: 'Log menyebut src/core.js.' }], { state: { touchedFiles: ['src/core.js'] } });
  assert.strictEqual(
    touchedAtoms.find((a) => a.type === 'CODE_CONTEXT' && /core\.js/.test(a.content)).invariant,
    true,
    'path yang termasuk touchedFiles harus invariant'
  );

  const orientationEngine = new ContextEngine({ config, workspace: root, sessionId: 'intent-orientation' });
  orientationEngine.compress({
    history: [
      { role: 'assistant', content: 'Dulu frontend memakai React. Sekarang frontend beralih ke Vue.' },
      { role: 'user', content: 'Test pagination cursor masih gagal pada input null.' },
    ],
    maxChars: 1400,
  });
  const historyIntent = orientationEngine.retrieve('framework frontend sebelumnya React atau Vue', { limit: 4 });
  assert.strictEqual(historyIntent.sufficient, true, 'intent HISTORY harus terpenuhi oleh konten historis, bukan hanya tipe atom');
  const testIntent = orientationEngine.retrieve('test pagination yang masih gagal', { limit: 4 });
  assert.strictEqual(testIntent.sufficient, true, 'intent TEST_RESULT harus terpenuhi oleh konten kegagalan test');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS context engine: atomizer, compressed memory, retrieval, archive fallback, urich auto');
})().catch((error) => {
  console.error('FAIL context engine:', error.stack || error);
  process.exitCode = 1;
});
