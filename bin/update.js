/**
 * @fileoverview Update checking and version management
 *
 * @module update
 */
'use strict';

// ─── Pemeriksa update (zero-dependency) ────────────────────────────────
// Ambil versi terbaru dari registry npm, bandingkan dengan versi lokal.
// Non-blok: cek cache dulu (instan), refresh latar maks 1×/24 jam, timeout
// pendek, diam bila offline. Timer di-unref agar tidak menahan event loop.
// Dimatikan oleh: config updateCheck=false, env NO_UPDATE_NOTIFIER / CI /
// NIYUSHA_NO_UPDATE_CHECK.

const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_FILE = process.env.NIYUSHA_UPDATE_CACHE || path.join(os.homedir(), '.niyusha', 'update.json');
const REGISTRY_URL = process.env.NIYUSHA_UPDATE_URL || 'https://registry.npmjs.org/niyusha/latest';
const DEFAULT_CACHE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 2000;

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || '' };
}

function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return 0;
  if (A.major !== B.major) return A.major < B.major ? -1 : 1;
  if (A.minor !== B.minor) return A.minor < B.minor ? -1 : 1;
  if (A.patch !== B.patch) return A.patch < B.patch ? -1 : 1;
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre < B.pre ? -1 : 1;
}

function isNewer(latest, current) {
  return compareVersions(latest, current) > 0;
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(obj) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));
  } catch {}
}

function isDisabled(opts) {
  if (opts && opts.enabled === false) return true;
  const e = process.env || {};
  if (e.NO_UPDATE_NOTIFIER) return true;
  if (e.NIYUSHA_NO_UPDATE_CHECK) return true;
  if (e.CI && !e.NIYUSHA_FORCE_UPDATE_CHECK) return true;
  return false;
}

// Hasil dari cache saja (tanpa jaringan) — untuk tampilan instan saat start.
function cachedUpdate(current, opts = {}) {
  if (isDisabled(opts)) return null;
  const c = readCache();
  if (!c || !c.latest || !isNewer(c.latest, current)) return null;
  return { current, latest: c.latest, updateAvailable: true, fromCache: true };
}

function isStale(cache, cacheMs) {
  if (!cache || !cache.checkedAt) return true;
  return Date.now() - cache.checkedAt > cacheMs;
}

async function checkForUpdate(current, opts = {}) {
  if (isDisabled(opts)) return null;
  const cacheMs = Number(opts.cacheMs) || DEFAULT_CACHE_MS;
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const cache = readCache();
  if (!opts.force && !isStale(cache, cacheMs)) return cachedUpdate(current, opts);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (timer.unref) timer.unref();
  let latest = null;
  try {
    const res = await fetch(REGISTRY_URL, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      if (data && data.version) latest = String(data.version);
    }
  } catch {
    // offline / timeout / error → diam
  } finally {
    clearTimeout(timer);
  }
  writeCache({ checkedAt: Date.now(), latest: latest || (cache && cache.latest) || null });
  if (!latest || !isNewer(latest, current)) return null;
  return { current, latest, updateAvailable: true, fromCache: false };
}

module.exports = { checkForUpdate, cachedUpdate, compareVersions, isNewer, parseVersion, CACHE_FILE };
