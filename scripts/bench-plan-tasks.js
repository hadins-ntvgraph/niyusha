/**
 * @fileoverview Benchmark task definitions
 *
 * @module bench-plan-tasks
 */
'use strict';

// ── Benchmark REASONING/PLANNING Niyusha ───────────────────────────────
// Fokus: apakah agent merencanakan dengan baik (mode plan), bertanya saat
// ambigu, tidak berubah file saat diminta merencana, menghasilkan todo untuk
// tugas multi-langkah, dan menjaga alur rapi (read -> edit -> verify).
// Dipakai lewat: node scripts/bench.js --tasks scripts/bench-plan-tasks.js ...

const WRITE = new Set(['write_file', 'edit_file', 'delete_file', 'rename_file', 'create_directory']);
const VERIFY = new Set(['run_command', 'run_code']);
const firstIdx = (arr, set) => arr.findIndex((n) => set.has(n));
const lastIdx = (arr, set) => {
  for (let i = arr.length - 1; i >= 0; i--) if (set.has(arr[i])) return i;
  return -1;
};
const unchanged = (ctx, names) => names.every((f) => ctx.read(f) === ctx.orig(f));

const expressFiles = {
  'app.js': '\'use strict\';\nconst express = require(\'express\');\nconst routes = require(\'./routes\');\nconst app = express();\napp.use(\'/\', routes);\nmodule.exports = app;\n',
  'routes.js': '\'use strict\';\nconst express = require(\'express\');\nconst router = express.Router();\nrouter.get(\'/health\', (req, res) => res.json({ ok: true }));\nmodule.exports = router;\n',
  'README.md': '# Demo API\n\nEndpoints: GET /health\n',
};

const bugFiles = {
  'math.js': '\'use strict\';\nfunction add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n',
  'test.js': '\'use strict\';\nconst assert = require(\'assert\');\nconst { add } = require(\'./math\');\nassert.strictEqual(add(2, 3), 5);\nconsole.log(\'OK\');\n',
};

const taskFiles = {
  'package.json': '{\n  "name": "todo-app",\n  "version": "1.0.0",\n  "scripts": { "test": "node test.js" }\n}\n',
  'items.js': '\'use strict\';\nconst items = [];\nfunction addItem(text) {\n  items.push({ text, done: false });\n}\nfunction list() {\n  return items;\n}\nmodule.exports = { addItem, list };\n',
  'cli.js': '\'use strict\';\nconst { addItem, list } = require(\'./items\');\nconst cmd = process.argv[2];\nif (cmd === \'add\') addItem(process.argv[3] || \'\');\nif (cmd === \'list\') process.stdout.write(list().map((i) => i.text).join(\'\\n\') + \'\\n\');\n',
  'test.js': '\'use strict\';\nconst assert = require(\'assert\');\nconst { addItem, list } = require(\'./items\');\nconst { toCsv } = require(\'./export\');\naddItem(\'a\');\naddItem(\'b\');\nassert.strictEqual(list().length, 2);\nassert.strictEqual(toCsv(), \'text,done\\na,false\\nb,false\\n\');\nconsole.log(\'OK\');\n',
};

