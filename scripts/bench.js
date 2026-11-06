'use strict';

// ── Runner benchmark Niyusha ───────────────────────────────────────────
// Pakai model SEBENARNYA (butuh API key). Auto-apply staged edit.
//   node scripts/bench.js --list
//   node scripts/bench.js --baseline                 (validasi fixture, tanpa API)
//   node scripts/bench.js --provider nvidianim \
//        --model nvidia/nemotron-3.5-lightning-30b-a3b
//   node scripts/bench.js --category multifile --repeat 3
//   node scripts/bench.js --only bug-add-operator --keep --verbose
// Provider: --provider <nama preset> (mis. nvidianim/openrouter); key dari
// apiKeys.<provider> atau env keyEnv (mis. NVIDIA_API_KEY). --repeat N untuk
// mengukur reliabilitas (lulus k/N). Env lain: NIYUSHA_BENCH_RETRIES,
// NIYUSHA_BENCH_TIMEOUT, NIYUSHA_MODEL. Hasil JSON: --json -> bench-result.json.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { Agent } = require(path.join(ROOT, 'bin/ai'));
const { VirtualFS } = require(path.join(ROOT, 'bin/vfs'));
const { loadConfig, providerInfo } = require(path.join(ROOT, 'bin/config'));
let TASKS = require('./bench-tasks');

const META_TOOLS = new Set(['reasoning', 'assistant', 'result', 'permission', 'approval', 'continue', 'subtool']);

function parseArgs(argv) {
  const o = {
    list: false,
    baseline: false,
    only: null,
    category: null,
    provider: null,
    model: null,
    max: null,
    tasks: null,
    keep: false,
    json: false,
    verbose: false,
    repeat: Number(process.env.NIYUSHA_BENCH_REPEAT || 1),
    timeoutMs: Number(process.env.NIYUSHA_BENCH_TIMEOUT || 120) * 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') o.list = true;
    else if (a === '--baseline') o.baseline = true;
    else if (a === '--only') o.only = argv[++i];
    else if (a === '--category') o.category = argv[++i];
    else if (a === '--provider') o.provider = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--tasks') o.tasks = argv[++i];
    else if (a === '--max') o.max = Number(argv[++i]);
    else if (a === '--keep') o.keep = true;
    else if (a === '--json') o.json = true;
    else if (a === '--repeat') o.repeat = Number(argv[++i]);
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--timeout') o.timeoutMs = Number(argv[++i]) * 1000;
  }
  return o;
}

function select(list, o) {
  let out = list;
  if (o.only) out = out.filter((t) => t.id === o.only);
  if (o.category) out = out.filter((t) => t.category === o.category);
  if (o.max) out = out.slice(0, o.max);
  return out;
}

