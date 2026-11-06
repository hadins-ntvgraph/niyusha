'use strict';

// ── Tes efisiensi tool: edit_file (viaTrim), read_file (limit), grep (path) ──
// R1 limit · R3 fuzzy trim · R5 grep path filter — tanpa jaringan/API key.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { Agent } = require(path.join(__dirname, '..', 'bin/ai'));
const { VirtualFS, applyEdit, similarLines } = require(path.join(__dirname, '..', 'bin/vfs'));

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

(async () => {
  // ── applyEdit: exact / CRLF / viaTrim / ambiguitas ──
  const exact = applyEdit('const a = 1;\nconst b = 2;\n', 'const a = 1;', 'const a = 9;');
  ok('exact: ok', exact.status === 'ok' && exact.content === 'const a = 9;\nconst b = 2;\n');

  const crlf = applyEdit('x\r\ny\r\n', 'x\ny', 'z');
  ok('CRLF: viaEol', crlf.status === 'ok' && crlf.viaEol === true && crlf.content === 'z\r\n');

  const src = 'function f() {\n  return 1;\n}\n';
  const trim = applyEdit(src, '  return 1;  \n}', '  return 2;\n}');
  ok(
    'viaTrim: drift spasi akhir baris tertangani',
    trim.status === 'ok' && trim.viaTrim === true && trim.content === 'function f() {\n  return 2;\n}\n',
    JSON.stringify(trim)
  );

  const amb = applyEdit('a  \nb\na\n', 'a   ', 'Q');
  ok('viaTrim: menolak bila hasil norm ambigu (2 kandidat)', amb.status === 'notfound', JSON.stringify(amb));

  const noDrift = applyEdit(src, 'return 1;', 'return 3;');
  ok('viaTrim tidak aktif pada match exact biasa', noDrift.status === 'ok' && !noDrift.viaTrim);

  ok('similarLines ter-export', typeof similarLines === 'function');

  // ── Agent + VFS overlay ──
  const vfs = new VirtualFS('t', os.tmpdir());
  const agent = new Agent({ vfs, cwd: '/', config: { baseUrl: 'https://example.com/v1', apiKey: 'x', model: 'm', provider: 'openrouter' } });

  // ── R1: read_file param limit ──
  const lines10 = Array.from({ length: 10 }, (_, i) => `baris-${i + 1}`).join('\n');
  vfs.write('/kecil.txt', lines10);
  const r4 = await agent.executeTool('read_file', { path: '/kecil.txt', limit: 4 });
  ok('read_file limit=4 → BARIS 1-4', /\[BARIS 1-4 dari 10\]/.test(r4), r4.slice(0, 60));
  ok('read_file limit=4 → NEXT_OFFSET: 4', /\[NEXT_OFFSET: 4\]/.test(r4));

  const lines250 = Array.from({ length: 250 }, (_, i) => `L${i + 1}`).join('\n');
  vfs.write('/besar.txt', lines250);
  const rDef = await agent.executeTool('read_file', { path: '/besar.txt' });
  ok('read_file default tetap 200 baris', /\[BARIS 1-200 dari 250\]/.test(rDef) && /\[NEXT_OFFSET: 200\]/.test(rDef));

  const rBig = await agent.executeTool('read_file', { path: '/besar.txt', limit: 999 });
  ok('read_file limit dipatok maks 400', /\[BARIS 1-400 dari 250\]/.test(rBig) || /\[BARIS 1-250 dari 250 — SELESAI\]/.test(rBig), rBig.slice(0, 50));

  // ── R3: edit_file via executeTool (jalur VFS) ──
  vfs.write('/edit.txt', 'const x = 1;\nconst y = 2;\n');
  const e1 = await agent.executeTool('edit_file', { path: '/edit.txt', old_str: 'const x = 1;  \n', new_str: 'const x = 11;\n' });
  ok('edit_file viaTrim lewat executeTool', /staged edit/.test(e1) && /\[trim\]/.test(e1), e1);
  ok('isi hasil edit benar', vfs.read('/edit.txt') === 'const x = 11;\nconst y = 2;\n', JSON.stringify(vfs.read('/edit.txt')));

  // ── R5: grep_search path filter ──
  vfs.write('/src/a.js', 'const needleA = 1;');
  vfs.write('/lib/b.js', 'const needleB = 2;');
  const gAll = await agent.executeTool('grep_search', { pattern: 'needle' });
  ok('grep tanpa path → semua file', gAll.includes('/src/a.js') && gAll.includes('/lib/b.js'), JSON.stringify(gAll));
  const gSrc = await agent.executeTool('grep_search', { pattern: 'needle', path: 'src' });
  ok('grep path=src → hanya /src/a.js', gSrc.includes('/src/a.js') && !gSrc.includes('/lib/b.js'), JSON.stringify(gSrc));

  // ── R6: grep robustness ──
  vfs.write('/src2/c.js', 'const needleC = 3;');
  const gStrict = await agent.executeTool('grep_search', { pattern: 'needle', path: 'src' });
  ok('grep path=src tidak mencocokkan /src2', gStrict.includes('/src/a.js') && !gStrict.includes('/src2/c.js'), JSON.stringify(gStrict));

  const gDot = await agent.executeTool('grep_search', { pattern: 'needleA', path: './src' });
  ok('grep path "./src" dinormalisasi', gDot.includes('/src/a.js') && !gDot.includes('/lib/b.js'), JSON.stringify(gDot));

  const gFile = await agent.executeTool('grep_search', { pattern: 'needleB', path: 'lib/b.js' });
  ok('grep path file spesifik', gFile.includes('/lib/b.js') && !gFile.includes('/src/a.js'), JSON.stringify(gFile));

  const gGlob = await agent.executeTool('grep_search', { pattern: 'needleA', path: 'src/*.js' });
  ok('grep path mendukung glob', gGlob.includes('/src/a.js') && !gGlob.includes('/lib/b.js'), JSON.stringify(gGlob));

  const gHost = await agent.executeTool('grep_search', { pattern: 'needleA', path: path.join(os.tmpdir(), 'src') });
  ok('grep path host absolut dipetakan ke VFS', gHost.includes('/src/a.js'), JSON.stringify(gHost));

  const gTypo = await agent.executeTool('grep_search', { pattern: 'needle', path: 'sr' });
  ok('grep path typo → ERROR + saran', /^ERROR:/.test(gTypo) && /Mungkin maksud/.test(gTypo), JSON.stringify(gTypo));

  vfs.write('/src/paren.js', 'callNeedle(x);');
  const gLit = await agent.executeTool('grep_search', { pattern: 'callNeedle(', path: 'src' });
  ok('grep regex invalid → fallback literal + catatan', /teks literal/.test(gLit) && gLit.includes('/src/paren.js'), JSON.stringify(gLit));

  const gEmpty = await agent.executeTool('grep_search', { pattern: '   ' });
  ok('grep pola kosong ditolak', /^ERROR:/.test(gEmpty), JSON.stringify(gEmpty));

  const gMissing = await agent.executeTool('grep_search', { pattern: 'needle', path: 'tidak-ada' });
  ok('grep path tidak ada → ERROR (bukan hasil kosong)', /^ERROR:/.test(gMissing), JSON.stringify(gMissing));

  vfs.write('/crlf.txt', 'foo\r\nbar\r\n');
  const gCrlf = await agent.executeTool('grep_search', { pattern: 'foo$', path: 'crlf.txt' });
  ok('grep CRLF: anchor $ cocok & tanpa \\r', gCrlf.includes('/crlf.txt:1: foo') && !gCrlf.includes('\r'), JSON.stringify(gCrlf));

  vfs.write('/multi.txt', 'alpha\nbeta\ngamma\n');
  const gMulti = await agent.executeTool('grep_search', { pattern: 'alpha\\nbeta', path: 'multi.txt' });
  ok('grep pola multi-baris', /multi\.txt:1: alpha/.test(gMulti) && /\+1 baris/.test(gMulti), JSON.stringify(gMulti));

  vfs.write('/multicrlf.txt', 'alpha\r\nbeta\r\n');
  const gMultiCrlf = await agent.executeTool('grep_search', { pattern: 'alpha\\nbeta', path: 'multicrlf.txt' });
  ok('grep multi-baris pada CRLF', /multicrlf\.txt:1: alpha/.test(gMultiCrlf), JSON.stringify(gMultiCrlf));

  vfs.write('/panjang.txt', 'needle ' + 'x'.repeat(2000));
  const gLong = await agent.executeTool('grep_search', { pattern: 'needle', path: 'panjang.txt' });
  ok(
    'grep baris panjang dipotong',
    gLong.includes('char]') && Math.max(...gLong.split('\n').map((l) => l.length)) < 400,
    JSON.stringify(gLong.slice(0, 120))
  );

  vfs.write('/banyak.txt', Array.from({ length: 300 }, (_, i) => `needle ${i} ${'x'.repeat(100)}`).join('\n'));
  const gBudget = await agent.executeTool('grep_search', { pattern: 'needle', path: 'banyak.txt' });
  ok('grep budget karakter membatasi output', gBudget.length <= 6000 && /dipotong/.test(gBudget), String(gBudget.length));

  const gCase = vfs.grep('NEEDLEA', 'src', { caseSensitive: true });
  ok('grep caseSensitive opsional', !gCase.some((l) => l.includes('/src/a.js')), JSON.stringify(gCase));

  // Cache daftar file: file nyata baru harus terlihat setelah invalidate.
  const cacheName = `niyusha-grep-${process.pid}-${Date.now()}.txt`;
  const cacheReal = path.join(os.tmpdir(), cacheName);
  const vfsCache = new VirtualFS('t-cache', os.tmpdir());
  vfsCache.grep('zzz', cacheName);
  fs.writeFileSync(cacheReal, 'zzneedlez');
  const stale = vfsCache.grep('zzneedlez', cacheName);
  vfsCache.invalidateFileCache();
  const fresh = vfsCache.grep('zzneedlez', cacheName);
  try {
    fs.unlinkSync(cacheReal);
  } catch {}
  ok('grep cache basi terdeteksi', /^ERROR:/.test(stale[0]), JSON.stringify(stale));
  ok('grep invalidateFileCache melihat file baru', fresh.some((l) => l.includes(cacheName)), JSON.stringify(fresh));

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('ERROR', e);
  process.exitCode = 1;
});