const tasks = [
  {
    id: 'plan-mode-no-mutation',
    category: 'planning',
    title: 'Mode plan: hasilkan RENCANA tanpa ubah file',
    planMode: true,
    files: expressFiles,
    prompt: 'Rencanakan cara menambahkan autentikasi (login/register) ke aplikasi Express ini. Jangan mengubah file — susun rencana saja.',
    check: (ctx) => {
      const hasPlan = /#\s*RENCANA/i.test(ctx.reply);
      const wrote = ctx.toolSeq.some((n) => WRITE.has(n));
      const filesIntact = unchanged(ctx, Object.keys(expressFiles));
      return { ok: hasPlan && !wrote && filesIntact, why: `plan=${hasPlan} wrote=${wrote} intact=${filesIntact}` };
    },
  },
  {
    id: 'plan-mode-detailed',
    category: 'planning',
    title: 'Mode plan: rencana konkret + verifikasi',
    planMode: true,
    files: expressFiles,
    prompt: 'Rencanakan refactor: pisahkan koneksi database ke modul sendiri, tambah error-handler terpusat, dan pastikan ada verifikasi. Rencana saja.',
    check: (ctx) => {
      const hasPlan = /#\s*RENCANA/i.test(ctx.reply);
      const moduleMentions = (ctx.reply.match(/\.js\b/g) || []).length;
      const hasVerify = /(test|verifikasi|verify|node |curl|npm )/i.test(ctx.reply);
      const wrote = ctx.toolSeq.some((n) => WRITE.has(n));
      return {
        ok: hasPlan && moduleMentions >= 2 && hasVerify && !wrote,
        why: `plan=${hasPlan} .js=${moduleMentions} verify=${hasVerify} wrote=${wrote}`,
      };
    },
  },
  {
    id: 'plan-ambiguous-ask',
    category: 'planning',
    title: 'Tugas ambigu: tanya dulu, jangan menebak',
    files: {
      'config.dev.js': '\'use strict\';\nmodule.exports = { timeout: 5000, retries: 2 };\n',
      'config.prod.js': '\'use strict\';\nmodule.exports = { timeout: 30000, retries: 5 };\n',
    },
    prompt: 'Tolong ubah nilai timeout-nya.',
    check: (ctx) => {
      const asks = /\?/.test(ctx.reply);
      const wrote = ctx.toolSeq.some((n) => WRITE.has(n));
      return { ok: asks && !wrote, why: `asks=${asks} wrote=${wrote}` };
    },
  },
  {
    id: 'plan-todos-multistep',
    category: 'planning',
    title: 'Tugas multi-langkah: munculkan todo',
    files: taskFiles,
    prompt: 'Implementasikan fitur "export CSV" di proyek ini: buat modul export.js dengan fungsi toCsv(), sambungkan ke CLI, lalu pastikan `node test.js` hijau. Ini tugas multi-langkah.',
    check: (ctx) => {
      const produced = (ctx.tools.set_todos || 0) > 0 || (ctx.todos && ctx.todos.length > 0);
      const test = ctx.run('node test.js');
      const n = ctx.todos ? ctx.todos.length : 0;
      return { ok: produced && test.exit === 0, why: `todos=${n} produced=${produced} test.exit=${test.exit}` };
    },
  },
  {
    id: 'plan-order-read-before-edit',
    category: 'planning',
    title: 'Alur: baca dulu sebelum mengedit',
    files: bugFiles,
    prompt: 'Jalankan `node test.js`, perbaiki penyebabnya, lalu verifikasi sampai hijau.',
    check: (ctx) => {
      const r = firstIdx(ctx.toolSeq, new Set(['read_file']));
      const w = firstIdx(ctx.toolSeq, WRITE);
      const test = ctx.run('node test.js');
      return { ok: r !== -1 && w !== -1 && r < w && test.exit === 0, why: `read@${r} write@${w} test.exit=${test.exit}` };
    },
  },
  {
    id: 'plan-verify-before-stop',
    category: 'planning',
    title: 'Alur: verifikasi setelah edit sebelum berhenti',
    files: bugFiles,
    prompt: 'Perbaiki bug pada proyek ini. Setelah memperbaiki, PASTIKAN benar dengan menjalankan test — jangan berhenti sebelum yakin.',
    check: (ctx) => {
      const w = lastIdx(ctx.toolSeq, WRITE);
      const v = lastIdx(ctx.toolSeq, VERIFY);
      return { ok: w !== -1 && v !== -1 && v > w, why: `lastWrite@${w} lastVerify@${v} seq=${ctx.toolSeq.join('>')}` };
    },
  },
];

module.exports = tasks;
