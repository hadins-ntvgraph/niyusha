/**
 * @fileoverview Benchmark task definitions
 *
 * @module bench-tasks
 */
'use strict';

// ── Benchmark Niyusha: 20 tugas nyata lintas kategori ──────────────────
// Tiap task punya fixture (files), prompt, dan cara menilai:
//   - verify : perintah shell; exit 0 = lulus (dijalankan SETELAH agent).
//   - check  : fungsi (ctx) => bool|{ok,why} untuk tugas read-only/inspeksi.
// ctx = { reply, read(path), exists(path), run(cmd), compactions, history }.
// `turns` (opsional) = beberapa prompt berurutan pada agent yang sama
// (uji kelanjutan/kompaksi).

const TEST = (body) => `'use strict';\nconst assert = require('assert');\n${body}\nconsole.log('OK');\n`;

const tasks = [
  {
    id: 'bug-add-operator',
    category: 'bugfix',
    title: 'Operator salah pada add()',
    files: {
      'math.js': '\'use strict\';\nfunction add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n',
      'test.js': TEST('const { add } = require(\'./math\');\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-1, 1), 0);'),
    },
    prompt: 'Test di proyek ini gagal. Jalankan `node test.js`, temukan akar masalahnya, perbaiki, lalu verifikasi sampai hijau.',
    verify: 'node test.js',
  },
  {
    id: 'bug-loop-offbyone',
    category: 'bugfix',
    title: 'Off-by-one pada range()',
    files: {
      'range.js': '\'use strict\';\nfunction range(n) {\n  const out = [];\n  for (let i = 0; i <= n; i++) out.push(i);\n  return out;\n}\nmodule.exports = { range };\n',
      'test.js': TEST('const { range } = require(\'./range\');\nassert.deepStrictEqual(range(3), [0, 1, 2]);\nassert.deepStrictEqual(range(0), []);'),
    },
    prompt: 'Jalankan `node test.js`. Perbaiki bug-nya tanpa mengubah kontrak fungsi, lalu pastikan hijau.',
    verify: 'node test.js',
  },
  {
    id: 'bug-undefined-var',
    category: 'bugfix',
    title: 'Variabel salah ketik membuat ReferenceError',
    files: {
      'greet.js': '\'use strict\';\nfunction greet(name) {\n  return \'Hello, \' + nam;\n}\nmodule.exports = { greet };\n',
      'test.js': TEST('const { greet } = require(\'./greet\');\nassert.strictEqual(greet(\'Ann\'), \'Hello, Ann\');'),
    },
    prompt: 'Menjalankan `node test.js` error. Cari penyebabnya dan perbaiki, lalu verifikasi.',
    verify: 'node test.js',
  },
  {
    id: 'bug-null-guard',
    category: 'bugfix',
    title: 'Tidak menangani null',
    files: {
      'len.js': '\'use strict\';\nfunction len(s) {\n  return s.length;\n}\nmodule.exports = { len };\n',
      'test.js': TEST('const { len } = require(\'./len\');\nassert.strictEqual(len(null), 0);\nassert.strictEqual(len(\'abc\'), 3);'),
    },
    prompt: 'Test gagal. Perbaiki `len` agar null/undefined menghasilkan 0, string tetap panjangnya. Verifikasi hijau.',
    verify: 'node test.js',
  },
  {
    id: 'bug-sort-numeric',
    category: 'bugfix',
    title: 'Sort angka secara leksikografis',
    files: {
      'sort.js': '\'use strict\';\nfunction sortNums(a) {\n  return a.slice().sort();\n}\nmodule.exports = { sortNums };\n',
      'test.js': TEST('const { sortNums } = require(\'./sort\');\nassert.deepStrictEqual(sortNums([10, 2, 1]), [1, 2, 10]);'),
    },
    prompt: 'Jalankan test, perbaiki pengurutan agar numerik, verifikasi hijau.',
    verify: 'node test.js',
  },
  {
    id: 'multi-rename-symbol',
    category: 'multifile',
    title: 'Ganti nama simbol lintas file',
    files: {
      'util.js': '\'use strict\';\nfunction calc(x) {\n  return x * 2;\n}\nmodule.exports = { calc };\n',
      'app.js': '\'use strict\';\nconst { calc } = require(\'./util\');\nfunction run(x) {\n  return calc(x) + 1;\n}\nmodule.exports = { run };\n',
      'test.js': TEST('const { compute } = require(\'./util\');\nconst { run } = require(\'./app\');\nassert.strictEqual(compute(3), 6);\nassert.strictEqual(run(3), 7);'),
    },
    prompt: 'Ganti nama fungsi `calc` menjadi `compute` di seluruh proyek (util.js dan pemakaian di app.js). Jangan ubah perilaku. Pastikan `node test.js` hijau.',
    verify: 'node test.js',
  },
  {
    id: 'multi-config-key',
    category: 'multifile',
    title: 'Tambah key konfigurasi dan pakai di file lain',
    files: {
      'config.js': '\'use strict\';\nmodule.exports = { retries: 2 };\n',
      'client.js': '\'use strict\';\nconst cfg = require(\'./config\');\nfunction attempts() {\n  return cfg.retries;\n}\nfunction timeoutMs() {\n  return 0;\n}\nmodule.exports = { attempts, timeoutMs };\n',
      'test.js': TEST('const cfg = require(\'./config\');\nconst { attempts, timeoutMs } = require(\'./client\');\nassert.strictEqual(cfg.timeout, 5000);\nassert.strictEqual(attempts(), 2);\nassert.strictEqual(timeoutMs(), 5000);'),
    },
    prompt: 'Tambahkan `timeout: 5000` ke config.js, lalu buat `client.timeoutMs()` mengembalikan nilai itu. Verifikasi `node test.js` hijau.',
    verify: 'node test.js',
  },
  {
    id: 'multi-import-path',
    category: 'multifile',
    title: 'Perbaiki path import yang salah',
    files: {
      'lib/a.js': '\'use strict\';\nmodule.exports = { val: 1 };\n',
      'lib/b.js': '\'use strict\';\nconst a = require(\'./a\');\nmodule.exports = { val: a.val + 1 };\n',
      'index.js': '\'use strict\';\nconst a = require(\'./libs/a\');\nconst b = require(\'./lib/b\');\nmodule.exports = { a: a.val, b: b.val };\n',
      'test.js': TEST('const idx = require(\'./index\');\nassert.strictEqual(idx.a, 1);\nassert.strictEqual(idx.b, 2);'),
    },
    prompt: 'Menjalankan `node test.js` gagal karena modul tidak ditemukan. Perbaiki path import yang salah, lalu verifikasi.',
    verify: 'node test.js',
  },
  {
    id: 'feat-cli-upper',
    category: 'feature',
    title: 'Tambah flag CLI --upper',
    files: {
      'cli.js': '\'use strict\';\nconst arg = process.argv[2] || \'\';\nprocess.stdout.write(arg + \'\\n\');\n',
    },
    prompt: 'Modifikasi cli.js: jika argumen pertama adalah `--upper`, cetak argumen kedua dalam HURUF BESAR; jika bukan, cetak argumen pertama apa adanya. Contoh: `node cli.js --upper hi` -> `HI`; `node cli.js hi` -> `hi`.',
    verify: 'test "$(node cli.js --upper hi)" = "HI" && test "$(node cli.js hi)" = "hi"',
  },
  {
    id: 'feat-dedupe',
    category: 'feature',
    title: 'Implementasi dedupe()',
    files: {
      'array.js': '\'use strict\';\nfunction dedupe(a) {\n  throw new Error(\'not implemented\');\n}\nmodule.exports = { dedupe };\n',
      'test.js': TEST('const { dedupe } = require(\'./array\');\nassert.deepStrictEqual(dedupe([1, 1, 2, 3, 3]), [1, 2, 3]);\nassert.deepStrictEqual(dedupe([]), []);'),
    },
    prompt: 'Implementasikan `dedupe` agar menghapus duplikat dengan mempertahankan urutan kemunculan pertama. Verifikasi `node test.js` hijau.',
    verify: 'node test.js',
  },
  {
    id: 'feat-email-validator',
    category: 'feature',
    title: 'Implementasi isEmail()',
    files: {
      'validate.js': '\'use strict\';\nfunction isEmail(s) {\n  throw new Error(\'not implemented\');\n}\nmodule.exports = { isEmail };\n',
      'test.js': TEST('const { isEmail } = require(\'./validate\');\nassert.strictEqual(isEmail(\'a@b.com\'), true);\nassert.strictEqual(isEmail(\'nope\'), false);\nassert.strictEqual(isEmail(\'a@b\'), false);'),
    },
    prompt: 'Implementasikan `isEmail` sederhana (harus ada `@` dan domain berisi `.`). Verifikasi `node test.js`.',
    verify: 'node test.js',
  },
  {
    id: 'feat-json-store',
    category: 'feature',
    title: 'Implementasi simpan/muat JSON',
    files: {
      'store.js': '\'use strict\';\nconst fs = require(\'fs\');\nfunction save(p, obj) {\n  throw new Error(\'not implemented\');\n}\nfunction load(p) {\n  throw new Error(\'not implemented\');\n}\nmodule.exports = { save, load };\n',
      'test.js': TEST('const os = require(\'os\');\nconst path = require(\'path\');\nconst { save, load } = require(\'./store\');\nconst p = path.join(os.tmpdir(), \'bench-store-\' + Date.now() + \'.json\');\nsave(p, { a: 1, b: [2, 3] });\nassert.deepStrictEqual(load(p), { a: 1, b: [2, 3] });'),
    },
    prompt: 'Implementasikan `save(p,obj)` (tulis JSON ke file) dan `load(p)` (baca & parse). Verifikasi `node test.js`.',
    verify: 'node test.js',
  },
  {
    id: 'read-entry-point',
    category: 'comprehension',
    title: 'Temukan file yang mendefinisikan start()',
    readonly: true,
    files: {
      'index.js': '\'use strict\';\nconst app = require(\'./app\');\napp.start();\n',
      'app.js': '\'use strict\';\nfunction start() {\n  return \'started\';\n}\nmodule.exports = { start };\n',
      'helper.js': '\'use strict\';\nmodule.exports = { noop() {} };\n',
    },
    prompt: 'Di file mana fungsi `start` didefinisikan, dan apa yang dikembalikannya? Jawab singkat dengan nama file.',
    check: (ctx) => ({ ok: /app\.js/.test(ctx.reply), why: 'jawaban harus menyebut app.js' }),
  },
  {
    id: 'read-locate-bug',
    category: 'comprehension',
    title: 'Lokalisir bug + nomor baris',
    readonly: true,
    files: {
      'utils.js': '\'use strict\';\nfunction divide(a, b) {\n  return a / b;\n}\nfunction safeDivide(a, b) {\n  return divide(a, b) * 2;\n}\nmodule.exports = { divide, safeDivide };\n',
      'main.js': '\'use strict\';\nconst { safeDivide } = require(\'./utils\');\nconsole.log(safeDivide(10, 0));\n',
    },
    prompt: 'Ada potensi bug pembagian nol yang mengembalikan Infinity/NaN. Sebutkan nama file dan nomor baris fungsi `divide` yang bermasalah.',
    check: (ctx) => ({ ok: /utils\.js/.test(ctx.reply) && /(^|\D)3(\D|$)/.test(ctx.reply), why: 'harus menyebut utils.js dan baris 3' }),
  },
  {
    id: 'read-exported-api',
    category: 'comprehension',
    title: 'Sebutkan seluruh fungsi yang diekspor',
    readonly: true,
    files: {
      'api.js': '\'use strict\';\nfunction add(a, b) { return a + b; }\nfunction sub(a, b) { return a - b; }\nfunction mul(a, b) { return a * b; }\nmodule.exports = { add, sub, mul };\n',
    },
    prompt: 'Sebutkan semua nama fungsi yang diekspor oleh api.js.',
    check: (ctx) => ({
      ok: ['add', 'sub', 'mul'].every((n) => new RegExp(`\\b${n}\\b`).test(ctx.reply)),
      why: 'harus menyebut add, sub, mul',
    }),
  },
  {
    id: 'err-divide-zero',
    category: 'errorhandling',
    title: 'Lempar error saat pembagian nol',
    files: {
      'div.js': '\'use strict\';\nfunction div(a, b) {\n  return a / b;\n}\nmodule.exports = { div };\n',
      'test.js': TEST('const { div } = require(\'./div\');\nassert.strictEqual(div(6, 3), 2);\nassert.throws(() => div(1, 0), /zero/i);'),
    },
    prompt: 'Ubah `div` agar melempar Error berisi kata "zero" ketika pembagi 0, perilaku lain tetap. Verifikasi `node test.js`.',
    verify: 'node test.js',
  },
  {
    id: 'err-missing-file',
    category: 'errorhandling',
    title: 'Tangani file yang tidak ada',
    files: {
      'reader.js': '\'use strict\';\nconst fs = require(\'fs\');\nfunction read(p) {\n  return fs.readFileSync(p, \'utf8\');\n}\nmodule.exports = { read };\n',
      'data.txt': 'hi',
      'test.js': TEST('const { read } = require(\'./reader\');\nassert.strictEqual(read(\'data.txt\'), \'hi\');\nassert.strictEqual(read(\'tidak-ada.txt\'), null);'),
    },
    prompt: 'Buat `read` mengembalikan null (bukan melempar) bila file tidak ada, tapi tetap membaca file yang ada. Verifikasi `node test.js`.',
    verify: 'node test.js',
  },
  {
    id: 'err-json-parse',
    category: 'errorhandling',
    title: 'Tangani JSON tidak valid',
    files: {
      'parser.js': '\'use strict\';\nfunction parse(s) {\n  return JSON.parse(s);\n}\nmodule.exports = { parse };\n',
      'test.js': TEST('const { parse } = require(\'./parser\');\nassert.deepStrictEqual(parse(\'{"a":1}\'), { a: 1 });\nassert.strictEqual(parse(\'{bad\'), null);'),
    },
    prompt: 'Buat `parse` mengembalikan null bila JSON tidak valid, tapi tetap parse JSON valid. Verifikasi `node test.js`.',
    verify: 'node test.js',
  },
  {
    id: 'continue-build-then-test',
    category: 'continuation',
    title: 'Buat lalu verifikasi (dua giliran)',
    timeoutMs: 150000,
    maxSteps: 12,
    files: { 'README.md': '# proyek kosong\n' },
    turns: [
      'Buat file `sum.js` berisi fungsi `sum(a, b)` yang menjumlahkan dua angka (CommonJS), dan file `test.js` yang menguji sum(2,3)===5 serta sum(-1,1)===0 memakai assert. Jangan jalankan apa pun dulu.',
      'Lanjutkan sekarang: jalankan `node test.js` dan pastikan hijau. Jika gagal, perbaiki dan ulangi sampai hijau.',
    ],
    prompt: 'Buat file sum.js dan test.js, lalu verifikasi.',
    verify: 'node test.js',
  },
  {
    id: 'compact-big-file',
    category: 'compaction',
    title: 'Perbaiki bug di file besar (uji kompaksi)',
    config: { contextBudget: 1500 },
    files: {
      'big.js': '\'use strict\';\n' + Array.from({ length: 500 }, (_, i) => `function f${i}(x) { return x + ${i}; }`).join('\n') + '\nfunction target(x) {\n  return x - 1;\n}\nmodule.exports = { target, f0 };\n',
      'test.js': TEST('const { target } = require(\'./big\');\nassert.strictEqual(target(5), 6);'),
    },
    prompt: 'Ada bug pada fungsi `target` di big.js (harus menambah 1, bukan mengurangi). Perbaiki dan verifikasi `node test.js` hijau. Hati-hati: file ini besar.',
    verify: 'node test.js',
  },
  {
    id: 'feat-multifile-counter',
    category: 'feature',
    title: 'Fitur multi-file: counter + laporan',
    files: {
      'counter.js': '\'use strict\';\nconst c = { n: 0 };\nfunction inc() {\n  c.n += 1;\n  return c.n;\n}\nfunction value() {\n  return c.n;\n}\nmodule.exports = { inc, value };\n',
      'report.js': '\'use strict\';\nconst counter = require(\'./counter\');\nfunction text() {\n  return \'count=\' + counter.n;\n}\nmodule.exports = { text };\n',
      'test.js': TEST('const counter = require(\'./counter\');\nconst report = require(\'./report\');\nassert.strictEqual(report.text(), \'count=0\');\ncounter.inc();\ncounter.inc();\nassert.strictEqual(report.text(), \'count=2\');'),
    },
    prompt: 'Pastikan integrasi counter.js dan report.js berjalan: report.text() mencerminkan nilai counter terkini. Verifikasi `node test.js` hijau (perbaiki bila perlu).',
    verify: 'node test.js',
  },
];

module.exports = tasks;