function mkWs(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `niyusha-bench-${t.id}-`));
  for (const [rel, content] of Object.entries(t.files || {})) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function runShell(cmd, cwd, timeoutMs) {
  try {
    const out = execFileSync('/bin/bash', ['-lc', cmd], { cwd, timeout: timeoutMs || 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { exit: 0, stdout: out.toString(), stderr: '' };
  } catch (e) {
    return {
      exit: typeof e.status === 'number' ? e.status : 1,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
    };
  }
}

function makeCtx(dir, reply, agent, extra) {
  return {
    reply: String(reply || ''),
    read: (rel) => {
      try {
        return fs.readFileSync(path.join(dir, rel), 'utf8');
      } catch {
        return null;
      }
    },
    exists: (rel) => fs.existsSync(path.join(dir, rel)),
    run: (cmd) => runShell(cmd, dir, 60000),
    compactions: agent ? agent.compactions : 0,
    history: agent ? agent.history.length : 0,
    ...(extra || {}),
  };
}

function evalVerify(t, dir, reply, agent, extra) {
  if (typeof t.check === 'function') {
    const r = t.check(makeCtx(dir, reply, agent, extra));
    if (r && typeof r === 'object') return { ok: !!r.ok, why: r.why || '' };
    return { ok: !!r, why: '' };
  }
  if (t.verify) {
    const r = runShell(t.verify, dir, t.verifyTimeoutMs || 60000);
    const why = r.exit === 0 ? '' : (r.stderr || r.stdout || `exit ${r.exit}`).trim().replace(/\s+/g, ' ').slice(0, 200);
    return { ok: r.exit === 0, why };
  }
  return { ok: true, why: '' };
}

async function runTask(t, o, baseCfg) {
  const dir = mkWs(t);
  const vfs = new VirtualFS(t.id, dir, {});
  const cfg = { ...baseCfg, retries: Number(process.env.NIYUSHA_BENCH_RETRIES || 1) };
  if (o.model) cfg.model = o.model;
  if (t.config) Object.assign(cfg, t.config);
  const agent = new Agent({ vfs, cwd: dir, config: cfg, permission: async () => true });
  if (t.planMode) agent.setPlanMode(true);

  const tools = {};
  const toolSeq = [];
  const onTool = (name) => {
    tools[name] = (tools[name] || 0) + 1;
    if (!META_TOOLS.has(name)) toolSeq.push(name);
  };
  const turns = t.turns || [t.prompt];
  const perTurnMs = t.timeoutMs || o.timeoutMs;
  const t0 = Date.now();
  let reply = '';
  let error = null;
  try {
    for (const p of turns) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), perTurnMs);
      try {
        reply = await agent.run(p, {
          onTool,
          onApproval: () => ({ decision: 'apply' }),
          signal: ctrl.signal,
          maxSteps: t.maxSteps || 20,
          autoContinue: t.autoContinue !== false,
        });
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (e) {
    error = (e && e.message) || String(e);
  }

  const extra = {
    toolSeq: toolSeq.slice(),
    tools: { ...tools },
    planMode: !!agent.planMode,
    staged: vfs && typeof vfs.pendingChanges === 'function' ? vfs.pendingChanges().length : 0,
    todos: Array.isArray(agent.state && agent.state.todos) ? agent.state.todos : [],
    orig: (rel) => (t.files && Object.prototype.hasOwnProperty.call(t.files, rel) ? t.files[rel] : null),
  };

  const elapsedMs = Date.now() - t0;
  const verdict = error ? { ok: false, why: `error: ${error}` } : evalVerify(t, dir, reply, agent, extra);
  const result = {
    id: t.id,
    category: t.category,
    title: t.title,
    ok: verdict.ok,
    why: verdict.why,
    error,
    elapsedMs,
    toolCalls: Object.values(tools).reduce((a, b) => a + b, 0),
    toolSeq,
    tools,
    compactions: agent.compactions,
    history: agent.history.length,
    reply: reply.slice(0, 400),
    dir: o.keep ? dir : null,
  };
  if (!o.keep) fs.rmSync(dir, { recursive: true, force: true });
  else process.stdout.write(`   (workspace disimpan: ${dir})\n`);
  return result;
}

function doList(o) {
  for (const t of select(TASKS, o)) {
    console.log(`${String(t.category).padEnd(14)} ${String(t.id).padEnd(26)} ${t.title}`);
  }
}

function doBaseline(o) {
  const list = select(TASKS, o);
  let bad = 0;
  for (const t of list) {
    if (!t.verify) {
      console.log(`SKIP  ${t.id} (tanpa verify — read-only/check)`);
      continue;
    }
    const dir = mkWs(t);
    const r = runShell(t.verify, dir, t.verifyTimeoutMs || 60000);
    if (!o.keep) fs.rmSync(dir, { recursive: true, force: true });
    if (r.exit !== 0) {
      console.log(`OK    ${t.id} — fixture memang gagal sebelum fix (exit ${r.exit})`);
    } else {
      console.log(`BAD   ${t.id} — verify SUDAH lulus sebelum fix (fixture/tes tidak menguji apa pun)`);
      bad++;
    }
  }
  const count = list.filter((t) => t.verify).length;
  console.log(`\nbaseline: ${count - bad}/${count} fixture valid (gagal sebelum fix).`);
  process.exitCode = bad ? 1 : 0;
}

function resolveBenchConfig(o) {
  const cfg = loadConfig();
  const target = o.provider || process.env.NIYUSHA_BENCH_PROVIDER || cfg.provider;
  const switched = target !== cfg.provider;
  if (switched) {
    const pinfo = providerInfo(target);
    if (!pinfo) throw new Error(`provider tidak dikenal: ${target}`);
    cfg.provider = target;
    cfg.providerInfo = pinfo;
    cfg.baseUrl = pinfo.baseUrl;
    const userKey = (cfg.apiKeys && cfg.apiKeys[target]) || '';
    const envKey = pinfo.keyEnv ? process.env[pinfo.keyEnv] : '';
    cfg.apiKey = userKey || envKey || process.env.NIYUSHA_API_KEY || '';
  }
  if (o.model) cfg.model = o.model;
  else if (switched || !cfg.model) {
    cfg.model = (cfg.models && cfg.models[target]) || (cfg.providerInfo && cfg.providerInfo.model) || cfg.model;
  }
  return cfg;
}

(async () => {
  const o = parseArgs(process.argv.slice(2));

  if (o.tasks) {
    try {
      TASKS = require(path.resolve(process.cwd(), o.tasks));
    } catch (e) {
      console.error(`gagal muat tasks '${o.tasks}': ${(e && e.message) || e}`);
      process.exitCode = 2;
      return;
    }
  }

  if (o.list) {
    doList(o);
    return;
  }
  if (o.baseline) {
    doBaseline(o);
    return;
  }

  let cfg;
  try {
    cfg = resolveBenchConfig(o);
  } catch (e) {
    console.error(String((e && e.message) || e));
    process.exitCode = 2;
    return;
  }
  const needKey = cfg.providerInfo && cfg.providerInfo.requiredKey;
  if (needKey && !cfg.apiKey) {
    console.error(
      `Benchmark butuh API key untuk provider '${cfg.provider}'. Set apiKeys.${cfg.provider} atau env ${(cfg.providerInfo && cfg.providerInfo.keyEnv) || 'NIYUSHA_API_KEY'}.`
    );
    process.exitCode = 2;
    return;
  }

  const list = select(TASKS, o);
  if (!list.length) {
    console.error('Tidak ada task yang cocok.');
    process.exitCode = 2;
    return;
  }

  const attempts = Math.max(1, Math.floor(o.repeat || 1));
  console.log(
    `Benchmark: ${list.length} task${attempts > 1 ? ` × ${attempts}` : ''} · provider=${cfg.provider} · model=${o.model || cfg.model}\n`
  );
  const results = [];
  for (const t of list) {
    process.stdout.write(`▶ ${t.id.padEnd(26)} `);
    const runs = [];
    for (let k = 0; k < attempts; k++) runs.push(await runTask(t, o, cfg));
    const passes = runs.filter((r) => r.ok).length;
    const last = runs[runs.length - 1];
    const agg = {
      ...last,
      ok: passes === attempts,
      passes,
      attempts,
      elapsedMs: runs.reduce((a, r) => a + r.elapsedMs, 0),
      toolCalls: Math.round(runs.reduce((a, r) => a + r.toolCalls, 0) / attempts),
    };
    results.push(agg);
    const sec = (agg.elapsedMs / 1000).toFixed(1);
    const rate = attempts > 1 ? ` ${passes}/${attempts}` : '';
    const why = String(last.why || '').replace(/\s+/g, ' ').slice(0, 80);
    if (agg.ok) console.log(`PASS${rate}  (${sec}s, ${agg.toolCalls} tool)`);
    else console.log(`FAIL${rate}  ${why}  (${sec}s)`);
    if (o.verbose && !agg.ok && last.error) console.log(`    error: ${String(last.error).slice(0, 300)}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const byCat = {};
  for (const r of results) {
    byCat[r.category] = byCat[r.category] || { ok: 0, n: 0 };
    byCat[r.category].n++;
    if (r.ok) byCat[r.category].ok++;
  }
  console.log('\n── Ringkasan ──');
  for (const [cat, v] of Object.entries(byCat)) console.log(`  ${cat.padEnd(14)} ${v.ok}/${v.n}`);
  const totalSec = (results.reduce((a, r) => a + r.elapsedMs, 0) / 1000).toFixed(1);
  console.log(`  TOTAL          ${passed}/${results.length}  (${totalSec}s)`);

  if (o.json) {
    fs.writeFileSync(path.join(ROOT, 'bench-result.json'), JSON.stringify(results, null, 2));
    console.log('  hasil JSON  -> bench-result.json');
  }
  process.exitCode = passed === results.length ? 0 : 1;
})();
