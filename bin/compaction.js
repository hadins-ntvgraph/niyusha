/**
 * @fileoverview Context compaction module for Niyusha TUI
 *
 * Provides multiple compaction modes (legacy, shadow, safe, experimental, urich, off)
 * with archive-before-compact safety. Supports two-tier memory management
 * and state preservation across compaction cycles.
 *
 * @module compaction
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MODES = new Set(['legacy', 'shadow', 'safe', 'experimental', 'urich', 'off']);

function normalizeCompactionMode(value) {
  const mode = String(value || 'legacy').trim().toLowerCase();
  return MODES.has(mode) ? mode : 'legacy';
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safePart(value, fallback) {
  const part = String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  return part || fallback;
}

function archiveRoot(config = {}) {
  return path.resolve(String(config.compactionArchiveDir || path.join(os.homedir(), '.niyusha', 'compaction')));
}

function archiveFile({ config = {}, workspace = process.cwd(), sessionId = 'default' } = {}) {
  const workspaceKey = hashText(path.resolve(String(workspace))).slice(0, 24);
  return path.join(archiveRoot(config), workspaceKey, `${safePart(sessionId, 'session')}.jsonl`);
}


function withArchiveLock(file, fn) {
  const lockFile = `${file}.lock`;
  const started = Date.now();
  let acquired = false;
  while (!acquired && Date.now() - started <= 5000) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.closeSync(fd);
      acquired = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  if (!acquired) throw new Error(`archive lock timeout: ${lockFile}`);
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockFile); } catch {}
  }
}

function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch {
      // Recovery: skip malformed or partial JSONL lines.
    }
  }
  return records;
}

function archiveHistory({ config = {}, workspace, sessionId, history, summary = null, state = null, mode = 'legacy' } = {}) {
  if (!Array.isArray(history)) throw new TypeError('history harus berupa array');
  const file = archiveFile({ config, workspace, sessionId });
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const serialized = JSON.stringify(history);
  const record = {
    version: 1,
    checkpoint_id: `cp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    session_id: safePart(sessionId, 'session'),
    workspace: path.resolve(String(workspace || process.cwd())),
    created_at: new Date().toISOString(),
    mode: normalizeCompactionMode(mode),
    history_hash: hashText(serialized),
    message_count: history.length,
    summary: summary == null ? null : String(summary),
    state: state == null ? null : state,
    messages: history,
  };
  withArchiveLock(file, () => {
    // Append-only write preserves prior records and avoids rewriting the whole archive.
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  });
  return { ...record, file };
}

function latestArchive({ config = {}, workspace, sessionId } = {}) {
  const file = archiveFile({ config, workspace, sessionId });
  const records = readJsonl(file);
  return records.length ? { ...records[records.length - 1], file } : null;
}

function compactText(history, summary) {
  const messages = Array.isArray(history) ? history : [];
  return `${String(summary || '')}\n${messages.map((m) => (m && m.content ? String(m.content) : '')).join('\n')}`.toLowerCase();
}

function normalizeFileReference(value, { preserveCase = false } = {}) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^(?:\.\/)+/, '');
  return preserveCase ? normalized : normalized.toLowerCase();
}

function extractFileReferences(text, { preserveCase = false } = {}) {
  const references = new Set();
  const filePattern =
    /(?<![\w.-])(?:[a-z]:[\\/])?(?:\.{1,2}[\\/])?(?:[\w.-]+[\\/])*[\w.-]+\.(?:json|html|css|py|md|ts|js)(?![\w-])/gi;
  for (const match of String(text || '').matchAll(filePattern)) {
    const reference = normalizeFileReference(match[0], { preserveCase });
    if (reference) references.add(reference);
  }
  return references;
}

function extractUserFileReferences(history, { preserveCase = false } = {}) {
  const references = new Set();
  for (const message of Array.isArray(history) ? history : []) {
    if (!message || message.role !== 'user' || typeof message.content !== 'string') continue;
    for (const reference of extractFileReferences(message.content, { preserveCase })) references.add(reference);
  }
  return references;
}

function validateCompactionResult({ originalHistory, candidateHistory, summary, preserveCase = false } = {}) {
  const reasons = [];
  const source = compactText(originalHistory, '');
  const result = compactText(candidateHistory, summary);
  if (!String(summary || '').trim()) reasons.push('summary kosong');
  if (!Array.isArray(candidateHistory) || !candidateHistory.length) reasons.push('candidate history kosong');
  if (Array.isArray(originalHistory) && originalHistory.some((m) => m && m.role === 'user') &&
      !candidateHistory.some((m) => m && m.role === 'user')) {
    reasons.push('pesan user hilang');
  }
  const labels = [
    ['tujuan', /\b(tujuan|goal|tugas inti)\b/i],
    ['keputusan', /\b(keputusan|decision)\b/i],
    ['file', /\b(file|path|berkas)\b/i],
    ['error', /\b(error|gagal|blocker|masalah)\b/i],
    ['test', /\b(test|tes|verifikasi)\b/i],
    ['langkah berikutnya', /\b(next step|langkah berikutnya|selanjutnya)\b/i],
  ];
  for (const [name, re] of labels) {
    if (re.test(source) && !re.test(result)) reasons.push(`metadata ${name} tidak terjaga`);
  }
  const fileReferences = extractUserFileReferences(originalHistory, { preserveCase });
  const preservedFileReferences = extractFileReferences(
    `${String(summary || '')}\n${(Array.isArray(candidateHistory) ? candidateHistory : [])
      .map((message) => (message && message.content ? String(message.content) : ''))
      .join('\n')}`,
    { preserveCase }
  );
  for (const reference of fileReferences) {
    const preserved = [...preservedFileReferences].some(
      (candidate) =>
        candidate === reference ||
        candidate.endsWith(`/${reference}`) ||
        reference.endsWith(`/${candidate}`)
    );
    if (!preserved) reasons.push(`path/file hilang: ${reference}`);
  }
  return { ok: reasons.length === 0, reasons };
}

function splitSentencesLocal(value) {
  return String(value || '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Repair a compaction candidate instead of rejecting it. Missing metadata,
 * user messages, and file references are carried over from the original
 * history so that compaction almost always succeeds.
 */
