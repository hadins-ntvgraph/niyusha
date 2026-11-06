#!/usr/bin/env node
/**
 * @fileoverview Main entry point and orchestrator
 *
 * @module niyusha
 */

'use strict';

const readline = require('readline');
const path = require('path');

// Windows legacy console masih memakai code page non-UTF-8 (mis. 437/1252),
// sehingga output UTF-8 TUI terbaca sebagai mojibake. Paksa UTF-8 selama
// sesi berjalan, lalu kembalikan code page semula saat keluar.
function enableUtf8Console() {
  if (process.platform !== 'win32' || !process.stdout.isTTY) return;
  // Terminal non-conhost (mintty/Git Bash) sudah UTF-8 dan tak punya code page.
  if (process.env.MSYSTEM || process.env.TERM_PROGRAM === 'mintty') return;
  const { execFileSync, spawnSync } = require('child_process');
  const chcp = (args) => spawnSync('chcp.com', args, { stdio: 'ignore' });
  let original = null;
  try {
    const out = execFileSync('chcp.com', [], { encoding: 'utf8' });
    const m = /(\d+)/.exec(out);
    if (m) original = m[1];
  } catch {}
  if (original === '65001') return;
  try {
    if (chcp(['65001']).status !== 0) return;
  } catch {
    return;
  }
  if (!original) return;
  const restore = () => {
    try {
      chcp([original]);
    } catch {}
  };
  process.on('exit', restore);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.once(sig, () => {
      restore();
      process.exit(130);
    });
  }
}

enableUtf8Console();

const pkg = require('../package.json');
const { unifiedDiff, summarize } = require('./diff');
const { VirtualFS, normalize, resolveWorkspace, DEFAULT_CWD } = require('./vfs');
const {
  loadConfig,
  saveConfig,
  setProvider,
  setKey,
  setModel,
  setPermissions,
  maskKey,
  keysSummary,
  readConfig,
  hasProvider,
  PROVIDERS,
  CONFIG_FILE,
  DEFAULT_PERMISSIONS,
} = require('./config');
const { Agent } = require('./ai');
const { Store } = require('./store');

const VERSION = pkg.version || '0.0.1';

const color = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const paint = (c, s) => `${c}${s}${color.reset}`;

