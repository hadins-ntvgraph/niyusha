'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent } = require('../bin/ai');
const { VirtualFS } = require('../bin/vfs');
const { archiveFile, normalizeCompactionMode, validateCompactionResult } = require('../bin/compaction');

function makeHistory() {
  return [
    { role: 'user', content: 'Tujuan: perbaiki modul parser.' },
    { role: 'assistant', content: 'Saya akan membaca file.' },
    { role: 'tool', tool_call_id: 't1', content: 'hasil tool lama '.repeat(20) },
    { role: 'user', content: 'Keputusan: gunakan parser JSON.' },
    { role: 'assistant', content: 'Perubahan sudah dibuat.' },
    { role: 'user', content: 'Lanjutkan verifikasi test.' },
    { role: 'assistant', content: 'Menjalankan test.' },
  ];
}

function makeBigHistory() {
  return Array.from({ length: 16 }, (_, i) => [
    { role: 'user', content: `Tujuan langkah ${i}: ` + 'konteks penting '.repeat(120) },
    { role: 'assistant', content: 'Keputusan: parser JSON. ' + 'detail '.repeat(180) },
    { role: 'tool', tool_call_id: `g${i}`, content: 'hasil tool lama '.repeat(120) },
  ]).flat();
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-compaction-'));
  const archiveDir = path.join(root, 'archive');
  const make = (config = {}) => new Agent({
    vfs: new VirtualFS('compaction-test', root),
    cwd: root,
    config: { contextBudget: 100, apiKey: 'x', model: 'm', provider: 'openrouter', compactionArchiveDir: archiveDir, ...config },
  });

  assert.strictEqual(normalizeCompactionMode(undefined), 'legacy');
  assert.strictEqual(normalizeCompactionMode('unknown'), 'legacy');
  assert.strictEqual(normalizeCompactionMode('shadow'), 'shadow');

  const pathValidation = validateCompactionResult({
    originalHistory: [
      { role: 'user', content: 'Keep /src/parser.js, README.md, and package.json in scope.' },
      { role: 'tool', content: 'Files: /README.md /URICH_TEST_SCRIPT.md /package.json /src/parser.js.' },
      { role: 'assistant', content: 'The result is in (README.md).' },
    ],
    candidateHistory: [{ role: 'user', content: 'Keep the parser change.' }],
    summary: 'Keep src/parser.js, README.md, and package.json in scope.',
  });
  assert.strictEqual(pathValidation.ok, true, `path normalization must ignore tool-only references and punctuation: ${pathValidation.reasons.join(', ')}`);

  const missingUserPath = validateCompactionResult({
    originalHistory: [{ role: 'user', content: 'Update tests/parser.test.js.' }],
    candidateHistory: [{ role: 'user', content: 'Update parser tests.' }],
    summary: 'Update parser tests.',
  });
  assert.strictEqual(missingUserPath.ok, false, 'explicit user file references must remain protected');
  assert.ok(missingUserPath.reasons.includes('path/file hilang: tests/parser.test.js'));

  const legacy = make();
  legacy.history = makeHistory();
  legacy.callModel = async () => ({ role: 'assistant', content: 'ringkasan legacy' });
  await legacy.compactIfNeeded(true);
  assert.strictEqual(legacy.compactionMode, 'legacy');
  assert.ok(!fs.existsSync(archiveDir), 'legacy tidak boleh membuat archive');

  const legacyEmpty = make();
  legacyEmpty.history = makeHistory();
  legacyEmpty.callModel = async () => ({ role: 'assistant', content: '   ' });
  const legacyEmptyBefore = JSON.stringify(legacyEmpty.history);
  await assert.rejects(
    () => legacyEmpty.compactIfNeeded(true),
    /empty summary; original history was preserved/
  );
  assert.strictEqual(JSON.stringify(legacyEmpty.history), legacyEmptyBefore, 'legacy harus mempertahankan history jika summary kosong');
  assert.strictEqual(legacyEmpty.compactions, 0, 'legacy gagal tidak boleh menghitung compaction');

  const off = make({ compactionMode: 'off' });
  off.history = makeHistory();
  const beforeOff = JSON.stringify(off.history);
  await off.compactIfNeeded(true);
  assert.strictEqual(JSON.stringify(off.history), beforeOff, 'mode off tidak boleh mengubah history');

  const shadow = make({ compactionMode: 'shadow' });
  shadow.history = makeHistory();
  shadow.callModel = async () => ({ role: 'assistant', content: 'ringkasan shadow' });
  const shadowBefore = JSON.stringify(shadow.history);
  const shadowSummaryBefore = shadow.summary;
  const shadowCompactionsBefore = shadow.compactions;
  await shadow.compactIfNeeded(true);
  assert.strictEqual(JSON.stringify(shadow.history), shadowBefore, 'shadow tidak boleh mengubah history aktif');
  assert.strictEqual(shadow.summary, shadowSummaryBefore, 'shadow tidak boleh mengubah summary aktif');
  assert.strictEqual(shadow.compactions, shadowCompactionsBefore, 'shadow tidak boleh menaikkan counter aktif');
  assert.ok(shadow.lastCompactionShadow && shadow.lastCompactionShadow.summary === 'ringkasan shadow');
  assert.ok(shadow.lastCompactionShadow.candidateChars < shadow.lastCompactionShadow.originalChars);
  const file = archiveFile({ config: shadow.config, workspace: root, sessionId: shadow.compactionSessionId });
  assert.ok(fs.existsSync(file), 'shadow harus membuat archive sebelum compaction');
  const record = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.strictEqual(record.mode, 'shadow');
  assert.strictEqual(record.message_count, makeHistory().length);
  assert.ok(record.history_hash && record.history_hash.length === 64);

  const safe = make({ compactionMode: 'safe' });
  safe.history = makeHistory();
  safe.callModel = async () => ({ role: 'assistant', content: 'Tujuan: perbaiki parser. Keputusan: gunakan parser JSON. File: parser.js. Test: verifikasi langkah berikutnya.' });
  const safeBefore = JSON.stringify(safe.history);
  const safeResult = await safe.compactIfNeeded(true);
  assert.ok(safeResult && /Tujuan/.test(safeResult), 'safe commit jika validator lulus');
  assert.notStrictEqual(JSON.stringify(safe.history), safeBefore, 'safe boleh mengganti history setelah validasi');
  assert.ok(safe.lastCompactionValidation && safe.lastCompactionValidation.ok === true);
  assert.strictEqual(safe.compactions, 1);
  const rolled = safe.rollbackCompaction();
  assert.ok(rolled && rolled.checkpoint_id, 'checkpoint rollback tersedia');
  assert.strictEqual(JSON.stringify(safe.history), safeBefore, 'rollback mengembalikan history sebelum compaction');
  assert.ok(/Rollback checkpoint compaction/.test(safe.contextNotes.map((n) => n.text).join('\n')));

  const rejected = make({ compactionMode: 'safe' });
  rejected.history = makeHistory();
  rejected.callModel = async () => ({ role: 'assistant', content: 'ringkasan buruk tanpa metadata penting' });
  const rejectedBefore = JSON.stringify(rejected.history);
  const rejectedResult = await rejected.compactIfNeeded(true);
  assert.strictEqual(rejectedResult, null, 'safe menolak kandidat invalid');
  assert.strictEqual(JSON.stringify(rejected.history), rejectedBefore, 'safe fallback mempertahankan history lama');
  assert.ok(rejected.lastCompactionValidation && rejected.lastCompactionValidation.ok === false);
  assert.strictEqual(rejected.compactions, 0);
  assert.strictEqual(rejected.compactionStats().outcome.status, 'validation_failed');
  assert.ok(/metadata .* tidak dipertahankan|ringkasan kosong|riwayat kandidat kosong|pesan pengguna tidak dipertahankan/.test(rejected.compactionStats().outcome.reason));

  const rejectedEnglish = make({ compactionMode: 'safe' });
  rejectedEnglish.history = makeHistory().concat([{ role: 'user', content: 'Continue verifying the parser tests.' }]);
  rejectedEnglish.callModel = async () => ({ role: 'assistant', content: 'bad summary without required metadata' });
  const rejectedEnglishResult = await rejectedEnglish.compactIfNeeded(true);
  assert.strictEqual(rejectedEnglishResult, null);
  assert.ok(/metadata .* was not preserved|summary was empty|candidate history was empty|user message was not preserved/.test(rejectedEnglish.compactionStats().outcome.reason));

  const auto = make({ compactionMode: 'safe', compactionAuto: true });
  auto.history = makeHistory().concat([
    { role: 'user', content: 'Tambahkan langkah berikutnya dan verifikasi test.' },
    { role: 'assistant', content: 'Saya akan melanjutkan pekerjaan.' },
    { role: 'user', content: 'Pastikan tujuan dan keputusan tetap diingat.' },
  ]);
  auto.callModel = async () => ({ role: 'assistant', content: 'Tujuan: perbaiki parser. Keputusan: gunakan parser JSON. File: parser.js. Test: verifikasi. Langkah berikutnya: lanjutkan.' });
  await auto.prepareContext();
  const autoStats = auto.compactionStats();
  assert.strictEqual(autoStats.lastTrigger, 'auto', 'prepareContext harus menandai trigger auto');
  assert.strictEqual(autoStats.autoCompactions, 1, 'auto compaction harus tercatat satu kali');
  assert.ok(autoStats.beforeTokens > autoStats.afterTokens, 'auto compaction harus mengurangi token context');
  assert.ok(auto.lastCompactionValidation && auto.lastCompactionValidation.ok === true, 'auto safe harus continuity-validated');
  assert.strictEqual(autoStats.outcome.status, 'completed', 'successful auto compaction should be surfaced');

  const earlyAuto = make({ compactionMode: 'safe', compactionAuto: true, contextBudget: 1000 });
  earlyAuto.history = makeBigHistory();
  earlyAuto.contextTokens = () => ({ used: 500, budget: 1000 });
  earlyAuto.callModel = async () => ({ role: 'assistant', content: 'Tujuan: perbaiki parser. Keputusan: parser JSON. File: parser.js. Test: verifikasi. Langkah berikutnya: lanjutkan.' });
  await earlyAuto.prepareContext();
  assert.strictEqual(earlyAuto.compactions, 1, 'auto compaction harus mulai di atas 45% budget');

  const belowEarlyAuto = make({ compactionMode: 'safe', compactionAuto: true, contextBudget: 1000 });
  belowEarlyAuto.history = makeBigHistory();
  belowEarlyAuto.contextTokens = () => ({ used: 440, budget: 1000 });
  await belowEarlyAuto.prepareContext();
  assert.strictEqual(belowEarlyAuto.compactions, 0, 'auto compaction tidak berjalan di bawah 45% budget');

  const afterReplyAuto = make({ compactionMode: 'safe', compactionAuto: true, contextBudget: 1000 });
  afterReplyAuto.history = makeBigHistory().concat([
    { role: 'assistant', content: 'Jawaban final.' },
  ]);
  afterReplyAuto.contextTokens = () => ({ used: 490, budget: 1000 });
  afterReplyAuto.callModel = async () => ({ role: 'assistant', content: 'Tujuan: perbaiki parser. Keputusan: parser JSON. File: parser.js. Test: verifikasi. Langkah berikutnya: lanjutkan.' });
  await afterReplyAuto._autoCompactIfNeeded();
  assert.strictEqual(afterReplyAuto.compactions, 1, 'context at 49% should auto-compact immediately after a reply');
  assert.strictEqual(afterReplyAuto.compactionStats().outcome.status, 'completed');

  const autoOff = make({ compactionMode: 'safe', compactionAuto: false });
  autoOff.history = auto.history.slice();
  const autoOffBefore = JSON.stringify(autoOff.history);
  await autoOff.prepareContext();
  assert.strictEqual(JSON.stringify(autoOff.history), autoOffBefore, 'auto off tidak boleh compact otomatis');

  const guardAuto = make({ compactionMode: 'safe', contextBudget: 4000 });
  guardAuto.history = makeBigHistory();
  guardAuto.callModel = async () => ({ role: 'assistant', content: 'Tujuan: perbaiki parser. Keputusan: parser JSON. File: parser.js. Test: verifikasi. Langkah berikutnya: lanjutkan.' });
  const guardChanged = await guardAuto.guardContext();
  const guardStats = guardAuto.compactionStats();
  assert.ok(guardChanged, 'guard harus mengubah context saat melewati batas');
  assert.strictEqual(guardStats.lastTrigger, 'auto', 'guardContext harus menandai trigger auto');
  assert.strictEqual(guardStats.autoCompactions, 1, 'guard auto compaction harus tercatat satu kali');

  const guardOff = make({ compactionMode: 'safe', compactionAuto: false, contextBudget: 4000 });
  guardOff.history = makeBigHistory();
  const guardOffBefore = JSON.stringify(guardOff.history);
  const guardOffChanged = await guardOff.guardContext();
  assert.strictEqual(guardOffChanged, false, 'auto off tidak boleh memicu guard compaction');
  assert.strictEqual(JSON.stringify(guardOff.history), guardOffBefore, 'auto off guard tidak boleh mengubah history');
  assert.strictEqual(guardOff.compactionStats().lastTrigger, null, 'auto off guard tidak boleh mencatat trigger');

  const badPath = path.join(root, 'not-a-directory');
  fs.writeFileSync(badPath, 'blocking file');
  const guarded = make({ compactionMode: 'safe', compactionArchiveDir: badPath });
  guarded.history = makeHistory();
  const beforeGuarded = JSON.stringify(guarded.history);
  let failed = false;
  try { await guarded.compactIfNeeded(true); } catch { failed = true; }
  assert.ok(failed, 'archive gagal harus dilaporkan');
  assert.strictEqual(JSON.stringify(guarded.history), beforeGuarded, 'archive gagal tidak boleh membuang history');
  assert.strictEqual(guarded.compactionStats().outcome.status, 'failed', 'archive failure should be surfaced');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS compaction phases 1-5: mode flag, archive, shadow, safe validator, rollback, auto continuity');
})().catch((error) => {
  console.error('FAIL compaction phase 1:', error.stack || error);
  process.exitCode = 1;
});
