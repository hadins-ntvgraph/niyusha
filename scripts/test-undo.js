'use strict';

// ── Tes snapshot undo efek shell ─────────────────────────────────────────
// Fokus: isolasi per workspace, cleanup lintas-manifest, batas ukuran,
// dedupe object store, restore tidak menghapus file tak dikenal.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { VirtualFS } = require(path.join(__dirname, '..', 'bin/vfs'));

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

const dirs = [];
const tmp = (name) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `niyusha-undo-${name}-`));
  dirs.push(d);
  return d;
};
const mkRoot = (base, name) => {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  return root;
};
const read = (p) => fs.readFileSync(p, 'utf8');
const objectPath = (snap, v) => {
  const e = snap.entries && snap.entries[v];
  return e && e.h ? path.join(snap.objectDir, e.h) : null;
};

try {
  // ── 1) Layout per-workspace + cleanup tidak menghapus workspace lain ──
  const base1 = tmp('layout');
  const undoRoot1 = path.join(base1, 'undo');
  fs.mkdirSync(undoRoot1, { recursive: true });
  const rootA = mkRoot(base1, 'wsa');
  const rootB = mkRoot(base1, 'wsb');
  fs.writeFileSync(path.join(rootA, 'a.txt'), 'A0');
  fs.writeFileSync(path.join(rootB, 'b.txt'), 'B0');

  const vfsA = new VirtualFS('a', rootA, { undoFile: path.join(undoRoot1, 'undo_wsa.json') });
  const snapA = vfsA.snapshotWorkspace('A');
  const vfsB = new VirtualFS('b', rootB, { undoFile: path.join(undoRoot1, 'undo_wsb.json') });
  const snapB = vfsB.snapshotWorkspace('B');

  ok('snapshot A di ws/wsa', path.basename(path.dirname(snapA.dir)) === 'wsa', snapA.dir);
  ok('snapshot B di ws/wsb', path.basename(path.dirname(snapB.dir)) === 'wsb', snapB.dir);
  ok('marker container .ws dibuat', fs.existsSync(path.join(undoRoot1, 'ws', 'wsa', '.ws')));
  ok('object store dibuat', fs.existsSync(snapA.objectDir) && fs.existsSync(objectPath(snapA, '/a.txt')));

  // Restart workspace A (memicu orphan cleanup) → snapshot B harus selamat.
  const vfsA2 = new VirtualFS('a2', rootA, { undoFile: path.join(undoRoot1, 'undo_wsa.json') });
  ok('cleanup restart A tidak menghapus snapshot B', fs.existsSync(snapB.dir));
  ok('cleanup restart A tetap menyimpan snapshot A', fs.existsSync(snapA.dir));

  // ── 2) Restore tidak menghapus file tak dikenal ──
  fs.writeFileSync(path.join(rootA, 'a.txt'), 'CHANGED');
  fs.writeFileSync(path.join(rootA, 'external.txt'), 'created by another tool');
  vfsA2.restoreSnapshot(snapA);
  ok('file lama dipulihkan', read(path.join(rootA, 'a.txt')) === 'A0');
  ok('file tak dikenal TIDAK dihapus', fs.existsSync(path.join(rootA, 'external.txt')));
  ok('snapshot B masih utuh setelah restore A', fs.existsSync(snapB.dir));

  // ── 3) Batas ukuran file: file besar dilewati, manifest partial ──
  const base2 = tmp('limits');
  const undoRoot2 = path.join(base2, 'undo');
  fs.mkdirSync(undoRoot2, { recursive: true });
  const rootC = mkRoot(base2, 'wsc');
  fs.writeFileSync(path.join(rootC, 'small.txt'), 'small');
  fs.writeFileSync(path.join(rootC, 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 1));
  const vfsC = new VirtualFS('c', rootC, { undoFile: path.join(undoRoot2, 'undo_wsc.json') });
  const snapC = vfsC.snapshotWorkspace('C', { maxFileBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 });
  ok('file besar → partial', snapC.partial === true);
  ok('file besar tercatat di skipped', snapC.skipped.includes('/big.bin'), JSON.stringify(snapC.skipped));
  ok('file kecil punya object', fs.existsSync(objectPath(snapC, '/small.txt')));
  ok('file besar tidak masuk manifest', !snapC.entries['/big.bin']);

  fs.writeFileSync(path.join(rootC, 'small.txt'), 'MODIFIED');
  fs.writeFileSync(path.join(rootC, 'big.bin'), 'MODIFIED');
  vfsC.restoreSnapshot(snapC);
  ok('restore memulihkan file yang dibackup', read(path.join(rootC, 'small.txt')) === 'small');
  ok('file besar yang dilewati tidak diubah', read(path.join(rootC, 'big.bin')) === 'MODIFIED');

  // ── 4) Batas total byte ──
  const base3 = tmp('total');
  const undoRoot3 = path.join(base3, 'undo');
  fs.mkdirSync(undoRoot3, { recursive: true });
  const rootD = mkRoot(base3, 'wsd');
  fs.writeFileSync(path.join(rootD, 'f1.bin'), Buffer.alloc(600 * 1024, 1));
  fs.writeFileSync(path.join(rootD, 'f2.bin'), Buffer.alloc(600 * 1024, 2));
  const vfsD = new VirtualFS('d', rootD, { undoFile: path.join(undoRoot3, 'undo_wsd.json') });
  const snapD = vfsD.snapshotWorkspace('D', { maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 1000 * 1024 });
  ok('total byte → partial', snapD.partial === true);
  ok('byte snapshot <= batas total', snapD.bytes <= 1000 * 1024, String(snapD.bytes));
  ok('file kedua tercatat skipped', snapD.skipped.includes('/f2.bin'), JSON.stringify(snapD.skipped));

  // ── 5) Hapus hanya file manifest.created ──
  const base4 = tmp('created');
  const undoRoot4 = path.join(base4, 'undo');
  fs.mkdirSync(undoRoot4, { recursive: true });
  const rootE = mkRoot(base4, 'wse');
  fs.writeFileSync(path.join(rootE, 'base.txt'), 'base');
  const vfsE = new VirtualFS('e', rootE, { undoFile: path.join(undoRoot4, 'undo_wse.json') });
  const snapE = vfsE.snapshotWorkspace('E');
  fs.writeFileSync(path.join(rootE, 'made.txt'), 'made');
  vfsE.finalizeWorkspaceSnapshot(snapE);
  fs.writeFileSync(path.join(rootE, 'other.txt'), 'other');
  const vfsE2 = new VirtualFS('e-restarted', rootE, { undoFile: path.join(undoRoot4, 'undo_wse.json') });
  const restoredSnapE = vfsE2.popSnapshot();
  vfsE2.restoreSnapshot(restoredSnapE);
  ok('file baru sejak shell snapshot dihapus', !fs.existsSync(path.join(rootE, 'made.txt')));
  ok('file tak dikenal tetap ada', fs.existsSync(path.join(rootE, 'other.txt')));

  // ── 5b) Workspace kosong tetap bisa mendapat baseline undo ──
  const baseEmpty = tmp('empty');
  const rootEmpty = mkRoot(baseEmpty, 'empty-workspace');
  const vfsEmpty = new VirtualFS('empty', rootEmpty, { undoFile: path.join(baseEmpty, 'undo', 'undo_empty.json') });
  const emptySnapshot = vfsEmpty.snapshotWorkspace('empty workspace');
  fs.writeFileSync(path.join(rootEmpty, 'created.txt'), 'created by shell');
  vfsEmpty.finalizeWorkspaceSnapshot(emptySnapshot);
  vfsEmpty.restoreSnapshot(emptySnapshot);
  ok('workspace kosong dapat di-snapshot dan file baru dihapus', !fs.existsSync(path.join(rootEmpty, 'created.txt')));

  // ── 6) Dedupe: snapshot kedua hanya menambah object file yang berubah ──
  const base6 = tmp('dedupe');
  const undoRoot6 = path.join(base6, 'undo');
  fs.mkdirSync(undoRoot6, { recursive: true });
  const rootG = mkRoot(base6, 'wsg');
  const bigA = 'A'.repeat(4096);
  const bigB = 'B'.repeat(8192);
  fs.writeFileSync(path.join(rootG, 'f1.txt'), bigA);
  fs.writeFileSync(path.join(rootG, 'f2.txt'), bigB);
  const vfsG = new VirtualFS('g', rootG, { undoFile: path.join(undoRoot6, 'undo_wsg.json') });
  const snapG1 = vfsG.snapshotWorkspace('G1', { maxFileBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 });
  const h1 = snapG1.entries['/f1.txt'].h;
  const h2 = snapG1.entries['/f2.txt'].h;
  ok('snapshot pertama: 2 object', fs.readdirSync(snapG1.objectDir).length === 2);
  ok('snapshot pertama: byte = isi workspace', snapG1.bytes === bigA.length + bigB.length, String(snapG1.bytes));

  const bigA2 = 'A'.repeat(5000);
  fs.writeFileSync(path.join(rootG, 'f1.txt'), bigA2);
  const snapG2 = vfsG.snapshotWorkspace('G2', { maxFileBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 });
  ok('snapshot kedua hanya copy file berubah', snapG2.bytes === bigA2.length, String(snapG2.bytes));
  ok('file tak berubah memakai object lama', snapG2.entries['/f2.txt'].h === h2);
  ok('object file lama tetap ada', fs.existsSync(path.join(snapG1.objectDir, h1)));
  ok('object baru ditambahkan', fs.readdirSync(snapG1.objectDir).length === 3);
  ok('hash baru berbeda', snapG2.entries['/f1.txt'].h !== h1);

  vfsG.restoreSnapshot(snapG2);
  ok('restore snapshot kedua = isi terbaru', read(path.join(rootG, 'f1.txt')) === bigA2);
  ok('GC menghapus object tak terpakai', !fs.existsSync(path.join(snapG1.objectDir, snapG2.entries['/f1.txt'].h)));
  vfsG.restoreSnapshot(snapG1);
  ok('restore snapshot pertama = isi lama', read(path.join(rootG, 'f1.txt')) === bigA);

  // ── 7) Cleanup layout lama: orphan dihapus, yang dirujuk dipertahankan ──
  const base5 = tmp('legacy');
  const undoRoot5 = path.join(base5, 'undo');
  const legacyRef = path.join(undoRoot5, 'ws', 'ws_legacy_keep');
  const legacyOrphan = path.join(undoRoot5, 'ws', 'ws_legacy_gone');
  for (const d of [legacyRef, legacyOrphan]) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'x.txt'), 'x');
  }
  fs.writeFileSync(
    path.join(undoRoot5, 'undo_other.json'),
    JSON.stringify([{ kind: 'workspace', label: 'old', files: [], dir: legacyRef, ts: 1 }])
  );
  const rootF = mkRoot(base5, 'wsf');
  new VirtualFS('f', rootF, { undoFile: path.join(undoRoot5, 'undo_wsf.json') });
  ok('legacy snapshot yang dirujuk dipertahankan', fs.existsSync(legacyRef));
  ok('legacy snapshot orphan dihapus', !fs.existsSync(legacyOrphan));
} finally {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