function envKeyFor(provider) {
  if (provider === 'mistral' && process.env.MISTRAL_API_KEY) return process.env.MISTRAL_API_KEY;
  if (provider === 'openrouter' && process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  return process.env.NIYUSHA_API_KEY || '';
}

class Shell {
  constructor(sessionId, root) {
    const { undoFileFor } = require('./store');
    this.store = new Store(root);
    this.vfs = new VirtualFS(sessionId, root, { undoFile: undoFileFor(root) });
    this.sessionId = sessionId;
    this.root = this.vfs.root;
    this.cwd = DEFAULT_CWD;
    this.env = {
      HOME: '/home/user',
      USER: 'developer',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    };
    this.commands = {
      help: () => this.help(),
      ls: (args) => this.ls(args),
      cd: (args) => this.cd(args),
      pwd: () => this.cwd,
      cat: (args) => this.cat(args),
      echo: (args) => args.join(' '),
      mkdir: (args) => this.mkdir(args),
      touch: (args) => this.touch(args),
      rm: (args) => this.rm(args),
      tree: (args) => this.vfs.tree(args[0] ? this.abs(args[0]) : this.cwd),
      grep: (args) => this.grep(args),
      env: () => Object.entries(this.env).map(([k, v]) => `${k}=${v}`).join('\n'),
      whoami: () => this.env.USER,
      clear: () => '__CLEAR__',
    };
    this.aliases = { dir: 'ls', ll: 'ls', quit: 'exit' };
  }

  abs(p) {
    return p && p.startsWith('/') ? p : normalize(p || '', this.cwd);
  }

  prompt() {
    const short = this.cwd === '/' ? this.root : this.root + this.cwd.replace(/^\//, path.sep);
    return `${paint(color.green, this.env.USER + '@niyusha')}:${paint(color.blue, short)}$ `;
  }

  isCommand(token) {
    return !!(this.commands[token] || this.aliases[token] || token === 'exit');
  }

  run(input) {
    const line = input.trim();
    if (!line) return '';
    const [raw, ...args] = line.split(/\s+/);
    const cmd = this.aliases[raw] || raw;
    if (cmd === 'exit') return '__EXIT__';
    const handler = this.commands[cmd];
    if (!handler) return null;
    try {
      const result = handler(args);
      return result == null ? '' : String(result);
    } catch (err) {
      return paint(color.red, `error: ${err.message}`);
    }
  }

  help() {
    return [
      paint(color.bold, `Niyusha Terminal v${VERSION} (session: ${this.sessionId})`),
      '',
      paint(color.bold, 'Shell commands:'),
      '  ls [dir]         List directory contents',
      '  cd <dir>         Change directory',
      '  pwd              Print working directory',
      '  cat <file>       Show file contents',
      '  echo <text>      Print text',
      '  mkdir <dir>      Create directory',
      '  touch <file>     Create empty file',
      '  rm <path>        Remove file/directory',
      '  tree [dir]       Show workspace tree',
      '  grep <pattern>   Search file contents',
      '  env | whoami     Environment info',
      '',
      paint(color.bold, 'AI / slash commands:'),
      '  <free text>      Ask / instruct the AI agent',
      '  /provider [name] Switch AI provider (lists if no argument)',
      '  /key <api-key>   Set the active provider API key',
      '  /model list      List models for the active provider',
      '  /model <n|name>  Set model from the list (number or name)',
      '  /base <url>      Override the active provider base URL',
      '  /config          Show config & all keys',
      '  /reset           Clear the AI conversation history',
      '  /new             Start a new session (new history & id)',
      '  /compact         Compact context · mode <legacy|shadow|safe|experimental|urich|off> · auto [on|off] · stats · rollback',
      '  /diff            Review & apply staged changes',
      '  /todo add <text> Add task · /todo list · /todo done <n> · /todo rm <n>',
      '  /rule add <text> Add a rule for the AI · /rule list · /rule rm <n>',
      '  /perm …          Command permission rules: list · allow <pattern> · deny <pattern> · rm <allow|deny> <n> · reset',
      '  /skill save <n> <text> · use|ls|rm <n> · auto on|off · on|off <id> · log  (conditional skills)',
      '  /undo            Roll back the last applied changes',
      '  /save            Save session · /sessions · /load [id]',
      '  /sh <cmd>        Run a shell command',
      '  /clear           Clear the screen',
      '  /help            Show this help',
      '  /exit            Exit Niyusha',
      '',
      '  Ctrl+C           Stop a running AI request (twice = quit)',
      '',
      `Workspace: ${this.root}`,
      `Config: ${CONFIG_FILE}`,
    ].join('\n');
  }

  ls(args) {
    const dir = args[0] ? this.abs(args[0]) : this.cwd;
    const entries = this.vfs.listDir(dir);
    if (entries.length === 0) return '';
    return entries
      .map((e) => (e.dir ? paint(color.blue, `${e.name}/`) : `${e.name.padEnd(24)} ${paint(color.dim, e.size + ' B')}`))
      .join('\n');
  }

  cd(args) {
    if (!args[0]) {
      this.cwd = '/';
      return '';
    }
    const target = this.abs(args[0]);
    const entries = this.vfs.listDir(target);
    const isDir = target === '/' || entries.length > 0 || this.vfs.exists(target);
    if (!isDir) throw new Error(`cd: ${args[0]}: No such directory`);
    this.cwd = target;
    return '';
  }

  cat(args) {
    if (!args[0]) throw new Error('cat: usage: cat <file>');
    return this.vfs.read(this.abs(args[0]));
  }

  mkdir(args) {
    if (!args[0]) throw new Error('mkdir: usage: mkdir <dir>');
    return this.vfs.mkdir(this.abs(args[0]));
  }

  touch(args) {
    if (!args[0]) throw new Error('touch: usage: touch <file>');
    const p = this.abs(args[0]);
    if (this.vfs.exists(p)) return '';
    return this.vfs.write(p, '');
  }

  rm(args) {
    if (!args[0]) throw new Error('rm: usage: rm <path>');
    return this.vfs.remove(this.abs(args[0]));
  }

  grep(args) {
    if (!args[0]) throw new Error('grep: usage: grep <pattern>');
    const results = this.vfs.grep(args[0]);
    return results.length ? results.join('\n') : paint(color.dim, '(no matches)');
  }
}

function providerLines() {
  return Object.entries(PROVIDERS).map(
    ([name, p]) => `  ${paint(color.bold, name.padEnd(10))} ${p.name.padEnd(20)} ${paint(color.dim, p.baseUrl)}`
  );
}

function printBanner(config, workspace) {
  const keyStatus = config.provider === 'ollama' || config.apiKey ? maskKey(config.apiKey) : paint(color.yellow, 'not set');
  process.stdout.write(
    [
      '',
      paint(color.cyan + color.bold, '  ███ Niyusha Terminal ███'),
      paint(color.dim, `  v${VERSION}`),
      `  Provider : ${paint(color.magenta, config.provider)} (${keyStatus})`,
      `  Model    : ${paint(color.magenta, config.model)}`,
      `  Base URL : ${paint(color.dim, config.baseUrl)}`,
      workspace ? `  Workspace: ${paint(color.dim, workspace)}` : '',
      paint(color.dim, '  Type a question (AI), a shell command, or /help'),
      '',
    ]
      .filter(Boolean)
      .join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const opts = {
    command: null,
    session: 'default',
    workspace: null,
    help: false,
    version: false,
    setKey: null,
    setModel: null,
    setProvider: null,
    showConfig: false,
    setup: false,
    noTui: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--command') opts.command = argv[++i];
    else if (a === '-s' || a === '--session') opts.session = argv[++i] || 'default';
    else if (a === '-w' || a === '--workspace') opts.workspace = argv[++i] || null;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (a === '--setup') opts.setup = true;
    else if (a === '--set-key') opts.setKey = argv[++i] || '';
    else if (a === '--set-model') opts.setModel = argv[++i] || '';
    else if (a === '--set-provider') opts.setProvider = argv[++i] || '';
    else if (a === '--config') opts.showConfig = true;
    else if (a === '--no-tui') opts.noTui = true;
  }
  return opts;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: niyusha [options]',
      '',
      'Options:',
      '  -c, --command <cmd>        Run a single shell command and exit',
      '  -s, --session <name>       Use a named session (default: default)',
      '      --setup                Run the provider & API key setup wizard',
      '      --set-provider <name>  Choose a provider (openrouter|mistral|openai|ollama)',
      '      --set-key <key>        Save an API key for the active provider',
      '      --set-model <name>     Save a model for the active provider',
      '      --config               Show config & API keys',
      '  -h, --help                 Show this help',
      '  -v, --version              Show version',
      '',
      'Examples:',
      '  niyusha                                  # wizard if not configured yet',
      '  niyusha --set-provider mistral',
      '  niyusha --set-key <MISTRAL_API_KEY>',
      '',
      'Env vars: OPENROUTER_API_KEY, MISTRAL_API_KEY, NIYUSHA_MODEL, NIYUSHA_BASE_URL',
    ].join('\n') + '\n'
  );
}

function showConfig() {
  const cfg = loadConfig();
  process.stdout.write(
    [
      `provider : ${cfg.provider}`,
      `baseUrl  : ${cfg.baseUrl}`,
      `model    : ${cfg.model}`,
      `apiKey   : ${maskKey(cfg.apiKey)}`,
      '',
      'API key per provider (active marked *):',
      ...keysSummary(),
      '',
      `config   : ${CONFIG_FILE}`,
    ].join('\n') + '\n'
  );
}

function needsSetup() {
  const saved = readConfig();
  if (!saved.provider || !hasProvider(saved.provider)) return true;
  const preset = PROVIDERS[saved.provider];
  if (!preset.requiredKey) return false;
  const keys = saved.apiKeys || {};
  const has = keys[saved.provider] || saved.apiKey || envKeyFor(saved.provider);
  return !has;
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a)));
}

