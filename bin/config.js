/**
 * @fileoverview Configuration management for Niyusha TUI
 *
 * Handles provider configuration, API keys, permissions, and runtime settings.
 * Supports multiple LLM providers with unified interface.
 *
 * @module config
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.niyusha');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
let loadCache = null;

const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiredKey: true,
    model: 'openai/gpt-4o-mini',
    keyEnv: 'OPENROUTER_API_KEY',
    freeNote: '":free" models available (account required)',
  },
  mistral: { name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', requiredKey: true, model: 'mistral-large-latest', keyEnv: 'MISTRAL_API_KEY' },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', requiredKey: true, model: 'gpt-4o-mini', keyEnv: 'OPENAI_API_KEY' },
  ollama: { name: 'Ollama (Local)', baseUrl: 'http://localhost:11434/v1', requiredKey: false, model: 'llama3.1:latest', freeNote: 'local · no key required' },
  gemini: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', requiredKey: true, model: 'gemini-2.0-flash', keyEnv: 'GEMINI_API_KEY', freeNote: 'free tier on Google AI Studio' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', requiredKey: true, model: 'llama-3.3-70b-versatile', keyEnv: 'GROQ_API_KEY', freeNote: 'free tier available' },
  nvidianim: { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', requiredKey: true, model: 'meta/llama-3.1-405b-instruct', keyEnv: 'NVIDIA_API_KEY', freeNote: 'free credits' },
  llama: { name: 'Meta Llama API', baseUrl: 'https://api.llama.com/compat/v1', requiredKey: true, model: 'llama-4-maverick-17b-128e-instruct-fp8', keyEnv: 'LLAMA_API_KEY' },
  ollamacloud: { name: 'Ollama Cloud', baseUrl: 'https://ollama.com', requiredKey: true, model: 'llama3.3:latest', keyEnv: 'OLLAMA_API_KEY' },
  zai: { name: 'Z.ai / Zhipu GLM', baseUrl: 'https://api.z.ai/api/paas/v4', requiredKey: true, model: 'glm-4-plus', keyEnv: 'ZAI_API_KEY' },
  xai: { name: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', requiredKey: true, model: 'grok-2-latest', keyEnv: 'XAI_API_KEY' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', requiredKey: true, model: 'deepseek-chat', keyEnv: 'DEEPSEEK_API_KEY' },
  together: { name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', requiredKey: true, model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyEnv: 'TOGETHER_API_KEY' },
  fireworks: { name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', requiredKey: true, model: 'accounts/fireworks/models/llama-v3p3-70b-instruct', keyEnv: 'FIREWORKS_API_KEY' },
  perplexity: { name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', requiredKey: true, model: 'llama-3.1-sonar-small-128k-online', keyEnv: 'PERPLEXITY_API_KEY' },
  cerebras: { name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', requiredKey: true, model: 'llama-3.3-70b', keyEnv: 'CEREBRAS_API_KEY', freeNote: 'free tier' },
  moonshot: { name: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.cn/v1', requiredKey: true, model: 'moonshot-v1-8k', keyEnv: 'MOONSHOT_API_KEY' },
  qwen: { name: 'Qwen / DashScope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', requiredKey: true, model: 'qwen-plus', keyEnv: 'DASHSCOPE_API_KEY' },
  github: { name: 'GitHub Models', baseUrl: 'https://models.inference.ai.azure.com', requiredKey: true, model: 'gpt-4o-mini', keyEnv: 'GITHUB_TOKEN', freeNote: 'free tier (GitHub token required)' },
  pollinations: { name: 'Pollinations AI', baseUrl: 'https://gen.pollinations.ai/v1', requiredKey: true, model: 'openai/gpt-4o-mini', keyEnv: 'POLLINATIONS_API_KEY', freeNote: 'API key required: enter.pollinations.ai/keys' },
  custom: { name: 'Custom', baseUrl: 'http://localhost:8080/v1', requiredKey: true, model: 'gpt-4o-mini', freeNote: 'custom slot (enter your own)' },
  llmfaucet: { name: 'LLM Faucet (anon, beta)', baseUrl: 'https://api.llmfaucet.dev/v1', requiredKey: false, defaultKey: 'free', model: 'auto:fast', models: ['auto:fast', 'auto:coding', 'auto:smart'], freeNote: 'anon · placeholder key "free" · beta/unverified · OFF', disabled: true },
};

// Estimasi biaya USD per 1M token (input/output) — aproksimasi; fallback default.
const PRICE_USD_PER_MTOK = {
  openai: { in: 0.15, out: 0.6 },
  openrouter: { in: 0.2, out: 0.6 },
  mistral: { in: 0.25, out: 1.0 },
  groq: { in: 0.3, out: 0.4 },
  deepseek: { in: 0.27, out: 1.1 },
  gemini: { in: 0.1, out: 0.4 },
  github: { in: 0.15, out: 0.6 },
};

function unitCost(provider) {
  return PRICE_USD_PER_MTOK[provider] || null;
}

const DEFAULTS = {
  provider: 'openrouter',
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openai/gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 8192,
  streaming: true,
  retries: 4,
  retryBaseMs: 800,
  timeoutMs: 120000,
  autoContinue: 3,
  cacheReadRatio: 0.1,
  showCost: false,
  runJail: false,
  runUndo: true,
  runUndoMaxFileMb: 64,
  runUndoMaxTotalMb: 1000,
  notify: true,
  sound: false,
  soundKind: 'bell',
  shell: 'auto',
  theme: 'dark-blue',
  icon: 'spark',
  banner: true,
  updateCheck: true,
  sidebarWidth: 0,
  credit: false,
  // DIS-URICH menjadi default; legacy tetap tersedia via /compact mode legacy.
  compactionMode: 'urich',
  // Slot provider custom yang bisa diisi sendiri (nama/base URL/model/API key).
  customProvider: { name: 'Custom', baseUrl: 'http://localhost:8080/v1', model: 'gpt-4o-mini', requiredKey: true },
  compactionAuto: true,
  compactionArchiveBeforeCompact: true,
  // Ambang kompaksi (0.35-0.65). 'auto' = adaptif berdasar pertumbuhan.
  compactionThreshold: 0.45,
  compactionThresholdLocked: false,
  // 0 = adaptif (6 pesan terakhir, ~18% budget). >0 = kunci jumlah token raw terbaru.
  compactionKeepTokens: 0,
  // 0 = adaptif (ceiling 70%). 0.1-0.5 = buffer eksplisit (ceiling = 1 - buffer).
  compactionBufferRatio: 0,
  // Batas total waktu ekstraksi atom AI; lewat batas ini kompaksi jatuh ke
  // engine lokal agar tidak terlihat freeze pada model yang lambat.
  compactionAiTimeoutMs: 30000,
  compactionAiChunkChars: 24000,
  // Setelah kompaksi sukses, tunda auto-compaction berikutnya agar tidak
  // beruntun di turn yang sama (mis. banyak hasil browser).
  compactionCooldownMs: 60000,
  // Prune housekeeping: tool output lama di luar recency window (50% budget)
  // dipangkas sebelum request, seperti Kilo. 0 = nonaktif.
  contextRecencyPruneRatio: 0.5,
  contextEngineDir: '',
  contextEngineMemoryChars: 1400,
  contextEngineMemoryMaxChars: 3600,
  mcp: {},
  // Aktivasi skill kondisional (bin/skills/). auto=false mematikan otomatis;
  // disabled = daftar id skill yang dinonaktifkan via /skill off <id>.
  skills: { auto: true, max_active: 2, budget_chars: 1800, disabled: [] },
  apiKeys: {},
  models: {},
  _baseOverride: false,
};

const DEFAULT_PERMISSIONS = {
  allow: [
    'ls', 'pwd', 'cat ', 'echo ', 'dir ', 'type ', 'where ', 'which ', 'whoami', 'hostname',
    'git status', 'git diff', 'git log', 'git branch', 'git show',
    'node -v', 'npm -v', 'npm test', 'npm start', 'npm ci',
    'head ', 'tail ', 'wc ', 'grep ', 'findstr ', 'Get-ChildItem', 'Get-Command', 'Select-String',
    'Get-Content', 'Get-Item', 'Get-ItemProperty', 'Get-Location', 'Get-Date', 'Get-Help',
    'Get-Member', 'Get-Alias', 'Get-History', 'Get-Variable', 'Test-Path', 'Resolve-Path',
    // diagnostik read-only (Windows/POSIX)
    'Get-NetTCPConnection', 'netstat', 'tasklist', 'Get-Process', 'Get-Service',
    'Test-NetConnection', 'nslookup', 'ping ', 'curl -I', 'curl -sI', 'curl.exe -I', 'curl.exe -sI', 'curl.exe -s',
    // server dev umum (localhost) — perintah berbahaya tetap dicek lebih dulu
    'python -m http.server', 'python3 -m http.server', 'py -m http.server',
    'npx serve', 'http-server', 'php -S', 'uvicorn', 'flask run',
  ],
  deny: [
    ':(){:|:&};:', 'rm -rf /', 'rm -rf ~', 'mkfs', 'format ',
    'shutdown', 'reboot',
  ],
};

const MODEL_CONTEXT = [
  { re: /gpt-3\.5/, window: 16385 },
  { re: /gpt-4\.1/, window: 1000000 },
  { re: /gpt-4o|gpt-4|chatgpt-4o/, window: 128000 },
  { re: /\bo1|\bo3|\bo4/, window: 200000 },
  { re: /claude/, window: 200000 },
  { re: /gemini-1\.5|gemini-2/, window: 1000000 },
  { re: /gemini/, window: 128000 },
  { re: /llama-?3\.1|llama-?3\.2|llama-?3\.3/, window: 128000 },
  { re: /llama-?3/, window: 8192 },
  { re: /qwen/, window: 32768 },
  { re: /deepseek/, window: 65536 },
  { re: /mixtral/, window: 32768 },
  { re: /mistral-large|ministral|magistral|mistral-medium|pixtral/, window: 131072 },
  { re: /mistral|open-mistral|codestral/, window: 32768 },
];

const PROVIDER_WINDOW = {
  openai: 128000,
  openrouter: 128000,
  mistral: 131072,
  ollama: 8192,
};

function customProviders() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    saved = {};
  }
  return Array.isArray(saved.providers && saved.providers.custom) ? saved.providers.custom : [];
}

function customProviderPreset() {
  const saved = readConfig();
  const cur = saved && saved.customProvider && typeof saved.customProvider === 'object' ? saved.customProvider : {};
  const base = { ...(DEFAULTS.customProvider || {}), ...cur };
  const name = String(base.name || 'Custom').trim() || 'Custom';
  const baseUrl = String(base.baseUrl || 'http://localhost:8080/v1').trim() || 'http://localhost:8080/v1';
  const model = String(base.model || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
  const requiredKey = base.requiredKey !== false;
  return {
    name,
    baseUrl,
    model,
    requiredKey,
    keyEnv: base.keyEnv ? String(base.keyEnv) : '',
    freeNote: base.freeNote ? String(base.freeNote) : 'custom slot (enter your own)',
    headers: base.headers && typeof base.headers === 'object' ? base.headers : {},
  };
}

function setCustomProvider(patch = {}) {
  const saved = readConfig();
  const cur = saved && saved.customProvider && typeof saved.customProvider === 'object' ? saved.customProvider : {};
  const next = { ...cur, ...(patch && typeof patch === 'object' ? patch : {}) };
  saveConfig({ customProvider: next });
  loadCache = null;
  return customProviderPreset();
}

function providerInfo(name) {
  if (name === 'custom') return customProviderPreset();
  if (PROVIDERS[name]) return PROVIDERS[name];
  const c = customProviders().find((x) => x.name === name);
  if (c) return c;
  return manifestProviders().find((x) => x.name === name);
}

function providerList() {
  return [
    ...Object.keys(PROVIDERS),
    ...customProviders().map((c) => c.name),
    ...manifestProviders().map((c) => c.name),
  ];
}

// ---- Manifest remote (provider sponsor/gratis dinamis) ----
const MANIFEST_FILE = path.join(CONFIG_DIR, 'providers.manifest.json');

function readManifestCache() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveManifestCache(obj) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(obj));
    loadCache = null;
  } catch {}
}

function manifestUrl() {
  return String(readConfig().providerManifestUrl || '');
}

function setManifestUrl(url) {
  saveConfig({ providerManifestUrl: String(url || '').trim() });
}

function sanitizeManifestProvider(p) {
  if (!p || typeof p.name !== 'string') return null;
  const name = p.name.trim();
  if (!name || PROVIDERS[name]) return null;
  const baseUrl = String(p.baseUrl || '').trim();
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl)) return null;
  return {
    name,
    baseUrl,
    model: p.model ? String(p.model) : '',
    requiredKey: p.requiredKey !== false,
    sponsored: !!p.sponsored,
    disabled: !!p.disabled,
    defaultKey: p.defaultKey ? String(p.defaultKey) : '',
    keyEnv: p.keyEnv ? String(p.keyEnv) : '',
    freeNote: p.freeNote ? String(p.freeNote) : '',
    models: Array.isArray(p.models) ? p.models.map(String) : undefined,
    headers: p.headers && typeof p.headers === 'object' ? p.headers : {},
  };
}

function manifestProviders() {
  const c = readManifestCache();
  if (!c || !Array.isArray(c.providers)) return [];
  return c.providers.map(sanitizeManifestProvider).filter(Boolean);
}

async function fetchManifest(url) {
  const u = String(url || manifestUrl()).trim();
  if (!u) throw new Error('URL manifest kosong. Set: /provider manifest <url>');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(u, { signal: ctrl.signal, headers: { accept: 'application/json' } });
  } catch (e) {
    throw new Error(`Gagal mengambil manifest (${u}): ${e.message}`);
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Manifest bukan JSON valid.');
  }
  const arr = Array.isArray(data) ? data : Array.isArray(data.providers) ? data.providers : [];
  const providers = arr.map(sanitizeManifestProvider).filter(Boolean);
  saveManifestCache({ ts: Date.now(), url: u, providers });
  return providers;
}

// Provider "OFF": default dari preset (disabled:true) atau override user (providers.disabled/enabled).
function providerDisabled(name) {
  const saved = readConfig();
  const p = saved.providers || {};
  const enabled = Array.isArray(p.enabled) ? p.enabled : [];
  const disabled = Array.isArray(p.disabled) ? p.disabled : [];
  if (enabled.includes(name)) return false;
  if (disabled.includes(name)) return true;
  const info = providerInfo(name);
  return !!(info && info.disabled);
}

function setProviderEnabled(name, on) {
  const saved = readConfig();
  const p = saved.providers || {};
  const enabled = new Set(Array.isArray(p.enabled) ? p.enabled : []);
  const disabled = new Set(Array.isArray(p.disabled) ? p.disabled : []);
  if (on) {
    enabled.add(name);
    disabled.delete(name);
  } else {
    disabled.add(name);
    enabled.delete(name);
  }
  saveConfig({ providers: { ...p, enabled: [...enabled], disabled: [...disabled] } });
  return on;
}

function addCustomProvider(p) {
  const name = String((p && p.name) || '').trim();
  if (!name) throw new Error('nama provider wajib');
  if (PROVIDERS[name]) throw new Error(`${name} sudah jadi preset.`);
  const baseUrl = String((p && p.baseUrl) || '').trim();
  if (!baseUrl) throw new Error('baseUrl wajib (mis. https://.../v1)');
  const entry = {
    name,
    baseUrl,
    model: String((p && p.model) || '').trim() || 'gpt-4o-mini',
    requiredKey: (p && p.requiredKey) !== false,
    headers: (p && p.headers) || {},
    keyEnv: (p && p.keyEnv) || '',
    sponsored: !!(p && p.sponsored),
    freeNote: (p && p.freeNote) || '',
    defaultKey: (p && p.defaultKey) || '',
    models: Array.isArray(p && p.models) ? p.models : undefined,
  };
  const saved = readConfig();
  const list = customProviders();
  const i = list.findIndex((c) => c.name === name);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  saveConfig({ providers: { ...(saved.providers || {}), custom: list } });
  return entry;
}

function removeCustomProvider(name) {
  const saved = readConfig();
  const list = customProviders().filter((c) => c.name !== String(name).trim());
  saveConfig({ providers: { ...(saved.providers || {}), custom: list } });
  return true;
}

function loadConfig() {
  if (loadCache) return loadCache;
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    saved = {};
  }
  // Config lama menyimpan maxTokens 4096 (default versi sebelumnya) secara
  // eksplisit — kalau dibiarkan, kenaikan DEFAULTS tidak pernah berlaku.
  if (saved && Number(saved.maxTokens) === 4096) delete saved.maxTokens;
  const cfg = { ...DEFAULTS, ...saved };
  cfg.apiKeys = { ...(saved.apiKeys || {}) };
  cfg.models = { ...(saved.models || {}) };
  const savedPerms = saved.permissions || {};
  cfg.permissions = {
    allow: Array.isArray(savedPerms.allow) ? savedPerms.allow.slice() : DEFAULT_PERMISSIONS.allow.slice(),
    deny: Array.isArray(savedPerms.deny) ? savedPerms.deny.slice() : DEFAULT_PERMISSIONS.deny.slice(),
  };
  const ws = saved.websearch || {};
  cfg.websearch = {
    enabled: !!ws.enabled,
    provider: ws.provider || 'duckduckgo',
    apiKeys: { ...(ws.apiKeys || {}) },
    maxPerRun: Number.isFinite(Number(ws.maxPerRun)) ? Number(ws.maxPerRun) : 5,
    custom: Array.isArray(ws.custom) ? ws.custom : [],
  };
  cfg.mcp = cfg.mcp && typeof cfg.mcp === 'object' ? cfg.mcp : {};

  let pinfo = providerInfo(cfg.provider);
  if (!pinfo) cfg.provider = 'openrouter';
  else if (providerDisabled(cfg.provider)) {
    // Provider tersimpan ternyata OFF → jangan biarkan terpilih (request pasti
    // gagal). Fallback ke openrouter & tandai untuk peringatan di UI.
    cfg.providerOff = cfg.provider;
    cfg.provider = 'openrouter';
  }
  const preset = providerInfo(cfg.provider) || PROVIDERS.openrouter;

  cfg.baseUrl = cfg._baseOverride && cfg.baseUrl ? cfg.baseUrl : preset.baseUrl;
  // Resolusi API key: key user > env provider (keyEnv) > env global NIYUSHA_API_KEY > config lama.
  const userKey = cfg.apiKeys[cfg.provider] || '';
  let key = userKey;
  if (!key && preset.keyEnv && process.env[preset.keyEnv]) key = process.env[preset.keyEnv];
  if (!key && preset.defaultKey) key = preset.defaultKey;
  if (!key && process.env.NIYUSHA_API_KEY) key = process.env.NIYUSHA_API_KEY;
  if (!key && cfg.apiKey) key = cfg.apiKey;
  cfg.apiKey = key;
  cfg.hasUserKey = !!userKey;
  cfg.hasSponsorKey = !userKey && !!key;
  cfg.model = cfg.models[cfg.provider] || preset.model;
  cfg.providerInfo = preset;

  if (process.env.NIYUSHA_BASE_URL) cfg.baseUrl = process.env.NIYUSHA_BASE_URL;
  if (process.env.NIYUSHA_MODEL) cfg.model = process.env.NIYUSHA_MODEL;
  loadCache = cfg;
  return cfg;
}

function saveConfig(patch) {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    saved = {};
  }
  const next = { ...saved, ...patch };
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  loadCache = null;
  return next;
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function hasProvider(provider) {
  return !!providerInfo(provider);
}

function setProvider(provider) {
  const preset = providerInfo(provider);
  if (!preset) {
    throw new Error(`Provider tidak dikenal: ${provider}. Pilihan: ${providerList().join(', ')}`);
  }
  saveConfig({ provider, _baseOverride: false });
  return provider;
}

function setKey(provider, key) {
  const saved = readConfig();
  saveConfig({ apiKeys: { ...(saved.apiKeys || {}), [provider]: key } });
  return provider;
}

function getWebsearch() {
  return loadConfig().websearch;
}

function getMcp() {
  const saved = readConfig();
  return saved.mcp && typeof saved.mcp === 'object' ? saved.mcp : {};
}

// setMcp('nama', {command,args,env,cwd,url,trusted,enabled,...}) → tambah/sunting.
function setMcp(name, patch) {
  const saved = readConfig();
  const cur = saved.mcp && typeof saved.mcp === 'object' ? { ...saved.mcp } : {};
  cur[name] = { ...(cur[name] || {}), ...(patch || {}) };
  saveConfig({ mcp: cur });
  return cur[name];
}

function removeMcp(name) {
  const saved = readConfig();
  const cur = saved.mcp && typeof saved.mcp === 'object' ? { ...saved.mcp } : {};
  delete cur[name];
  saveConfig({ mcp: cur });
  return true;
}

function setWebsearch(patch) {
  const saved = readConfig();
  const cur = saved.websearch || {};
  const next = {
    enabled: patch.enabled != null ? !!patch.enabled : !!cur.enabled,
    provider: patch.provider != null ? patch.provider : cur.provider || 'duckduckgo',
    apiKeys: { ...(cur.apiKeys || {}), ...(patch.apiKeys || {}) },
    maxPerRun: patch.maxPerRun != null ? Number(patch.maxPerRun) : Number.isFinite(Number(cur.maxPerRun)) ? Number(cur.maxPerRun) : 5,
    custom: patch.custom != null ? patch.custom : Array.isArray(cur.custom) ? cur.custom : [],
  };
  saveConfig({ websearch: next });
  return next;
}

function setModel(provider, model) {
  const saved = readConfig();
  saveConfig({ models: { ...(saved.models || {}), [provider]: model } });
  return provider;
}

function setBaseUrl(url) {
  return saveConfig({ baseUrl: url, _baseOverride: true });
}

function setPermissions(patch) {
  const saved = readConfig();
  const cur = saved.permissions || {};
  const next = {
    allow: Array.isArray(patch.allow) ? patch.allow : Array.isArray(cur.allow) ? cur.allow : DEFAULT_PERMISSIONS.allow.slice(),
    deny: Array.isArray(patch.deny) ? patch.deny : Array.isArray(cur.deny) ? cur.deny : DEFAULT_PERMISSIONS.deny.slice(),
  };
  saveConfig({ permissions: next });
  return next;
}

function maskKey(key) {
  if (!key) return '(belum di-set)';
  if (key.length <= 8) return '********';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function keysSummary() {
  const saved = readConfig();
  const map = { ...(saved.apiKeys || {}) };
  if (saved.provider && !map[saved.provider]) {
    const resolved = loadConfig().apiKey;
    if (resolved) map[saved.provider] = resolved;
  }
  return Object.keys(PROVIDERS).map((p) => {
    const k = map[p] || '';
    const active = saved.provider === p ? ' *' : '';
    return `  ${p.padEnd(10)} ${maskKey(k)}${active}`;
  });
}

function contextWindow(provider, model) {
  const m = String(model || '').toLowerCase();
  for (const { re, window } of MODEL_CONTEXT) {
    if (re.test(m)) return window;
  }
  return PROVIDER_WINDOW[provider] || 32768;
}

function contextBudget(cfg) {
  const override = Number(cfg && cfg.contextBudget);
  if (Number.isFinite(override) && override > 0) return override;
  const win = contextWindow(cfg && cfg.provider, cfg && cfg.model);
  const reserve = Math.max(1024, Number(cfg && cfg.maxTokens) || 4096);
  const maxByWindow = Math.max(2048, win - reserve);
  return Math.min(maxByWindow, Math.max(2048, Math.floor(win * 0.9)));
}

module.exports = {
  loadConfig,
  saveConfig,
  setProvider,
  setKey,
  setModel,
  setBaseUrl,
  setPermissions,
  maskKey,
  hasProvider,
  keysSummary,
  readConfig,
  getWebsearch,
  setWebsearch,
  getMcp,
  setMcp,
  removeMcp,
  unitCost,
  customProviders,
  customProviderPreset,
  setCustomProvider,
  providerInfo,
  providerList,
  providerDisabled,
  setProviderEnabled,
  manifestProviders,
  manifestUrl,
  setManifestUrl,
  fetchManifest,
  addCustomProvider,
  removeCustomProvider,
  contextWindow,
  contextBudget,
  PROVIDERS,
  CONFIG_FILE,
  DEFAULTS,
  DEFAULT_PERMISSIONS,
};