function repairCompactionResult({ originalHistory, candidateHistory, summary, preserveCase = false } = {}) {
  const original = Array.isArray(originalHistory) ? originalHistory : [];
  const candidate = Array.isArray(candidateHistory)
    ? candidateHistory.filter(Boolean).map((message) => ({ ...message }))
    : [];
  let summaryText = String(summary || '');
  const additions = [];
  if (original.length && !candidate.some((message) => message && message.role === 'user')) {
    const firstUser = original.find((message) => message && message.role === 'user');
    if (firstUser) {
      candidate.unshift({ ...firstUser });
      additions.push('pesan user');
    }
  }
  const source = compactText(original, '');
  const resultText = () => compactText(candidate, summaryText);
  const labels = [
    ['tujuan', /\b(tujuan|goal|tugas inti)\b/i],
    ['keputusan', /\b(keputusan|decision)\b/i],
    ['file', /\b(file|path|berkas)\b/i],
    ['error', /\b(error|gagal|blocker|masalah)\b/i],
    ['test', /\b(test|tes|verifikasi)\b/i],
    ['langkah berikutnya', /\b(next step|langkah berikutnya|selanjutnya)\b/i],
  ];
  for (const [name, re] of labels) {
    if (!re.test(source) || re.test(resultText())) continue;
    const sentence = splitSentencesLocal(source).find((line) => re.test(line));
    if (!sentence) continue;
    const line = `- ${name}: ${sentence.slice(0, 160)}`;
    summaryText = summaryText ? `${summaryText}\n${line}` : line;
    additions.push(name);
  }
  const fileReferences = extractUserFileReferences(original, { preserveCase });
  const preserved = extractFileReferences(
    `${summaryText}\n${candidate.map((message) => (message && message.content ? String(message.content) : '')).join('\n')}`,
    { preserveCase }
  );
  const missing = [...fileReferences].filter(
    (reference) =>
      ![...preserved].some(
        (item) =>
          item === reference ||
          item.endsWith(`/${reference}`) ||
          reference.endsWith(`/${item}`)
      )
  );
  if (missing.length) {
    const line = `- file/path penting: ${missing.join(', ')}`;
    summaryText = summaryText ? `${summaryText}\n${line}` : line;
    additions.push(...missing.map((reference) => `file:${reference}`));
  }
  return { summary: summaryText, candidateHistory: candidate, additions };
}

module.exports = {
  MODES,
  normalizeCompactionMode,
  archiveFile,
  archiveHistory,
  latestArchive,
  validateCompactionResult,
  repairCompactionResult,
};