async function runWizard(rl) {
  process.stdout.write(
    [
      '',
      paint(color.bold + color.cyan, '  Niyusha Setup — choose an AI provider'),
      '',
      ...providerLines(),
      '',
    ].join('\n') + '\n'
  );

  const names = Object.keys(PROVIDERS);
  const def = names[0];

  let picked = '';
  while (!picked) {
    const answer = (await ask(rl, `Choose a provider [${def}]: `)).trim().toLowerCase();
    if (!answer) {
      picked = def;
    } else if (PROVIDERS[answer]) {
      picked = answer;
    } else if (/^\d+$/.test(answer) && names[Number(answer) - 1]) {
      picked = names[Number(answer) - 1];
    } else {
      process.stdout.write(paint(color.red, `Unknown provider. Options: ${names.join(', ')}`) + '\n');
    }
  }

  setProvider(picked);
  const preset = PROVIDERS[picked];

  if (preset.requiredKey) {
    const env = envKeyFor(picked);
    const hint = env ? ` (env detected ${paint(color.dim, maskKey(env))}, Enter to use)` : ' (get it from the provider console)';
    let key = '';
    while (preset.requiredKey && !key) {
      key = (await ask(rl, `API key for ${preset.name}${hint}: `)).trim();
      if (!key && env) key = env;
      if (!key) process.stdout.write(paint(color.red, 'An API key is required for this provider.') + '\n');
    }
    setKey(picked, key);
    process.stdout.write(paint(color.green, `  ✓ key saved: ${maskKey(key)}`) + '\n');
  } else {
    process.stdout.write(paint(color.dim, '  ✓ local provider, no API key needed') + '\n');
  }

  let model = preset.model;
  const m = (await ask(rl, `Model [${preset.model}]: `)).trim();
  if (m) model = m;
  setModel(picked, model);

  process.stdout.write(paint(color.green, `  ✓ provider '${picked}' ready (model: ${model})`) + '\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (opts.help) {
    printHelp();
    return;
  }
  if (opts.showConfig) {
    showConfig();
    return;
  }
  if (opts.setProvider !== null) {
    setProvider(opts.setProvider);
    process.stdout.write(paint(color.green, `Provider saved: ${opts.setProvider}`) + '\n');
    return;
  }
  if (opts.setKey !== null) {
    const cfg = loadConfig();
    setKey(cfg.provider, opts.setKey);
    process.stdout.write(
      paint(color.green, `API key saved for provider ${cfg.provider}.`) + ` (${maskKey(opts.setKey)})\n`
    );
    return;
  }
  if (opts.setModel !== null) {
    const cfg = loadConfig();
    setModel(cfg.provider, opts.setModel);
    process.stdout.write(paint(color.green, `Model saved: ${opts.setModel} (${cfg.provider})`) + '\n');
    return;
  }

  const workspace = resolveWorkspace(opts.workspace);
  const shell = new Shell(opts.session, workspace);

  if (opts.command) {
    const out = shell.run(opts.command);
    if (out && out !== '__CLEAR__') process.stdout.write(out + '\n');
    return;
  }

  const { MCPManager } = require('./mcp');
  let agent = new Agent({
    vfs: shell.vfs,
    cwd: shell.cwd,
    config: loadConfig(),
    store: shell.store,
    mcp: new MCPManager((loadConfig().mcp) || {}),
  });

  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  if (isTTY && !opts.noTui) {
    const { runTUI } = require('./tui');
    const { cachedUpdate, checkForUpdate } = require('./update');
    const updEnabled = loadConfig().updateCheck !== false;
    const tui = runTUI({
      shell,
      agent,
      version: VERSION,
      firstRun: needsSetup(),
      updateNotice: cachedUpdate(VERSION, { enabled: updEnabled }),
      onQuit: () => process.exit(0),
    });
    checkForUpdate(VERSION, { enabled: updEnabled })
      .then((res) => {
        if (res && res.updateAvailable && tui && typeof tui.showUpdateNotice === 'function') {
          tui.showUpdateNotice(res);
        }
      })
      .catch(() => {});
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: shell.prompt(),
    historySize: 200,
  });

  const store = shell.store;
  rl.history = store.history().slice(-200);
  rl.on('history', () => {});

  const queue = [];
  let busy = false;
  let closed = false;
  let activeAbort = null;
  let lastModelList = [];
  let autoApply = false;
  let decision = false;

  let pendingPerm = null;
  const prompt = () => {
    if (!closed) rl.prompt();
  };

  function summarizeArgs(args) {
    try {
      const s = JSON.stringify(args);
      return s.length > 100 ? s.slice(0, 100) + '…' : s;
    } catch {
      return '';
    }
  }

  function fmtTok(n) {
    return n < 1000 ? String(n) : (n / 1000).toFixed(1) + 'k';
  }

  function fmtLatency(totalMs) {
    const s = totalMs >= 10000 ? `${(totalMs / 1000).toFixed(0)}s` : `${(totalMs / 1000).toFixed(1)}s`;
    return `⏱ ${s}`;
  }

  async function printModels() {
    try {
      const list = await agent.listModels();
      if (!list.length) {
        process.stdout.write(paint(color.yellow, 'No models returned.') + '\n');
        return;
      }
      lastModelList = list;
      const cur = agent.config.model;
      const items = list.map((m) =>
        m === cur ? `${paint(color.green, '→')} ${paint(color.bold, m)}` : `  ${m}`
      );
      for (let i = 0; i < items.length; i += 3) {
        process.stdout.write(items.slice(i, i + 3).join('\n') + '\n');
      }
      process.stdout.write(
        paint(color.dim, `total ${list.length} models · pick by number: /model <name> or /model <n>`) + '\n'
      );
    } catch (e) {
      process.stdout.write(paint(color.red, `error: ${e.message}`) + '\n');
    }
  }

  async function handleSlash(line) {
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd) {
    case 'help':
      process.stdout.write(shell.help() + '\n');
      break;
    case 'clear':
      process.stdout.write('\x1b[2J\x1b[0f');
      break;
    case 'exit':
    case 'quit':
      return rl.close();
    case 'reset':
      agent.reset();
      process.stdout.write(paint(color.green, 'AI history reset.') + '\n');
      break;
    case 'new': {
      shell.sessionId = 's' + Date.now().toString(36);
      agent.reset();
      process.stdout.write(paint(color.green, `New session: ${shell.sessionId}`) + '\n');
      break;
    }
    case 'perm': {
      const sub = (rest[0] || 'list').toLowerCase();
      const perms = agent.permissions();
      const persist = (patch) => {
        setPermissions(patch);
        agent.refresh();
      };
      if (sub === 'reset') {
        persist({ allow: DEFAULT_PERMISSIONS.allow.slice(), deny: DEFAULT_PERMISSIONS.deny.slice() });
        process.stdout.write(paint(color.green, 'Permission rules reset to defaults.') + '\n');
        break;
      }
      if (sub === 'allow' || sub === 'deny') {
        const pattern = rest.slice(1).join(' ').trim();
        if (!pattern) {
          process.stdout.write(paint(color.dim, `Usage: /perm ${sub} <pattern>`) + '\n');
          break;
        }
        const list = (perms[sub] || []).slice();
        if (list.includes(pattern)) {
          process.stdout.write(paint(color.dim, `Already exists: ${pattern}`) + '\n');
          break;
        }
        list.push(pattern);
        persist(sub === 'allow' ? { allow: list } : { deny: list });
        process.stdout.write(paint(color.green, `Rule ${sub} added: ${pattern}`) + '\n');
        break;
      }
      if (sub === 'rm' || sub === 'remove' || sub === 'del') {
        const scope = (rest[1] || '').toLowerCase();
        const n = parseInt(rest[2] || '', 10);
        if ((scope !== 'allow' && scope !== 'deny') || Number.isNaN(n)) {
          process.stdout.write(paint(color.dim, 'Usage: /perm rm <allow|deny> <n>') + '\n');
          break;
        }
        const list = (perms[scope] || []).slice();
        if (n < 1 || n > list.length) {
          process.stdout.write(paint(color.red, 'Invalid number.') + '\n');
          break;
        }
        const removed = list.splice(n - 1, 1)[0];
        persist(scope === 'allow' ? { allow: list } : { deny: list });
        process.stdout.write(paint(color.green, `Rule removed: ${removed}`) + '\n');
        break;
      }
      process.stdout.write(`Permission rules (global) — allow ${perms.allow.length}, deny ${perms.deny.length}:\n`);
      perms.allow.forEach((x, i) => process.stdout.write(`  allow ${i + 1}. ${x}\n`));
      perms.deny.forEach((x, i) => process.stdout.write(`  deny  ${i + 1}. ${x}\n`));
      if (agent.sessionAllow && agent.sessionAllow.length) {
        process.stdout.write('This session (temporary):\n');
        agent.sessionAllow.forEach((x) => process.stdout.write(`  + ${x}\n`));
      }
      process.stdout.write(paint(color.dim, 'Set: /perm allow <pattern> · /perm deny <pattern> · /perm rm <allow|deny> <n> · /perm reset') + '\n');
      break;
    }
    case 'compact': {
      const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      if (sub === 'mode') {
        const mode = (parts[1] || '').toLowerCase();
        const allowed = ['legacy', 'shadow', 'safe', 'experimental', 'urich', 'off'];
        if (!allowed.includes(mode)) process.stdout.write(paint(color.yellow, 'Usage: /compact mode <legacy|shadow|safe|experimental|urich|off>') + '\n');
        else {
          agent.setConfig({ compactionMode: mode });
          saveConfig({ compactionMode: mode });
          process.stdout.write(paint(color.green, `Compaction mode: ${mode} (saved)`) + '\n');
        }
        break;
      }
      if (sub === 'auto') {
        const value = (parts[1] || '').toLowerCase();
        if (!value) {
          const mode = agent.compactionStats().mode;
          if (mode !== 'urich') {
            process.stdout.write(paint(color.yellow, 'Usage: /compact auto <on|off> (auto test only in urich mode: /compact mode urich)') + '\n');
            break;
          }
          process.stdout.write(paint(color.dim, '  ⋯ testing auto-compaction (urich)...') + '\n');
          try {
            const s = await agent.compactIfNeeded(false, { trigger: 'auto' });
            const st = agent.compactionStats();
            process.stdout.write(paint(color.green, `  auto test: ${s ? 'compacted' : 'not needed/blocked'}`) + ` · mode=${st.mode} · trigger=${st.lastTrigger || '-'} · ${st.beforeTokens || '-'} → ${st.afterTokens || '-'} tok\n`);
          } catch (e) {
            process.stdout.write(paint(color.red, `  auto test failed: ${e.message}`) + '\n');
          }
          break;
        }
        if (!['on', 'off'].includes(value)) process.stdout.write(paint(color.yellow, 'Usage: /compact auto <on|off>') + '\n');
        else {
          const enabled = value === 'on';
          agent.setConfig({ compactionAuto: enabled });
          saveConfig({ compactionAuto: enabled });
          process.stdout.write(paint(color.green, `Auto-compaction: ${enabled ? 'on' : 'off'} (saved)`) + '\n');
        }
        break;
      }
      if (sub === 'stats') {
        const stats = agent.compactionStats();
        process.stdout.write(`Compaction: mode=${stats.mode} · active=${stats.compactions}x · checkpoint=${stats.checkpoint ? stats.checkpoint.id : 'none'}\n${JSON.stringify({ shadow: stats.shadow, validation: stats.validation, urich: stats.urich }, null, 2)}\n`);
        break;
      }
      if (sub === 'rollback') {
        const record = agent.rollbackCompaction();
        process.stdout.write(paint(record ? color.green : color.yellow, record ? `Compaction rollback restored: ${record.checkpoint_id}` : 'No compaction checkpoint to roll back.') + '\n');
        break;
      }
      const before = agent.contextTokens();
      process.stdout.write(paint(color.dim, `  ⋯ compacting context (${fmtTok(before.used)}/${fmtTok(before.budget)} tok)...`) + '\n');
      try {
        const s = await agent.compactIfNeeded(true);
        const after = agent.contextTokens();
        if (s) process.stdout.write(paint(color.green, '  ✓ context compacted.') + ` ${fmtTok(after.used)}/${fmtTok(after.budget)} tok · ${agent.compactions}x compacted\n`);
        else process.stdout.write(paint(color.dim, '  history is still short, no compaction needed.') + '\n');
      } catch (e) {
        process.stdout.write(paint(color.red, `  failed to compact: ${e.message}`) + '\n');
      }
      break;
    }
    case 'config':
      showConfig();
      break;
    case 'diff':
      if (shell.vfs.hasPending()) await offerDiff();
      else process.stdout.write(paint(color.dim, 'Nothing staged.') + '\n');
      break;
    case 'provider':
      if (!arg) {
        process.stdout.write('Available providers (active marked *):\n' + providerLines().join('\n') + '\n');
      } else {
        if (!PROVIDERS[arg]) {
          process.stdout.write(paint(color.red, `Unknown provider: ${arg}`) + `\n  ${Object.keys(PROVIDERS).join(', ')}\n`);
          break;
        }
        setProvider(arg);
        agent.refresh();
        if (PROVIDERS[arg].requiredKey && !agent.config.apiKey) {
          let key = '';
          while (!key) {
            key = (await ask(rl, `API key for ${PROVIDERS[arg].name}: `)).trim();
            if (!key && envKeyFor(arg)) key = envKeyFor(arg);
            if (!key) process.stdout.write(paint(color.red, 'An API key is required for this provider.') + '\n');
          }
          setKey(arg, key);
          agent.refresh();
          process.stdout.write(paint(color.green, `  ✓ key saved: ${maskKey(key)}`) + '\n');
        }
        process.stdout.write(paint(color.green, `Active provider: ${agent.config.provider}`) + `  model: ${agent.config.model}\n`);
      }
      break;
    case 'key':
      if (!arg) {
        process.stdout.write(`apiKey (${agent.config.provider}): ${maskKey(agent.config.apiKey)}\n` + keysSummary().join('\n') + '\n');
      } else {
        setKey(agent.config.provider, arg);
        agent.refresh();
        process.stdout.write(paint(color.green, `API key saved for ${agent.config.provider}.`) + ` (${maskKey(arg)})\n`);
      }
      break;
    case 'models':
      await printModels();
      break;
    case 'model': {
      if (!arg) {
        process.stdout.write(`active model (${agent.config.provider}): ${agent.config.model}\n`);
        process.stdout.write(paint(color.dim, 'type /model list to list models from the provider') + '\n');
        break;
      }
      if (arg === 'list' || arg === 'ls' || arg === '--list') {
        await printModels();
        break;
      }
      let name = arg;
      if (/^\d+$/.test(arg)) {
        const idx = Number(arg);
        if (!lastModelList.length) await printModels();
        if (lastModelList[idx - 1]) {
          name = lastModelList[idx - 1];
        } else {
          process.stdout.write(
            paint(color.red, `Number ${arg} is invalid.`) +
                (lastModelList.length ? '' : `\n${color.dim}Try running /model list first.${color.reset}\n`)
          );
          break;
        }
      }
      setModel(agent.config.provider, name);
      agent.refresh();
      process.stdout.write(paint(color.green, `Model: ${name}`) + ` (${agent.config.provider})\n`);
      break;
    }
    case 'base':
      if (!arg) {
        process.stdout.write(`baseUrl: ${agent.config.baseUrl}\n`);
      } else {
        saveConfig({ baseUrl: arg, _baseOverride: true });
        agent.refresh();
        process.stdout.write(paint(color.green, `Base URL: ${arg}`) + '\n');
      }
      break;
    case 'sh': {
      const out = shell.run(arg);
      if (out === '__EXIT__') return rl.close();
      if (out === '__CLEAR__') process.stdout.write('\x1b[2J\x1b[0f');
      else if (out) process.stdout.write(out + '\n');
      break;
    }
    case 'todo': {
      const [sub, ...rest2] = arg.split(' ');
      const body = rest2.join(' ');
      if (sub === 'add' && body) store.addTodo(body);
      else if (sub === 'done' && /^\d+$/.test(body)) {
        const ok = store.toggleTodo(Number(body) - 1);
        if (!ok) process.stdout.write(paint(color.red, 'invalid todo number') + '\n');
      } else if ((sub === 'rm' || sub === 'del' || sub === 'remove') && /^\d+$/.test(body)) {
        const ok = store.removeTodo(Number(body) - 1);
        if (!ok) process.stdout.write(paint(color.red, 'invalid todo number') + '\n');
      } else if (sub === 'clear') store.setTodos([]);
      const todos = store.todos();
      if (!todos.length) {
        process.stdout.write(paint(color.dim, '  (no tasks yet)') + '  ' + paint(color.dim, '/todo add <task>') + '\n');
      } else {
        todos.forEach((t, i) =>
          process.stdout.write(`  ${t.done ? paint(color.green, '[x]') : paint(color.dim, '[ ]')} ${t.done ? paint(color.gray, t.text) : t.text}\n`)
        );
      }
      break;
    }
    case 'rule': {
      const [sub, ...rest2] = arg.split(' ');
      const body = rest2.join(' ');
      if (sub === 'add' && body) {
        store.addRule(body);
        process.stdout.write(paint(color.green, '  ✓ rule added. The AI will follow it from the next session.') + '\n');
      } else if ((sub === 'rm' || sub === 'del' || sub === 'remove') && /^\d+$/.test(body)) {
        const ok = store.removeRule(Number(body) - 1);
        if (!ok) process.stdout.write(paint(color.red, 'invalid rule number') + '\n');
        else process.stdout.write(paint(color.green, '  ✓ rule removed.') + '\n');
      } else {
        const rules = store.rules();
        if (!rules.length) process.stdout.write(paint(color.dim, '  (no rules yet)  /rule add <text>') + '\n');
        else rules.forEach((r, i) => process.stdout.write(`  ${i + 1}. ${r.text}\n`));
      }
      break;
    }
    case 'skill': {
      const skillsReg = (() => {
        try {
          return require('./skills');
        } catch {
          return { list: () => [], findById: () => null, content: () => null, index: () => null };
        }
      })();
      const [sub, name, ...rest2] = arg.split(' ');
      const body = rest2.join(' ');
      const scfg = loadConfig().skills || {};
      if (sub === 'save' && name && body) {
        store.saveSkill(name, body);
        process.stdout.write(paint(color.green, `  ✓ skill '${name}' saved (global).`) + '\n');
      } else if (sub === 'rm' || sub === 'remove' || sub === 'del') {
        const ok = store.removeSkill(name || '');
        if (!ok) process.stdout.write(paint(color.red, `skill '${name}' not found`) + '\n');
        else process.stdout.write(paint(color.green, `  ✓ skill '${name}' removed.`) + '\n');
      } else if (sub === 'auto') {
        const val = name === 'off' ? false : name === 'on' ? true : null;
        if (val === null) process.stdout.write(paint(color.dim, '  Usage: /skill auto on|off') + '\n');
        else {
          saveConfig({ skills: { ...scfg, auto: val } });
          process.stdout.write(paint(color.green, `  ✓ skill index di prompt: ${val ? 'ON' : 'OFF'}`) + '\n');
        }
      } else if (sub === 'on' || sub === 'off') {
        const inf = skillsReg.findById(name);
        if (!inf) process.stdout.write(paint(color.red, `skill registry '${name}' not found`) + '\n');
        else {
          const disabled = Array.isArray(scfg.disabled) ? scfg.disabled.slice() : [];
          const next = disabled.filter((d) => d !== inf.id);
          if (sub === 'off') next.push(inf.id);
          saveConfig({ skills: { ...scfg, disabled: next } });
          process.stdout.write(paint(color.green, `  ✓ skill '${inf.id}' ${sub === 'off' ? 'disabled' : 'enabled'}`) + '\n');
        }
      } else if (sub === 'log') {
        const log = agent && agent.skillLog;
        if (!log || !log.length) process.stdout.write(paint(color.dim, '  (no skill activations yet)') + '\n');
        else
          log.slice(-10).forEach((e) =>
            process.stdout.write(
              `  ${new Date(e.at).toLocaleTimeString()} · [${e.ids.join(', ')}] ${(e.reasons || []).join('; ')} · ~${Math.round((e.chars || 0) / 4)} tok\n`
            )
          );
      } else if (sub === 'use' && name) {
        const s = store.skills().find((x) => x.name === name);
        const regBody = s ? null : skillsReg.content(name);
        if (!s && !regBody) process.stdout.write(paint(color.red, `skill '${name}' not found`) + '\n');
        else await runAi(`(skill instruction: ${name}) ${s ? s.body : regBody}`);
      } else {
        const regIdx = skillsReg.index({ disabled: scfg.disabled, maxChars: 100000 });
        process.stdout.write(paint(color.bold, `  Skill registry (${skillsReg.list().length} — index:${scfg.auto === false ? 'OFF' : 'ON'})\n`));
        if (regIdx) process.stdout.write(regIdx.split('\n').map((l) => '  ' + l).join('\n') + '\n');
        const skills = store.skills();
        if (skills.length) {
          process.stdout.write(paint(color.bold, '  Saved skills:\n'));
          skills.forEach((s, i) => process.stdout.write(`  ${i + 1}. ${paint(color.bold, s.name)} — ${paint(color.dim, s.body.replace(/\n/g, ' ').slice(0, 80))}\n`));
        }
      }
      break;
    }
    case 'undo':
    case 'rollback': {
      const snap = shell.vfs.popSnapshot ? shell.vfs.popSnapshot() : null;
      if (!snap) process.stdout.write(paint(color.dim, 'No snapshot to roll back.') + '\n');
      else {
        const n = shell.vfs.restoreSnapshot(snap);
        const pendingCount = shell.vfs.hasPending ? shell.vfs.pendingChanges().length : 0;
        const pendingNote = pendingCount ? ` Masih ada ${pendingCount} perubahan staged (belum nyata).` : '';
        if (snap.kind === 'workspace') {
          const skipped = Array.isArray(snap.skipped) ? snap.skipped.length : 0;
          const partial = snap.partial ? ` (partial undo: ${skipped}${skipped >= 100 ? '+' : ''} large file(s) left as-is)` : '';
          process.stdout.write(paint(color.green, `  ✓ rolled back shell effects (${n} files) — workspace restored${partial}.`) + '\n');
          agent.addContextNote?.(
            'undo',
            `User menjalankan /undo: efek shell dibatalkan; ${n} file nyata dikembalikan ke kondisi sebelum perintah terakhir${snap.partial ? ' (undo parsial: file besar dilewati)' : ''}.${pendingNote}`
          );
        } else {
          shell.vfs.pushRedo(snap);
          process.stdout.write(paint(color.green, `  ✓ rolled back ${n} changes (${snap.label}). /redo to re-apply.`) + '\n');
          agent.addContextNote?.(
            'undo',
            `User menjalankan /undo: ${n} perubahan yang sudah diterapkan dibatalkan dan file nyata dikembalikan ke snapshot "${snap.label}".${pendingNote}`
          );
        }
      }
      break;
    }
    case 'redo': {
      const r = shell.vfs.redoSnapshot ? shell.vfs.redoSnapshot() : null;
      if (!r || !r.n) process.stdout.write(paint(color.dim, 'Nothing to redo. Change files → /apply → /undo → /redo.') + '\n');
      else {
        process.stdout.write(paint(color.green, `  ✓ redone ${r.n} changes (${(r.snap && r.snap.label) || 're-applied'}).`) + '\n');
        agent.addContextNote?.('undo', `User menjalankan /redo: ${r.n} perubahan diterapkan ulang ke file nyata.`);
      }
      break;
    }
    case 'save': {
      const id = 's' + Date.now().toString(36);
      const msgs = (agent.history || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'ai', text: typeof m.content === 'string' ? m.content : '' }))
        .filter((m) => m.text);
      store.saveSession(id, {
        ts: new Date().toISOString(),
        msgs,
        label: msgs[0] ? msgs[0].text.slice(0, 50) : '',
        summary: agent.summary || null,
        compactionSessionId: agent.compactionSessionId || null,
        goal: agent.goal || null,
        goalHistory: Array.isArray(agent.goalHistory) ? agent.goalHistory.slice() : [],
        goalLedger: Array.isArray(agent.goalLedger) ? agent.goalLedger.map((entry) => ({ ...entry })) : [],
        decisionLedger: Array.isArray(agent.decisionLedger) ? agent.decisionLedger.map((entry) => ({ ...entry })) : [],
        failures: Array.isArray(agent.failures) ? agent.failures.slice() : [],
        resolved: Array.isArray(agent.resolved) ? agent.resolved.slice() : [],
        evidence: Array.isArray(agent.evidence) ? agent.evidence.slice() : [],
        touchedFiles: agent.touchedFiles instanceof Set ? [...agent.touchedFiles] : (Array.isArray(agent.touchedFiles) ? agent.touchedFiles.slice() : []),
        contextNotes: Array.isArray(agent.contextNotes) ? agent.contextNotes.slice() : [],
      });
      process.stdout.write(paint(color.green, `  ✓ session saved: ${id}`) + paint(color.dim, ` · load with /load ${id}`) + '\n');
      break;
    }
    case 'sessions': {
      const list = store.listSessions();
      if (!list.length) process.stdout.write(paint(color.dim, '  (no saved sessions)') + '\n');
      else list.forEach((s) => process.stdout.write(`  ${s.id} · ${String(s.ts).slice(0, 16)} · ${s.label || ''}\n`));
      break;
    }
    case 'load': {
      const s = arg ? store.loadSession(arg) : store.listSessions().slice(-1)[0];
      if (!s) {
        process.stdout.write(paint(color.red, arg ? `session '${arg}' not found` : 'no saved sessions') + '\n');
        break;
      }
      agent.reset();
      agent.history = (s.msgs || []).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
      agent.summary = typeof s.summary === 'string' && s.summary.trim() ? s.summary : null;
      if (s.compactionSessionId) agent.compactionSessionId = String(s.compactionSessionId);
      agent.goal = typeof s.goal === 'string' && s.goal.trim() ? s.goal : null;
      agent.goalHistory = Array.isArray(s.goalHistory) ? s.goalHistory.slice() : [];
      agent.goalLedger = Array.isArray(s.goalLedger) ? s.goalLedger.slice() : (agent.goal ? [{ text: agent.goal, status: 'active', source: 'restored-session', createdAt: null, endedAt: null }] : []);
      agent.decisionLedger = Array.isArray(s.decisionLedger) ? s.decisionLedger.slice() : [];
      agent.failures = Array.isArray(s.failures) ? s.failures.slice() : [];
      agent.resolved = Array.isArray(s.resolved) ? s.resolved.slice() : [];
      agent.evidence = Array.isArray(s.evidence) ? s.evidence.slice() : [];
      agent.touchedFiles = new Set(Array.isArray(s.touchedFiles) ? s.touchedFiles : []);
      agent.contextNotes = Array.isArray(s.contextNotes) ? s.contextNotes.slice() : [];
      process.stdout.write(paint(color.green, `  ✓ session ${s.id} loaded (${(s.msgs || []).length} messages).`) + '\n');
      break;
    }
    default:
      process.stdout.write(paint(color.red, `unknown command: /${cmd}`) + `\n${color.dim}/help${color.reset}\n`);
    }
    prompt();
  }

  async function runAi(text) {
    agent.cwd = shell.cwd;
    agent.refresh();
    if (agent.config.provider !== 'ollama' && !agent.config.apiKey) {
      process.stdout.write(
        paint(color.yellow, `API key not set for provider '${agent.config.provider}'.`) +
          `\n${color.dim}  /provider <name>  ·  /key <key>  ·  /help${color.reset}\n`
      );
      prompt();
      return;
    }
    process.stdout.write(paint(color.dim, `  ⋯ thinking (${agent.config.model})`) + '\n');
    agent.permission = (req) => {
      return new Promise((resolve) => {
        pendingPerm = { req, resolve };
        if (req.type === 'skill') {
          process.stdout.write(
            paint(color.yellow, `  ⚠ skill permission: ${req.id}`) +
              (req.reason ? paint(color.dim, `  (${req.reason})`) : '') +
              '\n'
          );
          if (req.diff) {
            const lines = String(req.diff).split('\n');
            const shown = lines.length > 80 ? lines.slice(0, 80).join('\n') + '\n    ⋯ (diff truncated)' : req.diff;
            process.stdout.write(shown + '\n');
          }
          process.stdout.write(paint(color.dim, '    [y] save skill  [n] deny → '));
          return;
        }
        process.stdout.write(
          paint(color.yellow, `  ⚠ real shell permission: ${req.command}`) +
            (req.cwd && req.cwd !== '/' ? ` (cwd: ${req.cwd})` : '') +
            (req.reason ? paint(color.dim, `  (${req.reason})`) : '') +
            '\n' +
            paint(color.dim, '    [y] allow once  [a] allow this command for the session  [n] deny → ')
        );
      });
    };
    const streamTty = process.stdout.isTTY;
    let streamed = false;
    // Erase-on-retry (TTY): hitung baris/kolom yang dipancarkan attempt stream
    // berjalan; saat retry, teks parsial "dihapus" (cursor-up + clear-line)
    // sebelum stream dari awal → tidak ada jawaban dobel di layar.
    // Reset di batas ronde (onTool) & setelah erase — counter selalu milik
    // attempt paling baru saja.
    let eraseNl = 0;
    let curLineLen = 0;
    const resetErase = () => {
      eraseNl = 0;
      curLineLen = 0;
    };
    const trackErase = (s) => {
      if (!s) return;
      const parts = s.split('\n');
      if (parts.length === 1) curLineLen += s.length;
      else {
        eraseNl += parts.length - 1;
        curLineLen = parts[parts.length - 1].length;
      }
    };
    const runStart = Date.now();
    activeAbort = new AbortController();
    try {
      const answer = await agent.run(text, {
        signal: activeAbort.signal,
        onRetry: (info) => {
          if (streamTty && (eraseNl > 0 || curLineLen > 0)) {
            // Bersihkan parsial attempt sebelumnya: baris parsial saat ini +
            // eraseNl baris lengkap di atasnya.
            let er = '\r\x1b[2K';
            for (let i = 0; i < eraseNl; i++) er += '\x1b[1A\x1b[2K';
            process.stdout.write(er);
          }
          resetErase();
          process.stdout.write(
            paint(color.yellow, `  ⟳ failed (${info.status || 'network'}) — retry ${info.attempt}/${info.max} in ${(info.delayMs / 1000).toFixed(1)}s`) + '\n'
          );
        },
        onTool: (name, args) => {
          resetErase(); // batas ronde: keluaran ronde sebelumnya tidak ikut ter-erase
          if (name === 'assistant' && args.text) return;
          if (name === 'continue') {
            process.stdout.write(paint(color.dim, `  ↻ ${args.text}`) + '\n');
            return;
          }
          if (name === 'permission') {
            const tag = args.decision === 'allow' ? paint(color.green, 'auto allow') : args.decision === 'deny' ? paint(color.red, 'blocked') : paint(color.yellow, 'ask');
            process.stdout.write(paint(color.dim, `  ⛨ ${tag} · ${String(args.command || '').slice(0, 80)} — ${args.reason || ''}`) + '\n');
            return;
          }
          if (name === 'result') {
            process.stdout.write(paint(color.dim, `    ↳ ${String(args.text).split('\n')[0].slice(0, 120)}`) + '\n');
            return;
          }
          process.stdout.write(paint(color.cyan, `  ⚙ ${name} `) + paint(color.dim, summarizeArgs(args)) + '\n');
        },
        onDelta: (d) => {
          if (!streamTty) return;
          if (d.reasoning) {
            trackErase(d.reasoning);
            process.stdout.write(paint(color.dim, d.reasoning));
          }
          if (d.text) {
            trackErase(d.text);
            streamed = true;
            process.stdout.write(d.text);
          }
        },
      });
      if (streamTty && streamed) process.stdout.write('\n');
      if (answer && !(streamTty && streamed)) process.stdout.write('\n' + answer + '\n');
      process.stdout.write(paint(color.dim, `  ${fmtLatency(Date.now() - runStart)}`) + '\n');
    } catch (e) {
      if (e && (e.isUserAbort || e.name === 'AbortError')) {
        process.stdout.write(paint(color.yellow, '  ⛔ stopped by user.') + '\n');
      } else {
        process.stdout.write(paint(color.red, `error: ${e.message}`) + '\n');
      }
    } finally {
      activeAbort = null;
    }
    await offerDiff();
    prompt();
  }

  async function offerDiff() {
    if (!shell.vfs.hasPending()) return;
    if (autoApply) {
      const n = shell.vfs.applyPending();
      process.stdout.write(paint(color.green, `  ✓ ${n} changes auto-applied (session permission).`) + '\n');
      return;
    }
    const changes = shell.vfs.pendingChanges();
    process.stdout.write('\n' + paint(color.bold, `  ${changes.length} changes staged (real files untouched):`) + '\n');
    for (const c of changes) {
      const tag =
        c.op === 'create' ? paint(color.green, 'new ') : c.op === 'delete' ? paint(color.red, 'del') : paint(color.yellow, 'mod ');
      process.stdout.write(`    [${tag}] ${c.path}\n`);
    }
    const c = changes[0];
    if (c && c.op !== 'mkdir') {
      const lines = unifiedDiff(c.before || '', c.after || '', { context: 2 });
      const stats = summarize(lines);
      process.stdout.write(paint(color.dim, `  diff ${c.path} (+${stats.added} -${stats.removed}):`) + '\n');
      for (const d of lines) {
        const col = d.type === '+' ? color.green : d.type === '-' ? color.red : d.type === '@' ? color.dim : color.gray;
        process.stdout.write(paint(col, `    ${d.type === ' ' ? ' ' : d.type} ${d.text}`) + '\n');
      }
    }
    process.stdout.write(
      paint(color.dim, '  [y] apply  [a] all  [s] all + session allow  [n] discard  [x] discard all') + '\n'
    );
    decision = true;
  }

  function handleDecision(text) {
    const k = text.trim().toLowerCase();
    decision = false;
    if (k === 'y' || k === 'ya') {
      const c = shell.vfs.pendingChanges()[0];
      shell.vfs.applyPending([c.path]);
      process.stdout.write(paint(color.green, `  ✓ applied: ${c.path}`) + '\n');
      if (shell.vfs.hasPending()) return offerDiff();
    } else if (k === 'a' || k === 'all') {
      const n = shell.vfs.applyPending();
      process.stdout.write(paint(color.green, `  ✓ ${n} changes applied.`) + '\n');
    } else if (k === 's' || k === 'session') {
      const n = shell.vfs.applyPending();
      autoApply = true;
      process.stdout.write(paint(color.green, `  ✓ ${n} changes applied. This session will auto-apply from now on.`) + '\n');
    } else if (k === 'n' || k === 'no' || k === 'tidak') {
      const c = shell.vfs.pendingChanges()[0];
      shell.vfs.discardPending([c.path]);
      process.stdout.write(paint(color.yellow, `  ✗ discarded: ${c.path}`) + '\n');
      if (shell.vfs.hasPending()) return offerDiff();
    } else if (k === 'x') {
      const n = shell.vfs.discardPending();
      process.stdout.write(paint(color.yellow, `  ✗ ${n} changes discarded.`) + '\n');
    } else {
      process.stdout.write(paint(color.dim, '  type y / a / s / n / x') + '\n');
      decision = true;
    }
  }

  async function handleLine(line) {
    const text = line.trim();
    if (!text) {
      prompt();
      return;
    }
    if (pendingPerm) {
      const p = pendingPerm;
      pendingPerm = null;
      const k = text.toLowerCase();
      if (k === 'y' || k === 'ya' || k === 'yes') {
        process.stdout.write(paint(color.green, '    ✓ allowed') + '\n');
        p.resolve(true);
      } else if (k === 'a' || k === 'all' || k === 'selalu') {
        if (p.req && p.req.command) agent.addSessionAllow(p.req.command);
        process.stdout.write(paint(color.green, '    ✓ allowed for this session (this command).') + '\n');
        p.resolve(true);
      } else {
        process.stdout.write(paint(color.yellow, '    ✗ denied') + '\n');
        p.resolve(false);
      }
      rl.setPrompt(shell.prompt());
      rl.prompt();
      return;
    }
    if (decision) {
      handleDecision(text);
      prompt();
      return;
    }
    if (text.startsWith('/')) {
      await handleSlash(text);
      return;
    }
    const first = text.split(/\s+/)[0];
    if (shell.isCommand(first)) {
      const out = shell.run(text);
      if (out === '__EXIT__') return rl.close();
      if (out === '__CLEAR__') process.stdout.write('\x1b[2J\x1b[0f');
      else if (out) process.stdout.write(out + '\n');
      prompt();
      return;
    }
    await runAi(text);
  }

  async function drain() {
    busy = true;
    while (queue.length) {
      const line = queue.shift();
      await handleLine(line);
    }
    busy = false;
  }

  (async () => {
    if (opts.setup || needsSetup()) {
      await runWizard(rl);
      agent.refresh();
    }
    rl.setPrompt(shell.prompt());
    printBanner(agent.config);
    prompt();
    rl.on('line', (line) => {
      if (pendingPerm) {
        const p = pendingPerm;
        pendingPerm = null;
        const k = line.trim().toLowerCase();
        if (k === 'y' || k === 'ya' || k === 'yes') {
          process.stdout.write(paint(color.green, '    ✓ allowed') + '\n');
          p.resolve(true);
        } else if (k === 'a' || k === 'all' || k === 'selalu') {
          if (p.req && p.req.command) agent.addSessionAllow(p.req.command);
          process.stdout.write(paint(color.green, '    ✓ allowed for this session (this command).') + '\n');
          p.resolve(true);
        } else {
          process.stdout.write(paint(color.yellow, '    ✗ denied') + '\n');
          p.resolve(false);
        }
        return;
      }
      const trimmed = line.trim();
      if (decision && !['y', 'ya', 'a', 'all', 's', 'session', 'n', 'no', 'tidak', 'x'].includes(trimmed.toLowerCase())) {
        // keep typing until a valid decision keyword
        store.addHistory(line);
      } else if (!decision && trimmed) {
        store.addHistory(line);
      }
      queue.push(line);
      if (!busy) drain();
    });
    rl.on('close', () => {
      closed = true;
      try {
        if (agent.mcp) agent.mcp.stop();
      } catch {}
      process.stdout.write('\n' + paint(color.dim, 'Bye! 👋') + '\n');
    });
    rl.on('SIGINT', () => {
      if (activeAbort) {
        process.stdout.write('\n' + paint(color.yellow, '  ⛔ stopping the AI... (press Ctrl+C again to quit)') + '\n');
        activeAbort.abort();
        return;
      }
      rl.close();
    });
  })();
}

main();
