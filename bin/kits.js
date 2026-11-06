/**
 * @fileoverview Kit management for web components and templates
 *
 * @module kits
 */
'use strict';

// ── Loader Niyusha Kits (dibundel di bin/kits/) ─────────────────────────
// Kit = paket gaya khas Niyusha (tokens + aturan + komponen + template).
// Dimuat ON-DEMAND (via use_skill / /kit), TIDAK masuk overhead dasar.

const fs = require('fs');
const path = require('path');

const KITS_DIR = path.join(__dirname, 'kits');

function readIf(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function list() {
  try {
    return fs
      .readdirSync(KITS_DIR)
      .filter((d) => {
        try {
          return fs.statSync(path.join(KITS_DIR, d)).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function info(name) {
  const dir = path.join(KITS_DIR, String(name || ''));
  if (!dir.startsWith(KITS_DIR)) return null;
  const metaRaw = readIf(path.join(dir, 'kit.json'));
  if (!metaRaw) return null;
  let meta = {};
  try {
    meta = JSON.parse(metaRaw);
  } catch {}
  return { name: meta.name || path.basename(dir), folder: path.basename(dir), dir, meta };
}

function listFiles(d, ext) {
  try {
    return fs.readdirSync(d).filter((f) => !ext || f.endsWith(ext));
  } catch {
    return [];
  }
}

// Cari kit dari nama skill (mis. 'niyusha-web-kit') ATAU nama folder ('web').
function findByName(name) {
  const s = String(name || '').toLowerCase().trim();
  if (!s) return null;
  for (const d of list()) {
    const i = info(d);
    if (i && (d.toLowerCase() === s || i.name.toLowerCase() === s)) return i;
  }
  return null;
}

// Konten kit untuk disuntik ke konteks saat dipakai (on-demand).
function content(name) {
  const i = info(name) || findByName(name);
  if (!i) return null;
  const dir = i.dir;
  const tokens = readIf(path.join(dir, 'tokens.json'));
  const rules = readIf(path.join(dir, 'rules', 'rules.md')) || readIf(path.join(dir, 'rules.md'));
  const compDir = path.join(dir, 'components');
  const tmplDir = path.join(dir, 'templates');
  const comps = listFiles(compDir, '.html');
  const tmpls = listFiles(tmplDir, '.html');
  const main = tmpls.find((t) => /landing/.test(t)) || tmpls[0];

  let out = `## Kit Niyusha: ${i.name}${i.meta && i.meta.description ? ' — ' + i.meta.description : ''}\n`;
  if (i.meta && i.meta.zero_dep) out += 'Zero-dep (tanpa CDN).\n';
  if (tokens) out += `\n### tokens.json — WAJIB dipakai via variabel/CSS var (jangan hardcode warna sembarang)\n\`\`\`json\n${tokens}\n\`\`\`\n`;
  if (rules) out += `\n### Aturan kit (WAJIB dipatuhi)\n${rules}\n`;
  // Section yang sudah tertanam di template utama → dilewati agar tidak dobel
  // (hemat token; komponen yang benar-benar "tambahan" saja yang disuntik).
  const COVERED = /^(nav|hero|features|stats|cta|footer|background)\.html$/i;
  const shown = main ? comps.filter((f) => !COVERED.test(f)) : comps;
  if (shown.length) {
    out += main
      ? '\n### Komponen tambahan (tidak ada di template) — rangkai ulang, jangan salin mentah\n'
      : '\n### Komponen referensi — RANGKAI ULANG, jangan salin mentah\n';
    for (const f of shown) out += `\n**${f}**\n\`\`\`html\n${readIf(path.join(compDir, f))}\n\`\`\`\n`;
  }
  if (main) {
    out += `\n### Template contoh (${main}) — adaptasi & kembangkan, JANGAN menyalin bulat supaya tidak seragam\n\`\`\`html\n${readIf(path.join(tmplDir, main))}\n\`\`\`\n`;
  }
  if (tmpls.length) out += `\nTemplate tersedia: ${tmpls.join(', ')}\n`;
  return out;
}

module.exports = { list, info, findByName, content, KITS_DIR };
