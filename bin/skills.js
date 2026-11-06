/**
 * @fileoverview Skill registry and conditional skill activation
 *
 * @module skills
 */
'use strict';

// ── Conditional Skills Registry (bundled + user) ──────────────────────────
// Skill = paket RULES SPESIALIS per tugas (bukan template/layout). Metadata
// (id, deskripsi, triggers, priority, budget) mendukung aktivasi kondisional:
//   - index   : daftar ringkas id — deskripsi, selalu terlihat di konteks.
//   - content : body rules skill, dimuat ON-DEMAND saat task cocok.
//   - match   : pencocokan trigger dari task user → kandidat terurut (score).
// Skill bawaan ada di bin/skills/ (ikut paket); skill buatan user/AI disimpan
// di ~/.niyusha/skills/ supaya tidak hilang saat update paket.
// Integrasi tanpa rebuild: core prompt & tools TIDAK diubah; loader ini hanya
// menambah registry + aktivasi yang dipicu di AI loop.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { unifiedDiff } = require('./diff');

const SKILLS_DIR = path.join(__dirname, 'skills');
const MAX_BODY = 6000;

function userSkillsDir() {
  return process.env.NIYUSHA_SKILLS_DIR || path.join(os.homedir(), '.niyusha', 'skills');
}

function readIf(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function metaOf(base, folder) {
  const dir = path.join(base, folder);
  let meta = {};
  try {
    meta = JSON.parse(readIf(path.join(dir, 'skill.json'))) || {};
  } catch {}
  if (!meta.id) return null;
  return {
    id: meta.id,
    name: meta.name || meta.id,
    folder,
    description: meta.description || '',
    triggers: Array.isArray(meta.triggers) ? meta.triggers : [],
    priority: Number(meta.priority) || 0,
    token_budget: Number(meta.token_budget) || 1200,
    file: meta.file || 'rules.md',
    enabled: meta.enabled !== false,
    dir,
    source: base === SKILLS_DIR ? 'bundled' : 'user',
  };
}

// Semua skill (bawaan dulu, lalu user) — dedupe by id/folder.
function scan() {
  const out = [];
  const seen = new Set();
  for (const base of [SKILLS_DIR, userSkillsDir()]) {
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const inf = metaOf(base, e.name);
      if (!inf) continue;
      const key = String(inf.id || inf.folder).toLowerCase();
      if (seen.has(key) || seen.has(inf.folder.toLowerCase())) continue;
      seen.add(key);
      seen.add(inf.folder.toLowerCase());
      out.push(inf);
    }
  }
  return out;
}

function list() {
  return scan().map((i) => i.folder).sort();
}

function info(id) {
  const s = String(id == null ? '' : id).trim().toLowerCase();
  if (!s) return null;
  return scan().find((i) => i.id.toLowerCase() === s || i.name.toLowerCase() === s || i.folder.toLowerCase() === s) || null;
}

// Cari skill dari id ATAU nama ATAU nama folder (case-insensitive).
function findById(id) {
  return info(id);
}

// Body rules skill (berisi header + isi rules.md), dibatasi token_budget.
function content(id, opts = {}) {
  const inf = typeof id === 'object' ? id : findById(id);
  if (!inf) return null;
  let body = readIf(path.join(inf.dir, inf.file));
  const cap = Number(opts.cap) || inf.token_budget || 1200;
  if (body.length > cap) body = body.slice(0, cap) + `\n…[rules ${inf.id} dipotong]`;
  const head = `## Skill: ${inf.name}` + (inf.description ? ` — ${inf.description}` : '');
  return `${head}\n${body}`;
}

