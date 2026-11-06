'use strict';

// ── E2E nyata: buat website besar via provider asli (NIM) ────────────────
// Bukti ketahanan: build landing page premium (write bertahap) + ronde revisi.
// Asersi: file utuh & besar, revisi masuk, TIDAK ada error [run] baru di
// logs.jsonl, jawaban tidak "berhenti tanpa output", maxTokens sudah 8192.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, providerInfo } = require(path.join(__dirname, '..', 'bin', 'config'));
const { Agent } = require(path.join(__dirname, '..', 'bin', 'ai'));
const { VirtualFS } = require(path.join(__dirname, '..', 'bin', 'vfs'));

const LOGS = path.join(require('os').homedir(), '.niyusha', 'logs.jsonl');
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

const readLogs = () => {
  try {
    return fs.readFileSync(LOGS, 'utf8');
  } catch {
    return '';
  }
};

const fmtMs = (ms) => (ms >= 10000 ? `${(ms / 1000).toFixed(0)}s` : `${(ms / 1000).toFixed(1)}s`);

(async () => {
  const cfg = loadConfig();
  const want = (process.argv[2] || '').trim();
  if (want && want !== cfg.provider) {
    const preset = providerInfo(want);
    if (!preset) {
      console.log(`SKIP: provider tak dikenal: ${want}`);
      process.exitCode = 1;
      return;
    }
    cfg.provider = want;
    cfg.providerInfo = preset;
    cfg.baseUrl = preset.baseUrl;
    cfg._baseOverride = false;
    cfg.apiKey = (cfg.apiKeys || {})[want] || process.env.NIYUSHA_API_KEY || cfg.apiKey;
    cfg.model = (cfg.models || {})[want] || preset.model;
  }
  console.log(`provider=${cfg.provider} model=${cfg.model} maxTokens=${cfg.maxTokens} streaming=${cfg.streaming}`);
  if (!cfg.apiKey || !cfg.baseUrl) {
    console.log('SKIP: butuh API key untuk provider tsb di ~/.niyusha/config.json');
    process.exitCode = 1;
    return;
  }

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-e2e-'));
  console.log(`workspace: ${ws}`);
  const logsBefore = readLogs();

  const vfs = new VirtualFS('e2e', ws);
  const agent = new Agent({ vfs, cwd: '/', config: cfg });
  const t0 = Date.now();
  const deadline = () => Date.now() - t0;
  const signal = AbortSignal.timeout(20 * 60 * 1000);

  const onTool = (name, a) => {
    const head =
      a && typeof a === 'object'
        ? String(a.text || a.command || a.path || JSON.stringify(a).slice(0, 110)).replace(/\s+/g, ' ').slice(0, 110)
        : String(a).slice(0, 110);
    console.log(`  [${fmtMs(deadline())}] ${name}: ${head}`);
  };

  let streamChars = 0;
  let lastBeat = 0;
  const onDelta = (d) => {
    if (d.text) streamChars += d.text.length;
    if (d.reasoning) streamChars += d.reasoning.length;
    const now = Date.now();
    if (now - lastBeat > 3000) {
      lastBeat = now;
      console.log(`  [${fmtMs(deadline())}] stream… ${streamChars} chars`);
    }
  };

  console.log('\n=== RONDE 1: build landing page premium ===');
  let ans1 = '';
  try {
    ans1 = await agent.run(
      'Buatkan website landing page premium untuk "NTVGraph × Niyusha" — satu berkas index.html ' +
        '(HTML + CSS + JS embedded dalam satu file, minimal 700 baris, tema gelap futuristik). ' +
        'Wajib ada: hero (headline + subheadline + 2 CTA), grid 6 fitur, showcase 3 kartu produk, ' +
        'pricing 3 tier, FAQ 4 item (accordion), footer dengan logo teks NTVGraph × Niyusha. ' +
        'Kualitas visual premium: gradient, animasi halus, responsif. ' +
        'Tulis file BERTAHAP per bagian besar (hero dulu, lalu sambung section berikutnya) supaya tidak terpotong. ' +
        'Setelah selesai, verifikasi sendiri bahwa file utuh (diakhiri </html>) lalu beri ringkasan singkat.',
      { onTool, onDelta, signal }
    );
  } catch (e) {
    console.log(`RUN1 ERROR: ${e.message}`);
  }
  console.log(`--- jawaban ronde 1 (${fmtMs(deadline())}): ${String(ans1).slice(0, 400)}`);

  const staged1 = vfs.hasPending ? vfs.hasPending() : false;
  const applied1 = vfs.applyPending();
  console.log(`staged sebelum apply: ${staged1} · diterapkan: ${applied1}`);

  const idx = path.join(ws, 'index.html');
  const stat1 = fs.existsSync(idx) ? fs.statSync(idx) : null;
  const html1 = stat1 ? fs.readFileSync(idx, 'utf8') : '';
  ok('r1: index.html tertulis', !!stat1, idx);
  ok('r1: ukuran besar (>=15KB)', !!stat1 && stat1.size >= 15000, stat1 ? String(stat1.size) : '0');
  ok('r1: konten utuh (</html>)', /<\/html>/i.test(html1));
  ok('r1: branding NTVGraph × Niyusha', /ntvgraph/i.test(html1) && /niyusha/i.test(html1));
  ok('r1: jawaban bukan give-up', !!ans1 && !/berhenti tanpa output/i.test(ans1) && ans1.length > 40, String(ans1).slice(0, 120));

  console.log('\n=== RONDE 2: revisi (edit_file) ===');
  let ans2 = '';
  try {
    ans2 = await agent.run(
      'Revisi index.html: ganti headline hero menjadi "Terminal AI yang Membangun Masa Depan" ' +
        'dan tambahkan section testimoni (3 kartu) tepat sebelum footer. Verifikasi hasilnya.',
      { onTool, onDelta, signal }
    );
  } catch (e) {
    console.log(`RUN2 ERROR: ${e.message}`);
  }
  console.log(`--- jawaban ronde 2 (${fmtMs(deadline())}): ${String(ans2).slice(0, 400)}`);
  const applied2 = vfs.applyPending();
  console.log(`revisi diterapkan: ${applied2}`);

  const stat2 = fs.existsSync(idx) ? fs.statSync(idx) : null;
  const html2 = stat2 ? fs.readFileSync(idx, 'utf8') : '';
  ok('r2: headline revisi masuk', /Terminal AI yang Membangun Masa Depan/.test(html2));
  ok('r2: section testimoni ditambahkan', /testimoni/i.test(html2));
  ok('r2: file tetap utuh', /<\/html>/i.test(html2));
  ok('r2: ukuran tidak menyusut drastis', !!stat2 && !!stat1 && stat2.size >= stat1.size * 0.8, `${stat1 && stat1.size} -> ${stat2 && stat2.size}`);
  ok('r2: jawaban bukan give-up', !!ans2 && !/berhenti tanpa output/i.test(ans2) && ans2.length > 40, String(ans2).slice(0, 120));

  const logsAfter = readLogs();
  ok('logs.jsonl: tanpa error [run] baru', logsAfter === logsBefore, `+${logsAfter.length - logsBefore.length} byte`);

  const extra = agent._extraBodyParams ? agent._extraBodyParams() : {};
  ok('config: maxTokens sudah 8192 (migrasi)', cfg.maxTokens === 8192, String(cfg.maxTokens));
  if (cfg.provider === 'nvidianim') {
    ok('body: reasoning_budget aktif utk nemotron', extra.reasoning_budget === 4096, JSON.stringify(extra));
  } else {
    ok('body: tanpa param khusus provider lain', Object.keys(extra).length === 0, JSON.stringify(extra));
  }

  const u = agent.usage;
  console.log(
    `\nstatistik: total ${fmtMs(deadline())} · history ${agent.history.length} msg · compactions ${agent.compactions}` +
      (u ? ` · usage asli prompt=${u.prompt} completion=${u.completion}` : ' · usage n/a')
  );
  console.log(`workspace hasil: ${ws}`);
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('E2E ERROR', e);
  process.exitCode = 1;
});