// Daftar ringkas id — deskripsi untuk disuntik di konteks (hemat token).
function index(opts = {}) {
  const disabled = disabledSet(opts.disabled);
  const items = scan()
    .filter((i) => i.enabled && !disabled.has(i.id.toLowerCase()) && !disabled.has(i.name.toLowerCase()));
  if (!items.length) return null;
  items.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const maxChars = Number(opts.maxChars) || 500;
  const lines = [];
  let used = 0;
  for (const it of items) {
    const desc = String(it.description || '').replace(/\s+/g, ' ').trim();
    const line = `${it.id} — ${desc.slice(0, 80)}`;
    if (used + line.length > maxChars && lines.length) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

// Cocokkan trigger dari teks tugas → kandidat diurut (score, lalu priority).
function match(text, opts = {}) {
  const txt = String(text || '').toLowerCase();
  const disabled = disabledSet(opts.disabled);
  const out = [];
  for (const inf of scan()) {
    if (inf.enabled === false || disabled.has(inf.id.toLowerCase()) || disabled.has(inf.name.toLowerCase())) continue;
    const trigs = inf.triggers || [];
    let score = 0;
    const hits = [];
    for (const t of trigs) {
      const w = String(t).trim().toLowerCase();
      if (!w) continue;
      if (txt.includes(w)) {
        score += w.length >= 3 ? 1 : 0.4;
        hits.push(w);
      }
    }
    if (score > 0) {
      out.push({ id: inf.id, name: inf.name, score, hits, reason: `trigger: ${hits.join(' / ')}`, priority: inf.priority });
    }
  }
  out.sort((a, b) => b.score - a.score || b.priority - a.priority);
  return out;
}

function disabledSet(maybe) {
  return new Set((Array.isArray(maybe) ? maybe : []).map((d) => String(d).trim().toLowerCase()).filter(Boolean));
}

function normalizeId(raw) {
  const s = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  return /^[a-z0-9][a-z0-9_-]{0,47}$/.test(s) ? s : null;
}

// Siapkan isi file + diff untuk review user. Tidak menyentuh disk.
function previewSave(spec) {
  const src = spec || {};
  const id = normalizeId(src.id);
  const description = String(src.description || '').replace(/\s+/g, ' ').trim();
  const body = String(src.body || '').trim();
  if (!id) return { error: 'id skill tidak valid (huruf kecil/angka, - atau _, maks 48).' };
  if (!description) return { error: 'description wajib (ringkas 1 baris).' };
  if (!body) return { error: 'body wajib (rules ringkas).' };
  if (body.length > MAX_BODY) return { error: `body terlalu panjang (${body.length} > ${MAX_BODY} karakter) — ringkas kemampuan sesi, jangan salin transkrip.` };
  const bundled = scan().find((i) => i.source === 'bundled' && (i.id.toLowerCase() === id || i.folder.toLowerCase() === id));
  if (bundled) return { error: `id '${id}' dipakai skill bawaan '${bundled.id}' — pilih id lain.` };

  const dir = path.join(userSkillsDir(), id);
  const meta = {
    id,
    name: String(src.name || id).trim() || id,
    description,
    triggers: Array.isArray(src.triggers) ? src.triggers.map((t) => String(t).trim()).filter(Boolean) : [],
    priority: Number(src.priority) || 55,
    token_budget: Number(src.token_budget) || 1200,
    file: 'rules.md',
  };
  const metaText = JSON.stringify(meta, null, 2) + '\n';
  const bodyText = body.endsWith('\n') ? body : body + '\n';
  const oldMeta = readIf(path.join(dir, 'skill.json'));
  const oldBody = readIf(path.join(dir, 'rules.md'));
  const created = !oldMeta && !oldBody;

  const parts = [];
  const addDiff = (file, before, after) => {
    if (before === after) return;
    parts.push(`--- a/${file}`, `+++ b/${file}`);
    for (const op of unifiedDiff(before, after, { context: 2 })) {
      parts.push(op.type === ' ' ? ' ' + op.text : op.type === '@' ? '⋯' : op.type + op.text);
    }
  };
  addDiff(`skills/${id}/skill.json`, oldMeta, metaText);
  addDiff(`skills/${id}/rules.md`, oldBody, bodyText);

  return {
    id,
    dir,
    created,
    unchanged: parts.length === 0,
    metaText,
    bodyText,
    diff: parts.join('\n'),
  };
}

function saveSkill(spec) {
  const p = previewSave(spec);
  if (!p || p.error) return p || { error: 'gagal menyiapkan skill.' };
  if (p.unchanged) return { id: p.id, dir: p.dir, created: p.created, unchanged: true, chars: 0 };
  try {
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'skill.json'), p.metaText);
    fs.writeFileSync(path.join(p.dir, 'rules.md'), p.bodyText);
  } catch (e) {
    return { error: `gagal menulis skill: ${e.message}` };
  }
  return {
    id: p.id,
    dir: p.dir,
    created: p.created,
    unchanged: false,
    chars: p.metaText.length + p.bodyText.length,
  };
}

function removeSkill(id) {
  const n = normalizeId(id);
  if (!n) return false;
  const inf = scan().find((i) => i.source === 'user' && (i.id.toLowerCase() === n || i.folder.toLowerCase() === n));
  if (!inf) return false;
  try {
    fs.rmSync(inf.dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  list,
  info,
  findById,
  content,
  index,
  match,
  previewSave,
  saveSkill,
  removeSkill,
  normalizeId,
  SKILLS_DIR,
  userSkillsDir,
  MAX_BODY,
};
