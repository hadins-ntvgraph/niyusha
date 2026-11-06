/**
 * @fileoverview Terminal user interface with rich rendering
 *
 * @module tui
 */
'use strict';

const path = require('path');
const fs = require('fs');

// Teks footer credit (default OFF). Satu sumber biar konsisten & mudah diganti.
const CREDIT_TEXT = 'Made with NTVGraph × Niyusha';

const {
  loadConfig,
  setProvider,
  setKey,
  setModel,
  setPermissions,
  saveConfig,
  providerList,
  providerInfo,
  providerDisabled,
  setProviderEnabled,
  manifestUrl,
  setManifestUrl,
  fetchManifest,
  addCustomProvider,
  removeCustomProvider,
  setCustomProvider,
  maskKey,
  PROVIDERS,
  getWebsearch,
  setWebsearch,
  getMcp,
  setMcp,
  removeMcp,
  contextWindow,
  contextBudget,
  unitCost,
  DEFAULT_PERMISSIONS,
} = require('./config');

const { SYSTEM_PROMPT } = require('./ai');
const { unifiedDiff, summarize } = require('./diff');
const { KNOWN, knownProviders } = require('./search');
const { runCommand, describeShell } = require('./runner');
const { MCPManager } = require('./mcp');
const { readNote, saveNote, clearNote, saveLastCopy, saveAutosave, readAutosave, clearAutosave, appendLog, readLogs } = require('./store');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  inverse: '\x1b[7m',
  orange: '\x1b[38;5;208m',
  sky: '\x1b[38;5;117m',
  teal: '\x1b[38;5;80m',
  violet: '\x1b[38;5;141m',
  slate: '\x1b[38;5;103m',
  heading: '\x1b[38;5;195m',
  chipBg: '\x1b[48;5;236m',
  orangeBg: '\x1b[48;5;94m',
  border: '\x1b[38;5;240m',
  borderAccent: '\x1b[38;5;141m',
  accent: '\x1b[38;5;213m',
  success: '\x1b[38;5;84m',
  warning: '\x1b[38;5;221m',
  muted: '\x1b[38;5;242m',
  successBg: '\x1b[48;5;22m',
  infoBg: '\x1b[48;5;17m',
  glow: '\x1b[38;5;225m',
  borderRounded: '\x1b[38;5;245m',
};

// Snapshot palet dasar — dipakai untuk reset saat ganti tema.
const C_BASE = { ...C };

// ─── Tema warna ───
// Palet disimpan sebagai override parsial atas C_BASE; applyTheme selalu
// RESET dulu supaya ganti tema tidak menumpuk override lama.
const THEME_DEFS = {
  'dark-blue': { label: 'Dark Navy (default)', colors: {} },
  matrix: {
    label: 'Matrix Green',
    colors: {
      green: '\x1b[92m',
      cyan: '\x1b[32m',
      sky: '\x1b[38;5;84m',
      teal: '\x1b[38;5;78m',
      violet: '\x1b[38;5;71m',
      slate: '\x1b[38;5;65m',
      yellow: '\x1b[38;5;106m',
      heading: '\x1b[38;5;194m',
      chipBg: '\x1b[48;5;22m',
    },
  },
  cyberpunk: {
    label: 'Cyberpunk Neon',
    colors: {
      cyan: '\x1b[95m',
      sky: '\x1b[38;5;213m',
      teal: '\x1b[38;5;205m',
      violet: '\x1b[38;5;165m',
      slate: '\x1b[38;5;139m',
      yellow: '\x1b[38;5;227m',
      green: '\x1b[38;5;84m',
      red: '\x1b[38;5;204m',
      heading: '\x1b[38;5;225m',
      chipBg: '\x1b[48;5;53m',
    },
  },
  slate: {
    label: 'Slate Dark',
    colors: {
      sky: '\x1b[38;5;109m',
      teal: '\x1b[38;5;109m',
      violet: '\x1b[38;5;146m',
      slate: '\x1b[38;5;66m',
      cyan: '\x1b[38;5;109m',
      yellow: '\x1b[38;5;179m',
      heading: '\x1b[38;5;253m',
      chipBg: '\x1b[48;5;238m',
    },
  },
  midnight: {
    label: 'Midnight OLED',
    colors: {
      sky: '\x1b[97m',
      teal: '\x1b[37m',
      violet: '\x1b[37m',
      slate: '\x1b[90m',
      cyan: '\x1b[97m',
      yellow: '\x1b[93m',
      green: '\x1b[92m',
      red: '\x1b[91m',
      heading: '\x1b[97m',
      chipBg: '\x1b[48;5;235m',
    },
  },
};

function applyTheme(name) {
  const def = THEME_DEFS[name] || THEME_DEFS['dark-blue'];
  Object.assign(C, C_BASE, def.colors || {});
  // Prefix TYPE_STYLE dibuat dari string ANSI saat module load; bangun ulang
  // supaya warna error/info/note/result ikut tema yang baru.
  if (typeof refreshTypeStyle === 'function') refreshTypeStyle();
  gradientCache.clear();
  brandCache.clear();
  return def;
}

// Cuplikan warna tema untuk picker — tanpa mengubah tema aktif.
function previewSwatch(name) {
  const def = THEME_DEFS[name] || THEME_DEFS['dark-blue'];
  const c = { ...C_BASE, ...(def.colors || {}) };
  return p(c.sky, '▉') + p(c.teal, '▉') + p(c.violet, '▉') + p(c.yellow, '▉') + p(c.green, '▉') + p(c.red, '▉');
}

const p = (c, s) => `${c}${s}${C.reset}`;

// Chip/badge: teks di atas latar redup. Tidak menambah lebar (murni SGR).
const chip = (text, fg = C.heading, bg = C.chipBg) => `${bg}${fg} ${text} ${C.reset}`;
// Nama tombol pada baris bantuan.
const key = (k) => p(C.sky + C.bold, k);
// Teks keterangan pada baris bantuan (abu-abu, beda dari tombol).
const lbl = (t) => p(C.gray, t);
// Judul seksi sidebar dengan aksen ▌ oranye (seragam).
const sec = (label, right, w, color) => row(p((color || C.orange) + C.bold, '▌') + p(C.heading + C.bold, ' ' + label), right || '', w);

// ─── Notifikasi desktop (OSC 777 umum + OSC 9 iTerm2/macOS) ───
const osc = (code, ...parts) => `\x1b]${code};${parts.join(';')}\x07`;
// Notifikasi desktop: OSC 777 (umum) + OSC 9 (iTerm2/macOS).
function notify(title, body) {
  try {
    const clean = (s) => String(s).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 120);
    const t = clean(title);
    const b = clean(body);
    process.stdout.write(osc(777, 'notify', t, b) + osc(9, `${t} — ${b}`));
  } catch {}
}
// Suara notifikasi OS (fire-and-forget; kalau gagal → fallback BEL).
// ding  = chime info sistem (Windows Asterisk · macOS Glass · Linux bell)
function playDing() {
  try {
    const { spawn } = require('child_process');
    let child;
    if (process.platform === 'win32') {
      child = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', '[System.Media.SystemSounds]::Asterisk.Play()'], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });
    } else if (process.platform === 'darwin') {
      child = spawn('afplay', ['/System/Library/Sounds/Glass.aiff'], { stdio: 'ignore', detached: true });
    } else {
      process.stdout.write('\x07');
      return;
    }
    child.on('error', () => {
      try {
        process.stdout.write('\x07');
      } catch {}
    });
    child.unref();
  } catch {
    try {
      process.stdout.write('\x07');
    } catch {}
  }
}
// Suara selesai: bell (BEL) · double (2x BEL) · ding (suara sistem).
function playSound(kind) {
  try {
    if (kind === 'ding') playDing();
    else if (kind === 'double') process.stdout.write('\x07\x07');
    else process.stdout.write('\x07');
  } catch {}
}

// ─── Syntax highlight (regex tokenizer; pewarnaan disisipkan setelah wrap,
//      jadi lebar kolom tidak pernah berubah) ───
const HL_STYLE = {
  cmt: '\x1b[3;38;5;244m', // komentar — abu redup italic
  str: '\x1b[38;5;114m', // string — hijau lembut
  num: '\x1b[38;5;215m', // angka — oranye
  kw: '\x1b[1;38;5;141m', // keyword — violet bold
  fn: '\x1b[38;5;117m', // nama fungsi — sky
  built: '\x1b[38;5;80m', // builtin/konstanta — teal
  key: '\x1b[1;38;5;117m', // key JSON — sky bold
  tag: '\x1b[1;38;5;176m', // tag HTML — ungu bold
  attr: '\x1b[38;5;222m', // atribut HTML — kuning
  prop: '\x1b[38;5;117m', // property CSS — sky
  dec: '\x1b[38;5;215m', // decorator Python — oranye
  var: '\x1b[38;5;215m', // variabel shell — oranye
};

function paintHL(type, text) {
  const s = HL_STYLE[type];
  return s ? `${s}${text}${C.reset}` : text;
}

// Aturan per bahasa, urutan = prioritas (komentar & string lebih dulu).
const HL_RULES = {
  js: [
    ['cmt', /\/\/[^\n]*/y],
    ['cmt', /\/\*[\s\S]*?\*\//y],
    ['str', /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/y],
    ['num', /\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
    ['kw', /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|default|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|await|async|try|catch|finally|throw|delete|void|yield|import|export|from|as|static|get|set)\b/y],
    ['built', /\b(?:console|window|document|require|module|exports|process|globalThis|Math|JSON|Object|Array|String|Number|Boolean|Promise|Map|Set|WeakMap|Date|RegExp|Error|fetch|setTimeout|setInterval|queueMicrotask|true|false|null|undefined|NaN)\b/y],
    ['fn', /[A-Za-z_$][\w$]*(?=\s*\()/y],
  ],
  py: [
    ['cmt', /#[^\n]*/y],
    ['str', /(?:[rRbBuUfF]{0,2})(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/y],
    ['num', /\b\d[\d_]*(?:\.\d+)?\b/y],
    ['kw', /\b(?:def|class|return|if|elif|else|for|while|break|continue|and|or|not|in|is|import|from|as|with|try|except|finally|raise|lambda|pass|yield|global|nonlocal|assert|del|async|await|match|case)\b/y],
    ['built', /\b(?:print|len|range|str|int|float|list|dict|set|tuple|bool|type|isinstance|super|open|enumerate|zip|map|filter|sum|min|max|abs|sorted|any|all|input|self|None|True|False|Exception|ValueError|TypeError|KeyError)\b/y],
    ['dec', /@[\w.]+/y],
    ['fn', /[A-Za-z_]\w*(?=\s*\()/y],
  ],
  html: [
    ['cmt', /<!--[\s\S]*?-->/y],
    ['tag', /<\/?[a-zA-Z][\w:-]*/y],
    ['tag', /\/?>/y],
    ['attr', /[a-zA-Z-]+(?==)/y],
    ['str', /"[^"]*"|'[^']*'/y],
  ],
  css: [
    ['cmt', /\/\*[\s\S]*?\*\//y],
    ['kw', /@[\w-]+/y],
    ['str', /"[^"\n]*"|'[^'\n]*'/y],
    ['built', /#[0-9a-fA-F]{3,8}\b/y],
    ['prop', /[-a-zA-Z]+(?=\s*:)/y],
    ['num', /-?\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg|fr|ch|pt)?\b/y],
  ],
  sh: [
    ['cmt', /#[^\n]*/y],
    ['str', /"(?:[^"\\]|\\.)*"|'[^']*'/y],
    ['var', /\$\{?[A-Za-z_]\w*\}?/y],
    ['kw', /\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|exit|local|export|source|echo|cd|set|unset|trap)\b/y],
    ['built', /\b(?:npm|npx|yarn|pnpm|node|git|python3?|pip|curl|wget|ls|cat|grep|sed|awk|mkdir|rm|cp|mv|chmod|sudo|docker|kubectl|make|cargo|go)\b/y],
    ['num', /\b\d+\b/y],
  ],
  json: [
    ['cmt', /\/\/[^\n]*/y],
    ['key', /"(?:[^"\\]|\\.)*"(?=\s*:)/y],
    ['str', /"(?:[^"\\]|\\.)*"/y],
    ['num', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
    ['built', /\b(?:true|false|null)\b/y],
  ],
};

function langFamily(lang) {
  const l = String(lang || '').toLowerCase().replace(/^language-/, '');
  if (!l) return null;
  if (/^(js|javascript|jsx|ts|typescript|tsx|mjs|cjs|node)$/.test(l)) return 'js';
  if (/^(py|python|python3)$/.test(l)) return 'py';
  if (/^(html|xml|vue|svelte|svg)$/.test(l)) return 'html';
  if (/^(css|scss|sass|less)$/.test(l)) return 'css';
  if (/^(sh|bash|zsh|shell|console|terminal)$/.test(l)) return 'sh';
  if (/^(json|jsonc)$/.test(l)) return 'json';
  return null;
}

// Peta tipe per karakter (null = polos). null kalau bahasa tak didukung.
function tokenizeTypes(str, fam) {
  const rules = HL_RULES[fam];
  if (!rules) return null;
  const chars = [...str];
  const types = new Array(chars.length).fill(null);
  let i = 0;
  let guard = 0;
  while (i < chars.length && guard++ < 20000) {
    let matched = false;
    for (const [type, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(str);
      if (m && m[0]) {
        const n = [...m[0]].length;
        for (let k = 0; k < n && i + k < chars.length; k++) types[i + k] = type;
        i += n;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return types;
}

// Gabungkan karakter bertetangga bertipe sama jadi satu run berwarna.
function colorRuns(chars) {
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const t = chars[i].t;
    let j = i;
    while (j < chars.length && chars[j].t === t) j++;
    const text = chars.slice(i, j).map((c) => c.ch).join('');
    out += t ? paintHL(t, text) : text;
    i = j;
  }
  return out;
}

// Kembar wrap() dengan pewarnaan token. Lebar tampilan identik dengan wrap()
// karena pemotongan dilakukan pada teks polos; warna disisipkan setelahnya.
function highlightWrap(line, width, fam) {
  const src = String(line);
  const types = tokenizeTypes(src, fam);
  if (!types) return wrap(src, width);
  width = Math.max(8, width);
  const out = [];
  for (const para of src.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    let lineChars = [];
    let lineW = 0;
    const flushLine = () => {
      if (lineChars.length) out.push(colorRuns(lineChars));
      lineChars = [];
      lineW = 0;
    };
    let pos = 0;
    for (const w of para.split(' ')) {
      const start = pos;
      pos += w.length + 1;
      if (!w) continue;
      const wChars = [];
      let wW = 0;
      for (let k = 0; k < w.length; k++) {
        const cw = dispWidth(w[k]);
        wChars.push({ ch: w[k], t: types[start + k] });
        wW += cw;
      }
      if (wW > width) {
        flushLine();
        let buf = [];
        let bufW = 0;
        for (const c of wChars) {
          const cw = dispWidth(c.ch);
          if (bufW + cw > width && bufW > 0) {
            out.push(colorRuns(buf));
            buf = [];
            bufW = 0;
          }
          buf.push(c);
          bufW += cw;
        }
        lineChars = buf;
        lineW = bufW;
        continue;
      }
      const sep = lineW > 0 ? 1 : 0;
      if (lineW + sep + wW <= width) {
        if (sep) lineChars.push({ ch: ' ', t: null });
        lineChars.push(...wChars);
        lineW += sep + wW;
      } else {
        flushLine();
        lineChars = wChars;
        lineW = wW;
      }
    }
    flushLine();
  }
  return out.length ? out : [''];
}

// ─── Truecolor & gradient ───
const GRAD_STOPS = ['#22d3ee', '#38bdf8', '#818cf8', '#c084fc'];
const fallbackGrad = () => [C.cyan, C.sky, C.violet];

function trueColorSupported() {
  if (process.env.NIYUSHA_TRUECOLOR === '0') return false;
  if (process.env.COLORTERM) return true;
  if (process.env.TERM_PROGRAM) return true; // iTerm2, WezTerm, Hyper, vscode
  if (process.env.WT_SESSION) return true; // Windows Terminal
  return /kitty|alacritty|foot|wezterm|contour|ghostty/i.test(process.env.TERM || '');
}

function gradientText(text, stops) {
  const chars = [...text];
  if (chars.length < 2) return text;
  const rgbs = stops.map((h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  let out = '';
  chars.forEach((ch, i) => {
    const t = i / (chars.length - 1);
    const seg = t * (rgbs.length - 1);
    const s = Math.min(rgbs.length - 2, Math.floor(seg));
    const f = seg - s;
    const a = rgbs[s];
    const b = rgbs[s + 1];
    const r = Math.round(a[0] + (b[0] - a[0]) * f);
    const g = Math.round(a[1] + (b[1] - a[1]) * f);
    const bl = Math.round(a[2] + (b[2] - a[2]) * f);
    out += `\x1b[38;2;${r};${g};${bl}m${ch}`;
  });
  return out + C.reset;
}

// ─── Skin WOW ───
// Titik lampu ala macOS (merah/kuning/hijau) — warna tetap, tidak ikut tema.
const TL = { red: '\x1b[38;5;203m', yellow: '\x1b[38;5;221m', green: '\x1b[38;5;114m' };
function trafficLights(w = 1) {
  const dot = (c) => p(c, '●'.repeat(w));
  return `${dot(TL.red)} ${dot(TL.yellow)} ${dot(TL.green)}`;
}
const TL_W = 6; // "● ● ● " = 6 kolom

// Garis pemisah gradient tipis (rambut violet→cyan) — fallback abu tanpa truecolor.
const gradientCache = new Map();
const brandCache = new Map();

function gradientLine(ch, width) {
  const cacheKey = `${ch}|${width}|${trueColorSupported() ? 1 : 0}`;
  const cached = gradientCache.get(cacheKey);
  if (cached != null) return cached;
  const s = String(ch).repeat(Math.max(0, width));
  if (!trueColorSupported()) {
    const plain = p(C.gray, s);
    gradientCache.set(cacheKey, plain);
    return plain;
  }
  const chars = [...s];
  const rgbs = GRAD_STOPS.map((h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  let out = '\x1b[2m';
  chars.forEach((c, i) => {
    const t = chars.length > 1 ? i / (chars.length - 1) : 0;
    const seg = t * (rgbs.length - 1);
    const si = Math.min(rgbs.length - 2, Math.floor(seg));
    const f = seg - si;
    const a = rgbs[si];
    const b = rgbs[si + 1];
    const r = Math.round(a[0] + (b[0] - a[0]) * f);
    const g = Math.round(a[1] + (b[1] - a[1]) * f);
    const bl = Math.round(a[2] + (b[2] - a[2]) * f);
    out += `\x1b[38;2;${r};${g};${bl}m${c}`;
  });
  const result = out + C.reset;
  if (gradientCache.size > 256) gradientCache.clear();
  gradientCache.set(cacheKey, result);
  return result;
}

// Lencana maskot: kotak kecil dengan latar gradient violet→cyan (ala mockup HTML).
function mascotBadge(state) {
  const face = MASCOT_FACE[state] || MASCOT_FACE.idle;
  const text = ` ${face} `;
  if (!trueColorSupported()) return `${C.chipBg}${p(mascotColor(state), text)}${C.reset}`;
  const stops = ['#8b5cf6', '#6366f1', '#22d3ee'];
  const rgbs = stops.map((h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const chars = [...text];
  let out = '';
  chars.forEach((ch, i) => {
    const t = chars.length > 1 ? i / (chars.length - 1) : 0;
    const seg = t * (rgbs.length - 1);
    const si = Math.min(rgbs.length - 2, Math.floor(seg));
    const f = seg - si;
    const a = rgbs[si];
    const b = rgbs[si + 1];
    const r = Math.round(a[0] + (b[0] - a[0]) * f);
    const g = Math.round(a[1] + (b[1] - a[1]) * f);
    const bl = Math.round(a[2] + (b[2] - a[2]) * f);
    out += `\x1b[48;2;${r};${g};${bl}m\x1b[1;97m${ch}`;
  });
  return out + C.reset;
}

// Tiga titik memantul — penanda "AI sedang membuat sesuatu".
function bounceDots() {
  const frames = UI_SYMBOLS.dots;
  return frames[Math.floor(Date.now() / 300) % frames.length];
}

// ─── Split diff (side-by-side) ───
// Ubah teks diff jadi pasangan baris kiri (sebelum) / kanan (sesudah).
// Baris '-' berurutan dipasangkan dengan '+' berikutnya; context tampil di
// kedua sisi; header hunk jadi baris lebar.
function splitPairs(diffText) {
  const lines = String(diffText).split('\n');
  const pairs = [];
  let rem = [];
  let add = [];
  const flush = () => {
    const n = Math.max(rem.length, add.length);
    for (let i = 0; i < n; i++) pairs.push({ left: i < rem.length ? rem[i] : null, right: i < add.length ? add[i] : null });
    rem = [];
    add = [];
  };
  for (const l of lines) {
    if (/^(@@|---|\+\+\+|diff |index |new file|deleted file|rename )/.test(l)) {
      flush();
      pairs.push({ header: l });
      continue;
    }
    if (l.startsWith('-')) {
      if (add.length) flush();
      rem.push(l.slice(1));
      continue;
    }
    if (l.startsWith('+')) {
      add.push(l.slice(1));
      continue;
    }
    flush();
    pairs.push({ left: l, right: l, ctx: true });
  }
  flush();
  return pairs;
}

// Kata yang diterima di prompt izin (selain tombol y/a/w/n). Dicocokkan
// terhadap seluruh buffer ketikan — bukan huruf terakhir, supaya kata seperti
// "batal" tidak terp sway oleh huruf 'a' di tengahnya.
const PERM_WORDS = [
  { re: /^(ok|oke|okay|yes|y|ya|iya|boleh|setuju|silakan|gas|jalan|allow|boleh saja)$/i, act: 'once' },
  { re: /^(a|sesi|session|izinkan sesi|boleh sesi|allow sesi|allow session|this session)$/i, act: 'session' },
  { re: /^(w|selalu|always|permanen|simpan|allow always|save)$/i, act: 'always' },
  { re: /^(n|no|nope|tolak|jangan|batal|cancel|reject|enggak|nggak|gak|tidak)$/i, act: 'reject' },
];
function matchPermWord(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t || t === 'enter' || t === 'esc') return null;
  for (const w of PERM_WORDS) if (w.re.test(t)) return w;
  return null;
}

// Sorot kemunculan `q` di dalam baris yang SUDAH ber-ANSI, tanpa merusak warna
// dan tanpa mengubah lebar tampilan (escape sequence hanya disisipkan).
function highlightAnsi(line, plain, q, current) {
  if (!q) return line;
  const ql = q.toLowerCase();
  if (!ql) return line;
  const lower = plain.toLowerCase();
  let out = '';
  let pi = 0;
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) === 0x1b) {
      const m = /^\x1b\[[0-9;]*[A-Za-z]/.exec(line.slice(i)) || /^\x1b\][^\x07]*\x07/.exec(line.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (lower.startsWith(ql, pi)) {
      out += current ? '\x1b[7;1m' : '\x1b[7m';
      let need = ql.length;
      let j = i;
      while (j < line.length && need > 0) {
        if (line.charCodeAt(j) === 0x1b) {
          const m = /^\x1b\[[0-9;]*[A-Za-z]/.exec(line.slice(j)) || /^\x1b\][^\x07]*\x07/.exec(line.slice(j));
          if (m) {
            out += m[0];
            j += m[0].length;
            continue;
          }
          j++;
          continue;
        }
        const cp = line.codePointAt(j);
        const ch = String.fromCodePoint(cp);
        out += ch;
        j += ch.length;
        need--;
      }
      out += '\x1b[0m';
      i = j;
      pi += ql.length;
      continue;
    }
    const cp = line.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    out += ch;
    i += ch.length;
    pi++;
  }
  return out;
}

function colorizeAnsiText(line, query, color) {
  const plain = stripAnsi(line);
  const start = plain.indexOf(query);
  if (start < 0 || !query) return line;
  let out = '';
  let visible = 0;
  let colored = false;
  let coloredChars = 0;
  for (let i = 0; i < line.length;) {
    if (line.charCodeAt(i) === 0x1b) {
      const m = /^\x1b\[[0-9;]*[A-Za-z]/.exec(line.slice(i));
      if (m) {
        if (!colored) out += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (!colored && visible === start) {
      out += color;
      colored = true;
    }
    const cp = line.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    out += ch;
    i += ch.length;
    visible++;
    if (colored && ++coloredChars === [...query].length) {
      out += '\x1b[0m';
      colored = false;
    }
  }
  return out;
}

// Brand "NTVGraph x Niyusha": TIAP HURUF beda warna — siklus
// kuning → hijau → biru → pink → merah → oranye (bold).
function brandArt(text) {
  const cacheKey = `${text}|${trueColorSupported() ? 1 : 0}|gradient`;
  const cached = brandCache.get(cacheKey);
  if (cached != null) return cached;
  const hex = ['#facc15', '#4ade80', '#22d3ee', '#a78bfa', '#f472b6', '#fb923c'];
  const ansi = [C.yellow, C.green, C.cyan, C.violet, C.magenta, C.orange];
  const useTrue = trueColorSupported();
  let out = C.bold;
  const chars = [...text];
  chars.forEach((ch, i) => {
    if (ch === ' ') { out += ' '; return; }
    if (useTrue) {
      const t = chars.length > 1 ? i / (chars.length - 1) : 0;
      const seg = t * (hex.length - 1);
      const si = Math.min(hex.length - 2, Math.floor(seg));
      const f = seg - si;
      const a = parseInt(hex[si].slice(1), 16);
      const b = parseInt(hex[si+1].slice(1), 16);
      const r = Math.round(((a>>16)&255) + (((b>>16)&255)-((a>>16)&255))*f);
      const g = Math.round(((a>>8)&255) + (((b>>8)&255)-((a>>8)&255))*f);
      const bl = Math.round((a&255) + ((b&255)-(a&255))*f);
      out += `\x1b[38;2;${r};${g};${bl}m${ch}`;
    } else {
      out += p(ansi[i % ansi.length] + C.bold, ch);
    }
  });
  const result = out + C.reset;
  if (brandCache.size > 512) brandCache.clear();
  brandCache.set(cacheKey, result);
  return result;
}

// Terminal lama (conhost/cmd tanpa Windows Terminal, VS Code, ConEmu, mintty)
// sering tidak punya glyph kaomoji/emoji, jadi tampil sebagai kotak/`?`.
// Fallback ASCII juga bisa dipaksa lewat NIYUSHA_ASCII=1.
const asciiEnv = String(process.env.NIYUSHA_ASCII || '').trim().toLowerCase();
const ASCII_UI = asciiEnv
  ? /^(1|true|yes|on)$/.test(asciiEnv)
  : process.platform === 'win32' &&
    !process.env.WT_SESSION &&
    !process.env.COLORTERM &&
    !process.env.TERM_PROGRAM &&
    !process.env.ConEmuANSI;

// Glyph header yang aman di console lama (tanpa emoji/kaomoji).
const UI_SYMBOLS = ASCII_UI
  ? { dot: '*', warn: '!', queue: '~', auto: '! auto', tab: '>', up: '^', sep: '|', relax: '#', dots: ['*..', '.*.', '..*'] }
  : { dot: '●', warn: '⚠', queue: '⏳', auto: '⚡ auto', tab: '⇥', up: '⬆', sep: '·', relax: '◐', dots: ['●○○', '○●○', '○○●'] };

// Penanda jawaban AI. Default "spark" (✦); bisa diganti via /set icon <nama>.
const CHAT_ICONS = ASCII_UI
  ? { spark: '*', star: '*', diamond: '<>', hex: '#', orbit: 'o', bolt: '!', dot: '.', none: '' }
  : {
    spark: '\u2726',
    star: '\u2727',
    diamond: '\u25c6',
    hex: '\u2b22',
    orbit: '\u25c9',
    bolt: '\u26a1',
    dot: '\u25cf',
    none: '',
  };
function chatGlyph(name) {
  const key = String(name || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(CHAT_ICONS, key) ? CHAT_ICONS[key] : CHAT_ICONS.spark;
}
function chatIconLabel(name, label) {
  const glyph = chatGlyph(name);
  return glyph ? `${glyph} ${label}` : label;
}

// ─── Maskot Niyusha ───
// Wajah berubah mengikuti state: idle (siap) · thinking (sibuk) · done (baru
// menjawab) · error (baru gagal). Lebar tetap 7 kolom supaya header aman.
// Warna dibaca saat render (bukan saat load) supaya ikut tema aktif.
const MASCOT_FACE = ASCII_UI
  ? {
    idle: '^_^',
    thinking: 'o_o',
    done: '^_^',
    error: 'x_x',
    reading: 'o_o',
    searching: '-_-',
    editing: '>_>',
    running: '>_<',
  }
  : {
    idle: '◕‿◕',
    thinking: '◉‿◉',
    done: '^‿^',
    error: '×_×',
    reading: '⊙_⊙',
    searching: '¬_¬',
    editing: '⌐■_■',
    running: '>_<',
  };
function mascotColor(state) {
  if (state === 'thinking') return C.yellow;
  if (state === 'done') return C.yellow;
  if (state === 'error') return C.red;
  if (state === 'editing') return C.magenta;
  if (state === 'running') return C.yellow;
  if (state === 'reading') return C.sky;
  if (state === 'searching') return C.blue;
  return C.cyan;
}

// Peta tool → aksi maskot (indikator aktivitas hidup di header).
const ACTION_BY_TOOL = {
  read_file: 'reading',
  list_directory: 'reading',
  workspace_tree: 'reading',
  grep_search: 'searching',
  glob_files: 'searching',
  write_file: 'editing',
  edit_file: 'editing',
  rename_file: 'editing',
  delete_file: 'editing',
  create_directory: 'editing',
  run_command: 'running',
  run_code: 'running',
  kill_process: 'running',
};
function mascotArt(state) {
  const face = MASCOT_FACE[state] || MASCOT_FACE.idle;
  return p(mascotColor(state), `( ${face} )`);
}

// East Asian Wide/Fullwidth + emoji presentation (lebar 2 kolom).
const WIDE_RANGES = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec],
  [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615],
  [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755],
  [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4], [0x17000, 0x18cd5], [0x1aff0, 0x1b16f],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a],
  [0x1f1e6, 0x1f1ff], [0x1f200, 0x1f320], [0x1f32d, 0x1f37c],
  [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f4fc],
  [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567], [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7], [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];

// Combining mark / zero-width (lebar 0).
const ZERO_RANGES = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a],
  [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc], [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff],
  [0x200b, 0x200f], [0x2028, 0x202e], [0x20d0, 0x20ff], [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f], [0xfeff, 0xfeff], [0xe0100, 0xe01ef],
];

function inRanges(cp, ranges) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

function baseWidth(cp) {
  if (cp < 32 || cp === 0x7f) return 0;
  if (inRanges(cp, ZERO_RANGES)) return 0;
  if (inRanges(cp, WIDE_RANGES)) return 2;
  return 1;
}

// Lebar per karakter, selaras dengan [...str]:
// - VS16 (fe0f) memaksa emoji presentation -> lebar 2
// - VS15 (fe0e) memaksa teks presentation -> lebar 1
// - ZWJ (200d) menyatukan glyph berikutnya -> dihitung 0
function charWidths(s) {
  const chars = [...String(s)];
  const out = [];
  let afterZWJ = false;
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200d) {
      out.push(0);
      afterZWJ = true;
      continue;
    }
    if (cp === 0xfe0f) {
      if (out.length && out[out.length - 1] === 1) out[out.length - 1] = 2;
      out.push(0);
      continue;
    }
    if (cp === 0xfe0e) {
      if (out.length && out[out.length - 1] === 2) out[out.length - 1] = 1;
      out.push(0);
      continue;
    }
    let w = baseWidth(cp);
    if (afterZWJ && w === 2) w = 0;
    afterZWJ = false;
    out.push(w);
  }
  return out;
}

function dispWidth(s) {
  let w = 0;
  for (const x of charWidths(s)) w += x;
  return w;
}

function truncateDisp(s, width) {
  const chars = [...String(s)];
  const ws = charWidths(s);
  let w = 0;
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    if (w + ws[i] > width) break;
    w += ws[i];
    out += chars[i];
  }
  return out;
}

// Potong string ANSI-aware: escape sequence tidak dihitung & tidak terpotong.
function cutAnsi(s, width) {
  const str = String(s);
  let w = 0;
  let out = '';
  let i = 0;
  let afterZWJ = false;
  let prevW = 0;
  while (i < str.length) {
    if (str.charCodeAt(i) === 0x1b) {
      const m = /^\x1b\[[0-9;]*[A-Za-z]/.exec(str.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
      const o = /^\x1b\][^\x07]*(?:\x07|\x1b\\)/.exec(str.slice(i));
      if (o) {
        out += o[0];
        i += o[0].length;
        continue;
      }
      i++;
      continue;
    }
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    if (cp === 0x200d) {
      out += ch;
      i += ch.length;
      afterZWJ = true;
      prevW = 0;
      continue;
    }
    if (cp === 0xfe0f) {
      if (prevW === 1) {
        if (w + 1 > width) break;
        w += 1;
      }
      out += ch;
      i += ch.length;
      prevW = 2;
      continue;
    }
    if (cp === 0xfe0e) {
      if (prevW === 2) w = Math.max(0, w - 1);
      out += ch;
      i += ch.length;
      prevW = 1;
      continue;
    }
    let cw = baseWidth(cp);
    if (afterZWJ && cw === 2) cw = 0;
    afterZWJ = false;
    if (w + cw > width) break;
    w += cw;
    prevW = cw;
    out += ch;
    i += ch.length;
  }
  return out;
}

// Buang kontrol karakter berbahaya (ESC/CR/dll) dari konten transcript.
function sanitizeText(s) {
  return String(s)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

// Sanitizer untuk pesan DIPERCAYA milik TUI (info/error) yang boleh berisi
// warna SGR buatan sendiri via p(). Berbeda dari sanitizeText (dipakai untuk
// konten model/user) yang membuang SEMUA ESC — di sini hanya SGR yang dipertahankan;
// escape lain (cursor/clear-screen) & kontrol karakter tetap dibuang.
function sanitizeTrusted(s) {
  const str = String(s)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ');
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\x1b') {
      // SGR (warna) dipertahankan; escape lain (cursor/clear-screen/dll)
      // dikonsumsi UTUH supaya tidak meninggalkan sisa teks '[2J'/'[H'.
      const m = /^\x1b\[[0-9;]*m|^\x1b\[[0-9;?]*[A-Za-z]|^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|^\x1b[@-Z\\-_]/.exec(str.slice(i));
      if (m) {
        if (m[0].endsWith('m')) out += m[0]; // hanya SGR yang lolos
        i += m[0].length - 1;
      }
      continue;
    }
    if (ch === '\n') {
      out += '\n';
      continue;
    }
    const code = str.charCodeAt(i);
    if (code < 32 || code === 0x7f) continue;
    out += ch;
  }
  return out;
}

// Sanitizer teks paste (bracketed paste / Ctrl+V / clipboard): buang escape
// ANSI & kontrol yang merusak rendering kotak input (CR → border pecah,
// ESC → warna/kursor liar, TAB → lebar tak terduga), normalkan newline
// Windows (CRLF/CR → LF). Dipakai di SEMUA jalur paste teks.
function sanitizePasteText(s) {
  return String(s)
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

function wrap(text, width) {
  const out = [];
  width = Math.max(8, width);
  for (const para of String(text).split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    let line = '';
    let lineW = 0;
    for (const word of para.split(' ')) {
      const wWord = visibleLen(word);
      if (wWord > width) {
        if (line) {
          out.push(line);
          line = '';
          lineW = 0;
        }
        let buf = '';
        let bufW = 0;
        const wordChars = [...word];
        const wordWs = charWidths(word);
        for (let i = 0; i < wordChars.length; i++) {
          const cw = wordWs[i];
          if (bufW + cw > width && bufW > 0) {
            out.push(buf);
            buf = wordChars[i];
            bufW = cw;
          } else {
            buf += wordChars[i];
            bufW += cw;
          }
        }
        if (buf) {
          line = buf;
          lineW = bufW;
        }
        continue;
      }
      const sep = lineW > 0 ? 1 : 0;
      if (lineW + sep + wWord <= width) {
        line += (sep ? ' ' : '') + word;
        lineW += sep + wWord;
      } else {
        out.push(line);
        line = word;
        lineW = wWord;
      }
    }
    out.push(line);
  }
  return out;
}

function stripAnsi(s) {
  // CSI (warna) + OSC (hyperlinks/notifikasi) — keduanya lebar 0.
  return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
}

function killPid(pid) {
  try {
    process.kill(Number(pid), process.platform === 'win32' ? undefined : 'SIGTERM');
  } catch {
    try {
      process.kill(Number(pid));
    } catch {}
  }
}

function visibleLen(s) {
  return dispWidth(stripAnsi(s));
}

function row(left, right, cols) {
  const l = visibleLen(left);
  const r = visibleLen(right);
  if (l + r >= cols) {
    return cutAnsi(left + ' ' + right, cols) + C.reset;
  }
  return left + ' '.repeat(Math.max(1, cols - l - r)) + right;
}

// Varian row() dengan latar penuh — dipakai untuk bar "butuh keputusan"
// (izin shell & approval) supaya mata user langsung tertuju ke sana.
function rowBg(left, right, cols, bg) {
  const l = visibleLen(left);
  const r = visibleLen(right);
  if (l + r >= cols) {
    return bg + cutAnsi(left + ' ' + right, cols) + C.reset;
  }
  return bg + left + ' '.repeat(Math.max(1, cols - l - r)) + right + C.reset;
}

function padLine(line, width) {
  const v = visibleLen(line);
  if (v === 0) return ' '.repeat(width);
  if (v > width) return cutAnsi(line, width) + C.reset;
  return line + ' '.repeat(width - v) + C.reset;
}

function fmtTok(n) {
  return n < 1000 ? String(n) : (n / 1000).toFixed(1) + 'k';
}

function sliceByWidth(s, start, end) {
  const chars = [...String(s)];
  const ws = charWidths(s);
  let acc = 0;
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const w = ws[i];
    const a = acc;
    const b = acc + w;
    if (b > start && a < end) out += chars[i];
    acc = b;
    if (acc >= end) break;
  }
  return out;
}

function tokenBar(used, budget, width) {
  width = Math.max(4, width);
  const ratio = budget > 0 ? used / budget : 0;
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  const color = filled <= width * 0.7 ? C.green : filled <= width * 0.9 ? C.yellow : C.red;
  return p(color, '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']');
}

function windowedList(list, idx, max) {
  const count = list.length;
  const size = Math.max(1, Math.min(count, max));
  let start = idx - Math.floor(size / 2);
  if (start < 0) start = 0;
  if (start + size > count) start = Math.max(0, count - size);
  return { start, items: list.slice(start, start + size) };
}

let pasteBuffer = '';
let keyBuffer = '';

function hasPendingEscape() {
  return keyBuffer.length > 0;
}

// Deteksi escape sequence yang terpotong di akhir chunk. Sequence lengkap
// dikembalikan '' supaya langsung diproses; sisanya ditahan sampai chunk
// berikutnya (atau di-flush sebagai Esc oleh TUI setelah jeda singkat).
function incompleteEscape(text) {
  const e = text.lastIndexOf('\x1b');
  if (e < 0) return '';
  const tail = text.slice(e);
  if (tail === '\x1b') return tail;
  if (tail.startsWith('\x1b\x1b[')) return csiTail(tail, 3);
  if (tail.startsWith('\x1b[')) return csiTail(tail, 2);
  if (tail.startsWith('\x1b]')) {
    return tail.endsWith('\x07') || tail.endsWith('\x1b\\') ? '' : tail;
  }
  if (tail.startsWith('\x1bO')) return tail.length < 3 ? tail : '';
  return '';
}

function csiTail(tail, start) {
  for (let i = start; i < tail.length; i++) {
    const c = tail.charCodeAt(i);
    if (c >= 0x40 && c <= 0x7e) return '';
  }
  return tail;
}

function parseKeys(data, flush) {
  let s = keyBuffer + data.toString('utf8');
  keyBuffer = '';
  const keys = [];

  // Jika ada sisa paste yang belum lengkap dari chunk sebelumnya, gabungkan
  if (pasteBuffer) {
    s = pasteBuffer + s;
    pasteBuffer = '';
    const end = s.indexOf('\x1b[201~');
    if (end >= 0) {
      const text = s.slice(0, end);
      if (text) keys.push({ paste: sanitizePasteText(text) });
      s = s.slice(end + 6);
    } else {
      pasteBuffer = s;
      return keys;
    }
  }

  if (!flush) {
    const tail = incompleteEscape(s);
    if (tail) {
      keyBuffer = tail;
      s = s.slice(0, s.length - tail.length);
    }
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\x1b') {
      // Alt+panah ala Windows: ESC ESC [ A/B/C/D
      if (s[i + 1] === '\x1b' && s[i + 2] === '[') {
        const c = s[i + 3];
        if (c === 'A') { keys.push('alt+up'); i += 3; continue; }
        if (c === 'B') { keys.push('alt+down'); i += 3; continue; }
        if (c === 'C') { keys.push('alt+right'); i += 3; continue; }
        if (c === 'D') { keys.push('alt+left'); i += 3; continue; }
      }
      if (s[i + 1] === '[') {
        const c2 = s[i + 2];
        if (c2 === '<') {
          // SGR mouse: \x1b[<b;x;yM (press/move) atau ...m (release)
          const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(s.slice(i));
          if (m) {
            keys.push({
              mouse: {
                b: Number(m[1]),
                x: Number(m[2]),
                y: Number(m[3]),
                release: m[4] === 'm',
              },
            });
            i += m[0].length - 1;
            continue;
          }
          i += 2;
          continue;
        }
        if (c2 === '2' && s[i + 3] === '0' && s[i + 4] === '0' && s[i + 5] === '~') {
          const end = s.indexOf('\x1b[201~', i + 6);
          if (end >= 0) {
            const text = s.slice(i + 6, end);
            if (text) keys.push({ paste: sanitizePasteText(text) });
            i = end + 5;
          } else {
            pasteBuffer = s.slice(i + 6);
            i = s.length;
          }
          continue;
        }
        if (c2 === '2' && s[i + 3] === '0' && s[i + 4] === '1' && s[i + 5] === '~') { i += 5; continue; }
        if (c2 === 'A') { keys.push('up'); i += 2; continue; }
        if (c2 === 'B') { keys.push('down'); i += 2; continue; }
        if (c2 === 'C') { keys.push('right'); i += 2; continue; }
        if (c2 === 'D') { keys.push('left'); i += 2; continue; }
        if (c2 === 'H') { keys.push('home'); i += 2; continue; }
        if (c2 === 'F') { keys.push('end'); i += 2; continue; }
        if (c2 === 'Z') { keys.push('shift+tab'); i += 2; continue; }
        if (c2 === '5' || c2 === '6') {
          const base = c2 === '5' ? 'pgup' : 'pgdn';
          let j = i + 3;
          let pre = '';
          if (s[j] === ';') {
            pre = s[j + 1] === '3' ? 'alt+' : s[j + 1] === '5' ? 'ctrl+' : '';
            j += 2;
          }
          if (s[j] === '~') j++;
          keys.push(pre + base);
          i = j - 1;
          continue;
        }
        if (c2 === '1' && s[i + 3] === '3' && s[i + 4] === ';') {
          if (s[i + 5] === '2' && s[i + 6] === 'u') { keys.push('shift+enter'); i += 6; continue; }
        }
        if (c2 === '1' && s[i + 3] === ';') {
          const mod = { 2: 'shift+', 3: 'alt+', 4: 'shift+alt+', 5: 'ctrl+', 6: 'shift+ctrl+' }[s[i + 4]];
          const k = s[i + 5];
          if (mod && (k === 'A' || k === 'B' || k === 'C' || k === 'D' || k === 'H' || k === 'F')) {
            const name = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' }[k];
            keys.push(mod + name);
            i += 5;
            continue;
          }
        }
        if (c2 >= '0' && c2 <= '9') {
          let j = i + 2;
          let num = '';
          while (j < s.length && s[j] !== '~') { num += s[j]; j++; }
          if (s[j] === '~') {
            if (num === '3') keys.push('delete');
            else if (num === '1' || num === '7') keys.push('home');
            else if (num === '4' || num === '8') keys.push('end');
            j++;
          }
          i = j - 1;
          continue;
        }
        i += 2;
        continue;
      }
      if (s[i + 1] === 'O') {
        const map = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' };
        const k = map[s[i + 2]];
        if (k) {
          keys.push(k);
          i += 2;
          continue;
        }
      }
      if (s[i + 1] >= '1' && s[i + 1] <= '9') {
        keys.push('alt+' + s[i + 1]);
        i++;
        continue;
      }
      if (s[i + 1] === 'o' || s[i + 1] === 'O') {
        keys.push('alt+o');
        i++;
        continue;
      }
      keys.push('esc');
      continue;
    }
    if (ch === '\r' || ch === '\n') { keys.push('enter'); continue; }
    if (ch === '\x7f' || ch === '\b') { keys.push('backspace'); continue; }
    if (ch === '\x03') { keys.push('ctrl+c'); continue; }
    if (ch === '\x01') { keys.push('ctrl+a'); continue; }
    if (ch === '\x05') { keys.push('ctrl+e'); continue; }
    if (ch === '\x15') { keys.push('ctrl+u'); continue; }
    if (ch === '\x10') { keys.push('ctrl+p'); continue; }
    if (ch === '\x0b') { keys.push('ctrl+k'); continue; }
    if (ch === '\x0e') { keys.push('ctrl+n'); continue; }
    if (ch === '\x11') { keys.push('ctrl+q'); continue; }
    if (ch === '\x13') { keys.push('ctrl+s'); continue; }
    if (ch === '\x0c') { keys.push('ctrl+l'); continue; }
    if (ch === '\x02') { keys.push('ctrl+b'); continue; }
    if (ch === '\x07') { keys.push('ctrl+g'); continue; }
    if (ch === '\x09') { keys.push('tab'); continue; }
    if (ch === '\x16') { keys.push('ctrl+v'); continue; }
    if (ch === '\x19') { keys.push('ctrl+y'); continue; }
    if (ch === '\x17') { keys.push('ctrl+w'); continue; }
    if (ch === '\x04') { keys.push('ctrl+d'); continue; }
    if (ch === '\x06') { keys.push('ctrl+f'); continue; }
    if (ch === '\x12') { keys.push('ctrl+r'); continue; }
    if (ch === '\x14') { keys.push('ctrl+t'); continue; }
    if (ch === '\x0f') { keys.push('ctrl+o'); continue; }
    if (ch.charCodeAt(0) >= 32) { keys.push({ ch }); continue; }
  }
  return keys;
}

const TYPE_STYLE = {
  user: { prefix: p(C.green, 'you  '), color: C.green, pad: 5 },
  ai: { prefix: p(C.sky + C.bold, '  ▸ '), color: C.heading, pad: 4 },
  tool: { prefix: p(C.violet, '  ⚙ '), color: C.violet, pad: 4 },
  result: { prefix: p(C.slate, '   ↳ '), color: C.gray, pad: 5 },
  error: { prefix: p(C.red + C.bold, '  ! '), color: C.red, pad: 4 },
  info: { prefix: p(C.slate, '  · '), color: C.gray, pad: 4 },
  note: { prefix: p(C.yellow + C.bold, '  📝 '), color: C.yellow, pad: 4 },
  queued: { prefix: p(C.teal, '  ⏳ '), color: C.teal, pad: 5 },
  update: { prefix: '', color: C.green, pad: 3 },
  reasoning: { prefix: '', color: C.gray, pad: 3 },
  code: { prefix: '', color: C.reset, pad: 3 },
};

function refreshTypeStyle() {
  const map = {
    user: [C.green, C.green],
    ai: [C.sky + C.bold, C.heading],
    tool: [C.violet, C.violet],
    result: [C.slate, C.gray],
    error: [C.red + C.bold, C.red],
    info: [C.slate, C.gray],
    note: [C.yellow + C.bold, C.yellow],
    queued: [C.teal, C.teal],
    update: [null, C.green],
    reasoning: [null, C.gray],
    code: [null, C.reset],
  };
  for (const [type, st] of Object.entries(TYPE_STYLE)) {
    const colors = map[type];
    if (!colors) continue;
    if (st.prefix && colors[0]) st.prefix = p(colors[0], stripAnsi(st.prefix));
    st.color = colors[1];
  }
}

function splitCodeBlocks(text) {
  const parts = [];
  const s = String(text);
  const re = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ type: 'text', text: s.slice(last, m.index) });
    parts.push({ type: 'code', lang: m[1] || '', code: m[2].replace(/\n$/, '') });
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ type: 'text', text: s.slice(last) });
  return parts.length ? parts : [{ type: 'text', text: s }];
}

// Split fenced code blocks, toleran terhadap blok yang belum ditutup (streaming).
function splitStream(text) {
  const lines = String(text).split('\n');
  const parts = [];
  let buf = [];
  let mode = 'text';
  let lang = '';
  const flush = () => {
    if (!buf.length) return;
    parts.push({ type: mode, lang, text: buf.join('\n'), partial: false });
    buf = [];
  };
  for (const line of lines) {
    const m = /^```\s*([a-zA-Z0-9_+-]*)\s*$/.exec(line);
    if (m && mode === 'text') {
      flush();
      mode = 'code';
      lang = m[1] || '';
      continue;
    }
    if (/^```\s*$/.test(line) && mode === 'code') {
      flush();
      mode = 'text';
      lang = '';
      continue;
    }
    buf.push(line);
  }
  if (buf.length) parts.push({ type: mode, lang, text: buf.join('\n'), partial: mode === 'code' });
  return parts.length ? parts : [{ type: 'text', lang: '', text: String(text), partial: false }];
}

function boxTop(w, title, meta, borderColor, dots) {
  let t = title ? ` ${title} ` : '';
  let m = meta ? ` ${meta} ` : '';
  const dotsStr = dots ? trafficLights() + ' ' : '';
  const dotsW = dots ? TL_W : 0;
  const budget = Math.max(6, w - 2 - dotsW);
  if (dispWidth(t) + dispWidth(m) > budget - 3) {
    m = '';
    if (dispWidth(t) > budget - 3) t = truncateDisp(t, budget - 3);
  }
  const fill = Math.max(3, budget - dispWidth(t) - dispWidth(m));
  return (
    p(borderColor, '╭') + dotsStr + p(borderColor + C.bold, t) + p(borderColor, '─'.repeat(fill)) + p(C.dim, m) + p(borderColor, '╮')
  );
}

// Bangun kotak kode/diff. rows = [{ num, text, color }]; collapse head (default) atau tail.
function buildBox(w, title, meta, borderColor, rows, { maxRows = 0, tail = false, dots = true } = {}) {
  const omitTop = maxRows && rows.length > maxRows && tail ? rows.length - maxRows : 0;
  const omitBot = maxRows && rows.length > maxRows && !tail ? rows.length - maxRows : 0;
  const shown = maxRows && rows.length > maxRows ? (tail ? rows.slice(rows.length - maxRows) : rows.slice(0, maxRows)) : rows;
  // Lebar isi harus membuat total baris = w PERSIS: '│ '(2) + nomor(numW+1) + isi + '│'(1).
  // Rumus lama kurang 1 → border kanan body tidak sejajar dengan sudut ╭/╰.
  const numW = rows._numW;
  const contentW = w - 3 - numW - (numW ? 1 : 0);
  const bodyRow = (r) => {
    const text = r.text || '';
    const pad = Math.max(0, contentW - visibleLen(text));
    const numStr = numW ? p(C.dim, String(r.num == null ? '' : r.num).padStart(numW)) + ' ' : '';
    return p(borderColor, '│ ') + numStr + (r.rich ? text : p(r.color || C.reset, text)) + p(borderColor, ' '.repeat(pad) + '│');
  };
  const markerRow = (label) => {
    const pad = Math.max(0, (numW ? numW + 1 : 0) + contentW - dispWidth(label));
    return p(borderColor, '│ ') + p(C.dim, label) + p(borderColor, ' '.repeat(pad) + '│');
  };
  const out = [boxTop(w, title, meta, borderColor, dots)];
  if (omitTop) out.push(markerRow(`⋯ +${omitTop} lines above`));
  for (const r of shown) out.push(bodyRow(r));
  if (omitBot) out.push(markerRow(`⋯ +${omitBot} more lines · /expand`));
  out.push(p(borderColor, '╰' + '─'.repeat(w - 2) + '╯'));
  return out;
}

function boxedLines(text, width, title, color, opts) {
  let maxRows = 0;
  let tail = false;
  let numbers = true;
  let meta = '';
  let bodyColor = null;
  if (typeof opts === 'number') maxRows = opts;
  else if (opts && typeof opts === 'object') {
    if (opts.maxRows != null) maxRows = opts.maxRows;
    if (opts.tail != null) tail = opts.tail;
    if (opts.numbers != null) numbers = opts.numbers;
    if (opts.meta != null) meta = opts.meta;
    if (opts.bodyColor != null) bodyColor = opts.bodyColor;
  }
  const w = Math.max(12, width);
  const logical = String(text).replace(/\t/g, '  ').split('\n');
  const n = logical.length;
  const numW = numbers ? String(Math.max(1, n)).length : 0;
  // Sama dengan buildBox: total baris harus pas w (lihat catatan di buildBox).
  const contentW = Math.max(6, w - 3 - numW - (numW ? 1 : 0));
  const rows = [];
  rows._numW = numW;
  const rowColor = bodyColor != null ? bodyColor : color === C.gray ? C.dim : C.reset;
  const fam = langFamily(opts && opts.lang);
  logical.forEach((line, i) => {
    const raw = line === '' ? ' ' : line;
    const segs = fam ? highlightWrap(raw, contentW, fam) : wrap(raw, contentW);
    segs.forEach((seg, k) => rows.push({ num: k === 0 ? i + 1 : '', text: seg, color: rowColor, rich: !!fam }));
  });
  if (!meta && n > 1) meta = `${n} lines`;
  return buildBox(w, title, meta, color, rows, { maxRows, tail, dots: title !== 'reasoning' });
}

// Kotak kode dengan pewarnaan diff per-baris: '+' hijau (ditambahkan),
// '-' merah (dihapus), '@@' cyan (header hunk).
function boxedDiffLines(text, width, title, opts) {
  let maxRows = 0;
  let tail = false;
  let meta = '';
  let border = C.gray;
  if (typeof opts === 'number') maxRows = opts;
  else if (opts && typeof opts === 'object') {
    if (opts.maxRows != null) maxRows = opts.maxRows;
    if (opts.tail != null) tail = opts.tail;
    if (opts.meta != null) meta = opts.meta;
    if (opts.border != null) border = opts.border;
  }
  const w = Math.max(12, width);
  const logical = String(text).replace(/\t/g, '  ').split('\n');
  const n = logical.length;
  const numW = String(Math.max(1, n)).length;
  const contentW = Math.max(6, w - 4 - numW);
  const rows = [];
  rows._numW = numW;
  logical.forEach((line, i) => {
    const color = diffLineColor(line);
    const segs = wrap(line === '' ? ' ' : line, contentW);
    segs.forEach((seg, k) => rows.push({ num: k === 0 ? i + 1 : '', text: seg, color }));
  });
  if (!meta) {
    const st = summarize(logical.map((l) => ({ type: l.startsWith('+') ? '+' : l.startsWith('-') ? '-' : ' ' })));
    meta = `${n} lines · +${st.added} -${st.removed}`;
  }
  return buildBox(w, title, meta, border, rows, { maxRows, tail, dots: true });
}

function isDiffText(text, lang) {
  if (/^(diff|patch)$/i.test(String(lang || ''))) return true;
  let at = false;
  let add = 0;
  let del = 0;
  for (const l of String(text).split('\n')) {
    if (/^@@/.test(l)) at = true;
    else if (l.startsWith('+') && !l.startsWith('+++')) add++;
    else if (l.startsWith('-') && !l.startsWith('---')) del++;
  }
  return at && add + del > 0;
}

function diffLineColor(line) {
  if (/^@@/.test(line)) return C.cyan;
  if (/^(diff |index |\+\+\+ |--- |new file|deleted file|rename )/.test(line)) return C.dim + C.bold;
  if (line.startsWith('+')) return '\x1b[38;5;114;48;5;236m'; // hijau lembut, latar gelap
  if (line.startsWith('-')) return '\x1b[38;5;174;48;5;236m'; // merah lembut, latar gelap
  return C.gray;
}

function isTableSep(line) {
  const l = line.trim();
  return /^\|/.test(l) && /\|$/.test(l) && /^[\s|:-]+$/.test(l) && /-{2,}/.test(l);
}

function isTableRow(line) {
  const l = line.trim();
  return /^\|.*\|$/.test(l) && !isTableSep(line);
}

function splitTables(text) {
  const lines = String(text).split('\n');
  const out = [];
  const textBuf = [];
  const flushText = () => {
    if (textBuf.length) {
      out.push({ type: 'text', text: textBuf.join('\n') });
      textBuf.length = 0;
    }
  };
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i]) || isTableSep(lines[i])) {
      const block = [];
      while (i < lines.length && (isTableRow(lines[i]) || isTableSep(lines[i]))) {
        block.push(lines[i]);
        i++;
      }
      if (block.length >= 2 && block.some(isTableSep)) {
        const table = parseTable(block);
        if (table) {
          flushText();
          out.push({ type: 'table', table });
          continue;
        }
      }
      textBuf.push(block.join('\n'));
      continue;
    }
    textBuf.push(lines[i]);
    i++;
  }
  flushText();
  return out;
}

function parseTable(lines) {
  const cells = (l) =>
    l
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const rows = lines.filter(isTableRow).map(cells);
  if (rows.length < 2) return null;
  return { header: rows[0], rows: rows.slice(1) };
}

function fitWidths(widths, maxTotal) {
  const min = 3;
  let total = widths.reduce((a, b) => a + b, 0);
  if (total <= maxTotal) return;
  const avail = Math.max(min * widths.length, maxTotal);
  const scale = avail / total;
  let sum = 0;
  for (let i = 0; i < widths.length; i++) {
    widths[i] = Math.max(min, Math.round(widths[i] * scale));
    sum += widths[i];
  }
  if (sum > avail) {
    let over = sum - avail;
    for (let i = widths.length - 1; i >= 0 && over > 0; i--) {
      const cut = Math.min(widths[i] - min, over);
      widths[i] -= cut;
      over -= cut;
    }
  }
}

function renderTable(table, width) {
  const headers = table.header.map(String);
  const rows = table.rows.map((r) => r.map((c) => String(c == null ? '' : c)));
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  const h = [];
  for (let c = 0; c < colCount; c++) h.push(c < headers.length ? headers[c] : '');
  const plainLen = (s) => dispWidth(String(s).replace(/\*\*/g, '').replace(/__/g, ''));
  const widths = [];
  for (let c = 0; c < colCount; c++) {
    let w = plainLen(h[c]);
    let maxWord = 0;
    for (const r of rows) if (r[c] != null) {
      w = Math.max(w, plainLen(r[c]));
      const words = String(r[c]).split(/\s+/);
      for (const wd of words) maxWord = Math.max(maxWord, dispWidth(wd.replace(/\*\*/g,'').replace(/__/g,'')));
    }
    w = Math.max(w, maxWord);
    widths.push(Math.min(Math.max(8, w), 40));
  }
  fitWidths(widths, Math.max(20, width - 3 * colCount - 1));
  const borderCol = C.border || C.muted;
  const bars = (j, k, l) => p(borderCol, j + widths.map((w) => '─'.repeat(w + 2)).join(k) + l);
  const cellLines = (text, w) => {
    let raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!raw) return [''];
    let isBold = false;
    let inner = raw;
    if ((raw.startsWith('**') && raw.endsWith('**') && raw.length > 4) || (raw.startsWith('__') && raw.endsWith('__') && raw.length > 4)) {
      isBold = true;
      inner = raw.slice(2, -2);
    }
    inner = inner.replace(/\*\*/g, '').replace(/__/g, '');
    const tableWrap = (t, width) => {
      const out = [];
      let line = '';
      let lineW = 0;
      for (const word of t.split(' ')) {
        const wWord = dispWidth(word);
        if (wWord > width) {
          if (line) { out.push(line); line=''; lineW=0; }
          out.push(word);
          continue;
        }
        const sep = lineW>0?1:0;
        if (lineW + sep + wWord <= width) {
          line += (sep?' ':'') + word;
          lineW += sep + wWord;
        } else {
          out.push(line);
          line = word;
          lineW = wWord;
        }
      }
      if (line || out.length===0) out.push(line);
      return out;
    };
    const wrappedPlain = tableWrap(inner, Math.max(3, w));
    return wrappedPlain.map(s => {
      let fmt = inlineFormat(s);
      if (isBold) fmt = p(C.bold + C.heading, stripAnsi(fmt));
      return fmt;
    });
  };
  const renderRowML = (cells, isHeader) => {
    const wrapped = widths.map((w, c) => cellLines(cells[c], w));
    const nLines = Math.max(1, ...wrapped.map((l) => l.length));
    const out = [];
    for (let i = 0; i < nLines; i++) {
      const parts = wrapped.map((lines, c) => {
        const s = lines[i] != null ? lines[i] : '';
        const v = dispWidth(stripAnsi(s));
        const pad = Math.max(0, widths[c] - v);
        return s + ' '.repeat(pad);
      });
      const left = p(borderCol, '│ ');
      const sep = p(borderCol, ' │ ');
      const right = p(borderCol, ' │');
      let line = left + parts.join(sep) + right;
      if (isHeader && i === 0) line = p(C.bold + C.heading, line);
      out.push(line);
    }
    return out;
  };
  const out = [];
  out.push(bars('┌', '┬', '┐'));
  out.push(...renderRowML(h, true));
  out.push(bars('├', '┼', '┤'));
  for (const r of rows) out.push(...renderRowML(r, false));
  out.push(bars('└', '┴', '┘'));
  return out;
}

function renderMarkdownBlock(text, width) {
  const out = [];
  const lines = String(text).split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ').replace(/\s+$/, '');
    if (!line.trim()) {
      out.push('');
      continue;
    }
    const heading = line.match(/^(\s*)(#{1,4})\s+(.*)$/);
    if (heading) {
      // Judul seksi ala mockup: ikon ◼/▸ + teks terang; h1 diberi garis bawah.
      const pad = heading[1];
      const level = heading[2].length;
      const bodyW = Math.max(8, width - dispWidth(pad) - 2);
      const icon = level <= 2 ? '◼' : '▸';
      const iconColor = level === 1 ? C.yellow : C.sky;
      wrap(heading[3] || ' ', bodyW).forEach((ln, i) => {
        out.push(pad + p(iconColor, `${i === 0 ? icon : ' '} `) + p(C.bold + C.heading, inlineFormat(ln)));
      });
      if (level === 1) out.push(pad + p(C.gray, '─'.repeat(Math.max(4, Math.min(width, 2 + dispWidth(heading[3]))))));
      continue;
    }
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      out.push(p(C.gray, '─'.repeat(Math.max(4, width))));
      continue;
    }
    const quote = line.match(/^(\s*)>\s?(.*)$/);
    if (quote) {
      const pad = quote[1];
      const qW = Math.max(8, width - dispWidth(pad) - 2);
      wrap(quote[2] || ' ', qW).forEach((ln) => out.push(pad + p(C.gray, '│ ') + p(C.dim, inlineFormat(ln))));
      continue;
    }
    const bullet = line.match(/^(\s*)([-*+•])\s+(.*)$/);
    if (bullet) {
      const indent = dispWidth(bullet[1]);
      const task = bullet[3].match(/^\[([ xX])\]\s+(.*)$/);
      let body = bullet[3];
      let lead;
      if (task) {
        const done = task[1].toLowerCase() === 'x';
        lead = ' '.repeat(indent) + (done ? p(C.green, '[x]') : p(C.dim, '[ ]')) + ' ';
        body = task[2];
      } else {
        lead = ' '.repeat(indent) + '• ';
      }
      for (const ln of wrapHanging(body, width, lead)) out.push(ln);
      continue;
    }
    const num = line.match(/^(\s*)(\d+[.)])\s+(.*)$/);
    if (num) {
      const lead = num[1] + num[2] + ' ';
      for (const ln of wrapHanging(num[3], width, lead)) out.push(ln);
      continue;
    }
    const w = wrap(line, width);
    w.forEach((ln, i) => {
      const fmt = inlineFormat(ln);
      out.push(i < w.length - 1 ? justifyLine(fmt, width) : fmt);
    });
  }
  return out;
}

function inlineFormat(s) {
  // Lindungi link/URL/inline-code dari pemrosesan emphasis. Tanpa ini,
  // underscore pada path (mis. D:\PT_PA_UNIT2\IHMB_R_Fix\L9_cloudfilled.tif)
  // dianggap penanda italic → underscore HILANG di layar (path jadi salah).
  const stash = [];
  const keep = (txt) => `\u0000${stash.push(txt) - 1}\u0000`;
  const out = String(s)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => keep(`${p(C.sky + C.bold, t)} ${p(C.gray, '(' + u + ')')}`))
    .replace(/(https?:\/\/[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?])/g, (url) => keep(p(C.sky, url)))
    .replace(/`([^`]+)`/g, (_, x) => keep(p(C.cyan, x)))
    .replace(/\*\*([^*]+)\*\*/g, (_, x) => p(C.bold + C.yellow, x))
    .replace(/\*([^*]+)\*/g, (_, x) => p(C.italic, x))
    // GFM: underscore di tengah kata/path BUKAN emphasis (snake_case aman).
    .replace(/(?<![\w\\/])__([^_\n]+)__(?![\w\\/])/g, (_, x) => p(C.bold + C.yellow, x))
    .replace(/(?<![\w\\/])_([^_\n]+)_(?![\w\\/])/g, (_, x) => p(C.italic, x));
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

// Rata kanan (justify): tambah spasi di sela kata supaya baris terisi penuh
// sampai `width`. Baris terakhir sebuah paragraf TIDAK dijustify (rata kiri).
// Operasi pada teks polos (sebelum inlineFormat) — jadi bebas ANSI.
function justifyLine(s, width) {
  const v = visibleLen(s);
  if (v >= width) return s;
  const parts = String(s).split(' ');
  // Baris pendek (< 8 kata) jangan dijustify: celahnya jadi renggang.
  if (parts.length < 8) return s;
  const gaps = parts.length - 1;
  const extra = width - v;
  // Maksimal 2 spasi antar kata; lebih dari itu biarkan rata kiri.
  if (extra > gaps) return s;
  const per = Math.floor(extra / gaps);
  const rem = extra % gaps;
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    out += ' '.repeat(1 + per + (i <= rem ? 1 : 0)) + parts[i];
  }
  return out;
}

// Ubah argumen tool dari JSON mentah jadi "key=value" yang enak dibaca.
// Bukan JSON (mis. perintah shell) → dibiarkan apa adanya.
function formatToolArgs(rest) {
  const s = String(rest == null ? '' : rest).trim();
  if (!s || (s[0] !== '{' && s[0] !== '[')) return s;
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    return s;
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj)
      .map(([k, v]) => {
        let val = v == null ? 'null' : typeof v === 'string' ? v : JSON.stringify(v);
        val = String(val).replace(/\s*\n\s*/g, ' ');
        if (dispWidth(val) > 96) val = truncateDisp(val, 95) + '…';
        return `${k}=${val}`;
      })
      .join(' · ');
  }
  return s;
}

// Ringkasan tool yang manusiawi untuk ditampilkan di transkrip.
// Hanya memakai argumen yang sudah ada; tidak menambah token ke model.
function oneLineArg(v, max) {
  let s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, Math.max(1, max - 1)) + '…';
  return s;
}

function argLen(v) {
  return String(v == null ? '' : v).length;
}

// null = tool tidak dikenal (pakai JSON mentah); '' = tool dikenal tanpa detail.
function toolSummary(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  const path = oneLineArg(a.path || a.file || a.target, 160);
  switch (name) {
  case 'read_file': {
    if (!path) return '';
    const extra = [];
    if (a.offset != null && String(a.offset) !== '0') extra.push(`from line ${oneLineArg(a.offset, 20)}`);
    if (a.limit != null) extra.push(`limit ${oneLineArg(a.limit, 20)}`);
    return path + (extra.length ? ` (${extra.join(', ')})` : '');
  }
  case 'write_file':
    return path ? `${path} (${argLen(a.content)} chars)` : '';
  case 'edit_file':
    return path ? `${path} (${argLen(a.old_str)} → ${argLen(a.new_str)} chars)` : '';
  case 'list_directory':
  case 'create_directory':
  case 'delete_file':
    return path || '/';
  case 'rename_file':
    return [oneLineArg(a.old_path, 120), oneLineArg(a.new_path, 120)].filter(Boolean).join(' → ');
  case 'glob_files':
    return oneLineArg(a.pattern, 120);
  case 'grep_search':
    return `"${oneLineArg(a.pattern, 120)}" in ${path || 'workspace'}`;
  case 'workspace_tree':
    return '';
  case 'run_code':
    return `code (${argLen(a.code)} chars): ${oneLineArg(a.code, 300)}`;
  case 'run_command': {
    const rawCmd = String(a.command || '').replace(/\r\n?/g, '\n').replace(/\n/g, ' ⏎ ');
    const cmd = rawCmd.length > 1200 ? rawCmd.slice(0, 1199) + '… [command truncated]' : rawCmd;
    const cwd = oneLineArg(a.cwd, 120);
    const flags = [
      a.background ? 'background' : 'foreground',
      a.timeout != null ? `timeout ${oneLineArg(a.timeout, 20)}s` : '',
    ].filter(Boolean).join(' · ');
    return `${cwd ? `cwd=${cwd} · ` : ''}${flags} · ${cmd || '(no command)'}`;
  }
  case 'mcp_list':
    return oneLineArg(a.server, 80) || 'all servers';
  case 'mcp_call': {
    let args = '';
    try {
      args = JSON.stringify(a.arguments);
    } catch {
      args = '[arguments could not be displayed]';
    }
    if (args && args.length > 800) args = args.slice(0, 799) + '… [arguments truncated]';
    return `${[oneLineArg(a.server, 60), oneLineArg(a.tool, 60)].filter(Boolean).join('.')} · args=${args || '{}'}`;
  }
  case 'web_search':
    return `"${oneLineArg(a.query, 160)}"`;
  case 'set_todos':
    return (Array.isArray(a.todos) ? a.todos : [])
      .slice(0, 6)
      .map((t) => oneLineArg(typeof t === 'string' ? t : t && (t.text || t.title), 100))
      .filter(Boolean)
      .join(' · ') || '0 todos';
  case 'read_note':
  case 'clear_note':
    return '';
  case 'write_note':
    return `(${argLen(a.content)} chars) ${oneLineArg(a.content, 180)}`;
  case 'kill_process':
    return oneLineArg(a.pid, 40);
  case 'use_skill':
    return oneLineArg(a.name, 80) || 'catalog';
  case 'task':
    return `${oneLineArg(a.subagent_type || 'explore', 24)}: ${oneLineArg(a.description || a.prompt, 160)}`;
  default:
    return null;
  }
}

function toolDisplayLine(name, args) {
  const summary = toolSummary(name, args);
  if (summary !== null) return summary ? `${name} ${summary}` : name;
  let raw = '';
  try {
    raw = JSON.stringify(args);
    if (raw.length > 200) raw = raw.slice(0, 200) + '…';
  } catch {}
  return raw ? `${name} ${raw}` : name;
}

function wrapHanging(text, width, lead) {
  const hang = dispWidth(lead);
  const bodyW = Math.max(8, width - hang);
  const body = wrap(text, bodyW);
  return body.map((l, i) => {
    const t = inlineFormat(l);
    const words = String(l).trim().split(/\s+/).filter(Boolean).length;
    const shouldJust = i < body.length - 1 && words >= 7;
    const line = shouldJust ? justifyLine(t, bodyW) : t;
    return i === 0 ? lead + line : ' '.repeat(hang) + line;
  });
}

function fmtLatency(totalMs) {
  const s = totalMs >= 10000 ? `${(totalMs / 1000).toFixed(0)}s` : `${(totalMs / 1000).toFixed(1)}s`;
  return `⏱ ${s}`;
}

class TUI {
  constructor({ shell, agent, version, firstRun, updateNotice }) {
    this.shell = shell;
    this.agent = agent;
    this.mcp = (agent && agent.mcp) || new MCPManager(this.cfg().mcp || {});
    this.agent.mcp = this.mcp;
    this.version = version;
    this.firstRun = !!firstRun;
    this.updateNotice = updateNotice || null;
    this._updateShown = null;
    this.store = shell.store || null;
    // Proses TUI baru = sesi baru. Todo workspace lama tidak boleh muncul
    // sebelum user memilih /resume (autosave tetap menyimpan todo sesi lalu).
    this._replaceTodos([]);
    this.history = this.store ? this.store.history().slice(-200) : [];
    this.historyIdx = -1;
    this.historyNav = false;
    this.input = '';
    this.cursor = 0; // indeks kursor dalam satuan code point
    this.submitted = [];

    this.mode = 'chat';
    this.transcript = [];
    this.findings = [];
    this.status = '';
    this.multiline = false;

    this.busy = false;
    this.currentAction = null;
    this.abortCtrl = null;
    this._spinTimer = null;
    this._spinFrames = ASCII_UI ? ['|', '/', '-', '\\'] : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.queue = [];
    this.lastEnterAt = 0;
    this.settingsIdx = 0;
    this.providerIdx = 0;
    this.keyBuffer = '';
    this.keyHeader = '';
    this.keyTarget = 'ai';
    this.modelList = [];
    this.modelFiltered = [];
    this.modelIdx = 0;
    this.modelFilter = '';
    this.modelLoading = false;
    this.modelError = '';
    this.scroll = 0;

    this.quickItems = [];
    this.quickFiltered = [];
    this.quickIdx = 0;
    this.quickFilter = '';
    this.quickLoading = false;
    this.quickError = '';

    this.wsItems = [];
    this.wsIdx = 0;

    this.autoApply = false;
    this.autoMode = false;
    this.awaitingApproval = false;
    this.approvalResolve = null;
    this.awaitingPlan = false; // menunggu keputusan eksekusi rencana (y/n/Esc)
    this.planning = false; // giliran ini = MODE PLAN (tiada mutasi file)
    this.lastAnswer = '';
    this.pendingImages = [];
    this.awaitingPermission = false;
    this.showSidebar = false;
    this.relaxMode = false;
    this.sideScroll = 0; // offset scroll sidebar (kolom kanan)
    this.mouseEnabled = false;
    this.selection = null;
    this._view = null;
    this._queueSeq = 0;

    this.live = null;
    this.liveRenderAt = 0;
    this.compactionLive = null;
    this.find = null;
    this.helpList = null;
    this.paletteItems = [];
    this.paletteFiltered = [];
    this.paletteIdx = 0;
    this.paletteFilter = '';
    this._lastRowCount = null;
    this._spark = [];
    this._sparkAt = null;
    this._lastLatency = null;
    this.permReq = null;
    this.permResolve = null;
    this.todoIdx = 0;
    this.toolLog = [];
    this.sessionItems = [];
    this.sessionIdx = 0;
    this._expandedToolGroups = new Set();
    this._transcriptVersion = 0;
    this._themeVersion = 0;
    this._chatCache = null;
    this._ctxCache = null;
    this._ctxInfoCache = null;
    this._lastCompactionAt = (this.agent && this.agent.lastCompactionAt) || 0;

    this.closed = false;
    this._sideW = Number(this.cfg().sidebarWidth) || 0; // 0 = otomatis (20% lebar)
    this._settingsHits = [];
    this.themeIdx = Math.max(0, Object.keys(THEME_DEFS).indexOf(this.cfg().theme || 'dark-blue'));
    applyTheme(this.cfg().theme || 'dark-blue');
    // Sesi yang baru dipakai (untuk quick-switch Alt+1..9).
    this.recentSessions = [this.shell.sessionId];
    // Peringatan bila provider tersimpan OFF (loadConfig fallback ke openrouter).
    const off0 = this.cfg().providerOff;
    if (off0) this.push('info', `⚠ provider '${off0}' is OFF — switched to '${this.cfg().provider}'. Use /provider to choose another.`);
    this._onData = this._onData.bind(this);
    this._onResize = () => this.render();
  }

  // ─── Startup banner ───
  // Animasi 3 frame + tip acak sebelum masuk alternate screen.
  // Semua padding DIHITUNG (dispWidth), bukan tebak — jadi border lurus
  // berapa pun glyph di dalamnya. Muka maskot pakai ASCII (lebar 1 pasti).
  // Bisa dimatikan: /set banner off.
  _startupBanner(cfg) {
    if (cfg && cfg.banner === false) return;
    if (!process.stdout.isTTY) return;
    const cols = Math.max(40, process.stdout.columns || 80);
    const rows = Math.max(12, process.stdout.rows || 30);
    const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const w = Math.min(cols - 2, 62);
    const inner = w - 2;
    const P = ' '.repeat(Math.max(0, Math.floor((cols - w) / 2)));
    const V = '\n'.repeat(Math.max(0, Math.floor((rows - 15) / 3)));
    // Padding & centering berbasis lebar tampilan → border kanan PASTI lurus.
    const padR = (s) => s + ' '.repeat(Math.max(0, inner - dispWidth(stripAnsi(s))));
    const center = (s) => ' '.repeat(Math.max(0, Math.floor((inner - dispWidth(stripAnsi(s))) / 2))) + s;
    const row = (content) => process.stdout.write(P + p(C.dim, '│') + padR(content) + p(C.dim, '│') + '\n');
    const nameRow = chatIconLabel(cfg && cfg.icon, brandArt('NTVGraph x Niyusha')) + '  ' + chip('v' + this.version, C.sky);
    const bar = (filled) => p(C.cyan, '[') + p(C.cyan + C.bold, '█'.repeat(filled)) + p(C.dim, '░'.repeat(16 - filled)) + p(C.cyan, ']');
    const tips = [
      'Tips: Ctrl+K = command palette · /find = cari di chat',
      'Tips: /rule add <text> = rule khusus sesi ini (auto-clear)',
      'Tips: Ctrl+B sidebar · Ctrl+S settings · Ctrl+P switch model',
      'Tips: /snd ding = suara notifikasi saat AI selesai',
      'Tips: /theme matrix = ganti nuansa warna',
      'Tips: /perm allow "python *" = izin permanen per pola',
      'Tips: file edit selalu di-stage — review diff dulu sebelum /apply',
      'Tips: /split = review perubahan side-by-side sebelum /apply',
      'Tips: maskot/simbol aneh? set NIYUSHA_ASCII=1 untuk fallback ASCII',
    ];
    const tip = tips[Math.floor(Math.random() * tips.length)];
    const frames = [
      [bar(3), 'menyiapkan…'],
      [bar(9), 'memuat aturan…'],
      [bar(16), 'siap!'],
    ];
    for (const [b, label] of frames) {
      process.stdout.write('\x1b[H\x1b[J' + V);
      process.stdout.write(P + p(C.dim, '╭' + '─'.repeat(inner) + '╮') + '\n');
      row('');
      row(center(nameRow));
      row(center(p(C.dim, 'AI coding agent · workspace aman')));
      row('');
      row(center(b + '  ' + p(C.dim, label)));
      row('');
      process.stdout.write(P + p(C.dim, '╰' + '─'.repeat(inner) + '╯') + '\n');
      sleep(210);
    }
    // Frame "siap!" sudah jadi frame terakhir di loop — cukup tampilkan tip.
    process.stdout.write('\n' + P + p(C.dim, '  ' + tip) + '\n');
    sleep(450);
  }

  start() {
    const cfg = loadConfig();
    this._startupBanner(cfg);
    const preset = providerInfo(cfg.provider);
    const ready = !!(preset && (!preset.requiredKey || cfg.apiKey));
    // Fresh/belum lengkap: TETAP di layar chat (UI utama yang elegant), cuma
    // kasih hint Inggris. Tidak langsung melompat ke layar provider.
    this.mode = 'chat';
    if (!ready) {
      this.firstRun = true;
      this.push('info', 'Welcome to Niyusha Terminal — your AI coding agent in the terminal.');
      this.push('info', 'Quick start: /help for commands · /settings to configure · /s to set provider · /p to choose model.');
    } else {
      this.firstRun = false;
      this.push('info', `Ready. Provider ${cfg.provider}, model ${cfg.model}.`);
      this.push('info', 'Type a message for the AI. Commands: /help · Settings: Ctrl+S · Quit: Ctrl+C.');
    }
    if (this.updateNotice && this.updateNotice.updateAvailable) {
      this._updateShown = this.updateNotice.latest;
      this.push('update', this._updateMsg(this.updateNotice.latest));
    }
    try {
      const autosave = readAutosave(this.agent.vfs.root);
      if (autosave && (autosave.msgs || []).length) {
        this.push('info', `📦 Last session found (${autosave.msgs.length} messages). /resume to continue.`);
      }
    } catch {}
    try {
      const u = manifestUrl();
      if (u) fetchManifest(u).then(() => this.agent.refresh()).catch(() => {});
    } catch {}

    this._onFatal = (err) => this._fatal(err);
    process.on('uncaughtException', this._onFatal);
    process.on('unhandledRejection', this._onFatal);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', this._onData);
    process.stdout.on('resize', this._onResize);
    process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?2004h');
    this.render();
  }

  _updateMsg(latest) {
    // Pesan jelas & langsung (bahasa Inggris = bahasa UI): versi lama → baru
    // + perintah update persis. Ditampilkan sebagai box hijau (tipe 'update').
    return `⬆ Niyusha v${latest} is available — you have v${this.version}\nUpdate: npm i -g niyusha@latest`;
  }

  showUpdateNotice(info) {
    const latest = info && info.latest;
    if (!latest || this._updateShown === latest) return;
    this._updateShown = latest;
    this.push('update', this._updateMsg(latest));
    try {
      this.render();
    } catch {}
  }

  _setMouse(on) {
    this.mouseEnabled = !!on;
    if (on) process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
    else process.stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l');
    this.selection = null;
  }

  // Rules sesi bersifat SEMENTARA: dibuang saat sesi berakhir/ganti/dimuat.
  _endSessionRules() {
    if (this.agent && typeof this.agent.clearSessionRules === 'function' && (this.agent.sessionRules || []).length) {
      this.agent.clearSessionRules();
      this.agent.invalidatePrompt?.();
    }
  }

  quit() {
    if (this.closed) return;
    this.closed = true;
    if (this._onFatal) {
      process.removeListener('uncaughtException', this._onFatal);
      process.removeListener('unhandledRejection', this._onFatal);
      this._onFatal = null;
    }
    if (this._escTimer) {
      clearTimeout(this._escTimer);
      this._escTimer = null;
    }
    if (this._dragTimer) {
      clearTimeout(this._dragTimer);
      this._dragTimer = null;
    }
    this._endSessionRules();
    try {
      if (this.mcp) this.mcp.stop();
    } catch {}
    if (this._spinTimer) clearInterval(this._spinTimer);
    this._spinTimer = null;
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.pause();
    process.stdin.removeListener('data', this._onData);
    process.stdout.removeListener('resize', this._onResize);
    process.stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?2004l\x1b[?1049l\x1b[?25h');
    process.stdout.write(p(C.dim, 'Bye! 👋') + '\n');
    if (this._onQuit) this._onQuit();
  }

  // Keluar paksa: selalu mungkin walau AI sedang sibuk / render macet.
  _forceQuit() {
    try {
      if (this.abortCtrl) this.abortCtrl.abort();
    } catch {}
    try {
      if (this.mcp) this.mcp.stop();
    } catch {}
    try {
      this.quit();
    } catch {
      this._fatal(new Error('force quit failed'));
    }
    const t = setTimeout(() => process.exit(130), 120);
    if (t.unref) t.unref();
  }

  // Jaring pengaman terakhir: kembalikan terminal lalu keluar dengan error.
  _fatal(err) {
    if (this._fatalDone) return;
    this._fatalDone = true;
    this.closed = true;
    try {
      if (this._spinTimer) clearInterval(this._spinTimer);
      this._spinTimer = null;
    } catch {}
    try {
      if (this._escTimer) clearTimeout(this._escTimer);
      this._escTimer = null;
    } catch {}
    try {
      if (this._dragTimer) clearTimeout(this._dragTimer);
      this._dragTimer = null;
    } catch {}
    try {
      if (this.abortCtrl) this.abortCtrl.abort();
    } catch {}
    try {
      if (this.mcp) this.mcp.stop();
    } catch {}
    try {
      process.stdin.setRawMode(false);
    } catch {}
    try {
      process.stdin.pause();
    } catch {}
    try {
      process.stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?2004l\x1b[?1049l\x1b[?25h');
    } catch {}
    try {
      const msg = err && err.stack ? err.stack : String(err);
      process.stderr.write('\nNiyusha fatal error: ' + msg + '\n');
    } catch {}
    process.exit(1);
  }

  _invalidateChat() {
    this._transcriptVersion++;
    this._chatCache = null;
  }

  push(type, text) {
    if (type === 'code' || type === 'reasoning' || type === 'update') {
      this.transcript.push({ type, text: String(text) });
    } else {
      // tiap baris dapat timestamp — dipakai timeline tool untuk durasi.
      for (const line of String(text).split('\n')) this.transcript.push({ type, text: line, ts: Date.now() });
    }
    // findings diisi secara eksplisit (bukan otomatis dari reasoning) agar tidak meniru chat.
    const MAX_TRANSCRIPT = 500;
    while (this.transcript.length > MAX_TRANSCRIPT) {
      const idx = this.transcript.findIndex((t) => t.type === 'tool' || t.type === 'result');
      if (idx >= 0) this.transcript.splice(idx, 1);
      else this.transcript.shift();
    }
    this._invalidateChat();
  }

  _pushAnswer(answer) {
    let first = true;
    for (const part of splitStream(answer)) {
      if (part.type === 'code') {
        this.transcript.push({ type: 'code', text: part.text, lang: part.lang });
        first = false;
      } else {
        for (const sub of splitTables(part.text)) {
          if (sub.type === 'table') {
            this.transcript.push({ type: 'table', table: sub.table });
            first = false;
          } else if (sub.text.trim()) {
            // Simpan teks utuh (termasuk baris kosong antarparagraf) supaya
            // spasi paragraf tetap ada; renderer markdown menangani sisa baris kosongnya.
            const text = sub.text.replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
            if (text) {
              this.transcript.push({ type: 'ai', text, continuation: !first });
              first = false;
            }
          }
        }
      }
    }
    this._invalidateChat();
  }

  cfg() {
    return loadConfig();
  }

  _onData(data) {
    if (this.closed) return;
    this._consumeKeys(parseKeys(data));
    if (this._escTimer) {
      clearTimeout(this._escTimer);
      this._escTimer = null;
    }
    if (hasPendingEscape()) {
      // Esc tunggal vs awal escape sequence yang terbelah antar-chunk:
      // tunggu sebentar; kalau tidak ada lanjutan, perlakukan sebagai Esc.
      this._escTimer = setTimeout(() => {
        this._escTimer = null;
        if (this.closed) return;
        this._consumeKeys(parseKeys('', true));
      }, 30);
    }
  }

  _consumeKeys(keys) {
    for (const key of keys) this._handle(key);
    this.render();
    this._autosaveMaybe();
    this._drainQueue();
  }

  _autosaveMaybe() {
    if (!this.agent || !this.agent.vfs) return;
    const now = Date.now();
    if (this._autosaveAt && now - this._autosaveAt < 3000 && this.transcript.length === (this._autosaveLen || 0)) return;
    const msgs = this.transcript
      .filter((t) => t.type === 'user' || t.type === 'ai')
      .slice(-80)
      .map((t) => ({ role: t.type === 'user' ? 'user' : 'ai', text: t.text }));
    // Sesi belum punya pesan user/AI: JANGAN timpa autosave lama yang masih
    // berisi. Setiap ketikan memicu autosave — tanpa guard ini, menekan tombol
    // pertama (mis. '/' sebelum `/resume`) sudah menghapus sesi sebelumnya.
    if (!msgs.length) {
      const prev = readAutosave(this.agent.vfs.root);
      if (prev && (prev.msgs || []).length) return;
    }
    this._autosaveAt = now;
    this._autosaveLen = this.transcript.length;
    saveAutosave(this.agent.vfs.root, {
      msgs,
      todos: this._todos().map((t) => ({ text: t.text, done: !!t.done, status: t.status || (t.done ? 'completed' : 'pending') })),
      note: readNote(this.agent.vfs.root),
      staged: this.agent.vfs.pendingChanges(),
      bgs: (this.agent.backgroundPids || []).map((b) => ({ pid: b.pid, command: b.command })),
      usage: typeof this.agent.getSessionUsage === 'function' ? this.agent.getSessionUsage() : null,
    });
  }

  _handle(key) {
    const kStr = typeof key === 'string' ? key : '';
    const kCh = key && key.ch ? key.ch : '';
    if (kStr === 'ctrl+r' && this.mode === 'chat' && !this.multiline && (!this.input || this.input.trim() === '')) {
      this.relaxMode = !this.relaxMode;
      this._glowTick = Date.now();
      if (this.relaxMode) {
        this.push('info', '◐ RELAX MODE ON — Ctrl+R / /relax · Ctrl+B = sidebar only');
      } else {
        this.push('info', '◑ Relax Mode OFF — welcome back');
      }
      this.render();
      return;
    }
    if (key && key.mouse) return this._onMouse(key.mouse);
    if (key === 'ctrl+c') {
      if (this.busy && this.abortCtrl) {
        const now = Date.now();
        if (now - (this._lastInterruptAt || 0) < 1500) return this._forceQuit();
        this._lastInterruptAt = now;
        this._intervene(true);
        this.push('info', '⛔ stopping… (tekan Ctrl+C lagi untuk keluar paksa)');
        this.render();
        return;
      }
      return this.quit();
    }
    if (key === 'ctrl+q') {
      // Escape hatch: SELALU keluar, walau sedang menjalankan perintah panjang.
      if (this.busy) return this._forceQuit();
      return this.quit();
    }
    if (key === 'ctrl+n') return this._newSession();
    if (key === 'ctrl+k' && this.mode !== 'key') return this._openPalette();
    if (/^alt\+[1-9]$/.test(key) && this.mode === 'chat') return this._gotoSession(Number(key.slice(4)));
    if (this.mode === 'chat') return this._handleChat(key);
    if (this.mode === 'find') return this._handleFind(key);
    if (this.mode === 'palette') return this._handlePalette(key);
    if (this.mode === 'theme') return this._handleTheme(key);
    if (this.mode === 'dev') return this._handleDev(key);
    if (this.mode === 'split') return this._handleSplit(key);
    if (this.mode === 'settings') return this._handleSettings(key);
    if (this.mode === 'provider') return this._handleProvider(key);
    if (this.mode === 'customslot') return this._handleCustomSlot(key);
    if (this.mode === 'key') return this._handleKey(key);
    if (this.mode === 'model') return this._handleModel(key);
    if (this.mode === 'quick') return this._handleQuick(key);
    if (this.mode === 'websearch') return this._handleWebSearch(key);
    if (this.mode === 'todo') return this._handleTodo(key);
    if (this.mode === 'sessions') return this._handleSessions(key);
    if (this.mode === 'help') return this._handleHelp(key);
  }

  _setInput(v) {
    this.input = String(v);
    this.cursor = [...this.input].length;
    this.multiline = this.input.includes('\n');
  }

  _insertInput(str) {
    const add = [...String(str)];
    const cps = [...this.input];
    const at = Math.max(0, Math.min(this.cursor, cps.length));
    cps.splice(at, 0, ...add);
    this.input = cps.join('');
    this.cursor = at + add.length;
    this.multiline = this.input.includes('\n');
  }

  _cursorUnit() {
    const cps = [...this.input];
    const i = Math.max(0, Math.min(this.cursor, cps.length));
    let u = 0;
    for (let n = 0; n < i; n++) u += cps[n].length;
    return u;
  }

  // batas baris tempat kursor berada (indeks = satuan code point)
  _lineBounds() {
    const cps = [...this.input];
    const cur = Math.max(0, Math.min(this.cursor, cps.length));
    let start = 0;
    let idx = 0;
    for (let i = 0; i < cur; i++) {
      if (cps[i] === '\n') {
        start = i + 1;
        idx++;
      }
    }
    let end = cps.length;
    for (let i = start; i < cps.length; i++) {
      if (cps[i] === '\n') {
        end = i;
        break;
      }
    }
    let total = 1;
    for (const c of cps) if (c === '\n') total++;
    return { cps, cur, start, end, idx, total };
  }

  // Lebar area footer (input + bar bawah): = kolom chat saat sidebar tampil,
  // supaya tinggi input yang dihitung helper scroll sama dengan di render().
  _footCols() {
    const cols = Math.max(40, process.stdout.columns || 80);
    if ((this.mode === 'chat' || this.mode === 'find') && this.showSidebar) return this._chatWidth(cols);
    return cols;
  }

  _pageSize() {
    const rows = Math.max(12, process.stdout.rows || 30);
    return Math.max(3, rows - 3 - this._inputArea(this._footCols()).height);
  }

  _scrollBy(delta) {
    this.selection = null;
    this.scroll = Math.max(0, Math.min(this._maxScroll(), this.scroll + delta));
  }

  _handleChat(key) {
    if (this.permResolve) {
      this._handlePerm(key);
      return;
    }
    // Tombol cepat saat menunggu approval (input kosong): y=apply, a=always, n=reject.
    // Begitu user mulai mengetik (input tidak kosong), huruf ditulis normal.
    if (this.awaitingApproval && this.input === '' && key && key.ch) {
      if (key.ch === 'y') return this._applyCmd();
      if (key.ch === 'a') return this._applyCmd('auto');
      if (key.ch === 'n') return this._rejectCmd();
    }
    if (this.awaitingPlan && this.input === '' && key && key.ch) {
      if (key.ch === 'y') return this._planExec();
      if (key.ch === 'n') return this._planDiscard();
    }
    if (key && key.paste != null) {
      this._insertInput(key.paste);
      this.historyNav = false;
      this.historyIdx = -1;
      return;
    }
    if (key === 'ctrl+v') return this._pasteCmd();
    if (key === 'ctrl+p') return this._openQuick();
    if (key === 'ctrl+s') {
      this.mode = 'settings';
      this.settingsIdx = 0;
      return;
    }
    if (key === 'ctrl+l') {
      this.transcript = [];
      this._invalidateChat();
      this.scroll = 0;
      this.render();
      return;
    }
    if (key === 'ctrl+b') {
      this.showSidebar = !this.showSidebar;
      this.render();
      return;
    }
    if (key === 'ctrl+g') return this._mouseCmd(this.mouseEnabled ? 'off' : 'on');
    if (key === 'esc' && this.awaitingPlan) {
      this._planDiscard();
      return;
    }
    if (key === 'esc' && this.busy) {
      if (this.approvalResolve) this._settleApproval({ decision: 'reject', abort: true });
      if (this.abortCtrl) this.abortCtrl.abort();
      return;
    }
    if (key === 'shift+enter') {
      this._insertInput('\n');
      return;
    }
    if (key === 'pgup') return this._scrollBy(this._pageSize());
    if (key === 'pgdn') return this._scrollBy(-this._pageSize());
    if (key === 'left') {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }
    if (key === 'right') {
      this.cursor = Math.min([...this.input].length, this.cursor + 1);
      return;
    }
    if (key === 'up') return this._scrollBy(3);
    if (key === 'down') return this._scrollBy(-3);
    if (key === 'ctrl+up') {
      if (this.input.includes('\n')) return this._moveCursorLine(-1);
      return this._historyPrev();
    }
    if (key === 'ctrl+down') {
      if (this.input.includes('\n')) return this._moveCursorLine(1);
      return this._historyNext();
    }
    if (key === 'ctrl+a') {
      this.cursor = this._lineBounds().start;
      return;
    }
    if (key === 'ctrl+e') {
      this.cursor = this._lineBounds().end;
      return;
    }
    if (key === 'ctrl+u') {
      this._setInput('');
      return;
    }
    if (key === 'home') {
      this.cursor = this._lineBounds().start;
      return;
    }
    if (key === 'end') {
      this.cursor = this._lineBounds().end;
      return;
    }
    if (key === 'enter') {
      if (this.busy) {
        const txt = this.input.trim();
        // Saat menunggu approval, slash command dieksekusi langsung
        // (mis. /apply, /reject, /apply auto) alih-alih di-antre.
        if (this.awaitingApproval && txt.startsWith('/')) {
          this._setInput('');
          this._slash(txt);
          return;
        }
        const now = Date.now();
        if (now - this.lastEnterAt < 1200) {
          this._intervene(false);
          return;
        }
        this.lastEnterAt = now;
        if (txt) {
          this._enqueue(txt);
          this._setInput('');
          this.render();
        }
        return;
      }
      return this._submit();
    }
    if (key === 'backspace') {
      if (this.cursor > 0) {
        const cps = [...this.input];
        cps.splice(this.cursor - 1, 1);
        this.input = cps.join('');
        this.cursor--;
        this.multiline = this.input.includes('\n');
      }
      return;
    }
    if (key === 'delete') {
      const cps = [...this.input];
      if (this.cursor < cps.length) {
        cps.splice(this.cursor, 1);
        this.input = cps.join('');
        this.multiline = this.input.includes('\n');
      }
      return;
    }
    if (key === 'tab') {
      this._complete();
      return;
    }
    // `[` / `]` mengubah lebar sidebar HANYA saat input kosong & sidebar tampil
    // (pola sama seperti hotkey approval y/a/n) — mengetik biasa tetap normal.
    if (key.ch === '[' && this.input === '' && this.showSidebar) return this._resizeSidebar(-4);
    if (key.ch === ']' && this.input === '' && this.showSidebar) return this._resizeSidebar(4);
    // `{` / `}` menggulir isi sidebar (kolom kanan) saat input kosong.
    if (key.ch === '{' && this.input === '' && this.showSidebar) return this._scrollSide(-3);
    if (key.ch === '}' && this.input === '' && this.showSidebar) return this._scrollSide(3);
    // Alt+↑/↓/PgUp/PgDn = gulir sidebar (tidak bentrok saat mengetik).
    if (this.showSidebar && key === 'alt+up') return this._scrollSide(-3);
    if (this.showSidebar && key === 'alt+down') return this._scrollSide(3);
    if (this.showSidebar && key === 'alt+pgup') return this._scrollSide(-this._pageSize());
    if (this.showSidebar && key === 'alt+pgdn') return this._scrollSide(this._pageSize());
    if (key.ch === 'e' && this.input === '') return this._toggleAllExpanded();
    if (key.ch) {
      this._insertInput(key.ch);
      this.historyIdx = -1;
      this.historyNav = false;
    }
  }

  _historyPrev() {
    if (!this.history.length || (!this.historyNav && this.input !== '')) return;
    const idx = this.historyNav ? this.historyIdx - 1 : this.history.length - 1;
    if (idx < 0) return;
    this.historyIdx = idx;
    this.historyNav = true;
    this._setInput(this.history[idx]);
  }

  _historyNext() {
    if (!this.historyNav) return;
    const idx = this.historyIdx + 1;
    if (idx >= this.history.length) {
      this.historyIdx = -1;
      this.historyNav = false;
      this._setInput('');
    } else {
      this.historyIdx = idx;
      this._setInput(this.history[idx]);
    }
  }

  // ↑↓ antar baris untuk input multi-line (kolom dipertahankan)
  _moveCursorLine(dir) {
    const lines = this.input.split('\n');
    const b = this._lineBounds();
    const target = b.idx + dir;
    if (target < 0 || target >= lines.length) return;
    const col = b.cur - b.start;
    let start = 0;
    for (let i = 0; i < target; i++) start += [...lines[i]].length + 1;
    const targetLen = [...lines[target]].length;
    this.cursor = start + Math.min(col, targetLen);
  }

  _enqueue(text, front = false) {
    const entry = { id: ++this._queueSeq, text: String(text) };
    if (front) this.queue.unshift(entry);
    else this.queue.push(entry);
    // Pesan antre TIDAK dimasukkan ke transcript (dulu begitu → tenggelam &
    // tertutup streaming AI). Ditampilkan sebagai blok mengambang di atas input
    // (lihat _queueArea), lalu jadi pesan user saat benar-benar dikirim.
    return entry;
  }

  _intervene(stopOnly) {
    this.lastEnterAt = 0;
    if (this.input.trim()) {
      const text = this.input.trim();
      this._setInput('');
      this._enqueue(text, true);
      this.push('info', stopOnly ? '⛔ stopping the AI...' : '⛔ force interrupt — pesanmu dikirim setelah AI berhenti.');
    }
    if (this.permResolve) {
      const r = this.permResolve;
      this.permResolve = null;
      this.permReq = null;
      this.awaitingPermission = false;
      try { r(false); } catch {}
    }
    if (this.approvalResolve) this._settleApproval({ decision: 'reject', abort: true });
    if (this.mode === 'perm') this.mode = 'chat';
    if (this.abortCtrl) {
      if (stopOnly && !this.input.trim()) this.push('info', '⛔ stopping the AI...');
      this.abortCtrl.abort();
    }
    this.render();
  }

  _drainQueue() {
    if (this.busy || this.awaitingApproval || this.awaitingPermission || !this.queue.length) return;
    if (this.mode !== 'chat') return;
    const next = this.queue.shift();
    this.push('user', next.text);
    this._runAI(next.text);
  }

  // Safe point: dipanggil dari agent (sebelum pemanggilan model tiap iterasi
  // loop) — di sinilah queue boleh masuk sebagai user turn tanpa menunggu run selesai.
  _injectQueuedAtSafePoint() {
    if (this.awaitingApproval || this.awaitingPermission) return;
    if (this.mode !== 'chat') return;
    if (!this.queue.length) return;
    const next = this.queue.shift();
    const text = String(next.text || '').trim();
    if (!text) return;
    this.agent.history.push({ role: 'user', content: text });
    this.push('user', text);
    this.status = `queued · ${sanitizeText(this.cfg().model)}`;
  }

  // ─── Quick-switch sesi (Alt+1..9) ───
  _pushRecentSession(id) {
    if (!id) return;
    this.recentSessions = [id, ...this.recentSessions.filter((x) => x !== id)].slice(0, 9);
  }

  _gotoSession(n) {
    const id = (this.recentSessions || [])[n - 1];
    if (!id) {
      this.push('info', `Slot ${n} kosong. Buka sesi lewat /load <id> atau /sessions dulu — slot terisi otomatis.`);
      this.render();
      return;
    }
    if (id === this.shell.sessionId) {
      this.push('info', `Sudah di sesi ${id} (slot ${n}).`);
      this.render();
      return;
    }
    this._loadSession(id);
  }

  _newSession() {
    if (this.busy && this.abortCtrl) this.abortCtrl.abort();
    if (this.permResolve) {
      const r = this.permResolve;
      this.permResolve = null;
      this.permReq = null;
      try { r(false); } catch {}
    }
    if (this.approvalResolve) this._settleApproval({ decision: 'reject', abort: true });
    this._endSessionRules();
    this._planReset();
    const id = 's' + Date.now().toString(36);
    this.shell.sessionId = id;
    this._pushRecentSession(id);
    if (this.agent) this.agent.reset();
    // Sesi baru = mulai bersih: todo sesi lama jangan ikut terbawa.
    this._replaceTodos([]);
    // Buang perubahan staged agar sesi baru benar-benar kosong.
    let discarded = 0;
    if (this.agent && this.agent.vfs && typeof this.agent.vfs.discardPending === 'function') {
      try {
        discarded = this.agent.vfs.discardPending();
      } catch {}
    }
    this.transcript = [];
    this._invalidateChat();
    this._ctxCache = null;
    this._ctxInfoCache = null;
    this._expandedToolGroups.clear();
    this.scroll = 0;
    this.sideScroll = 0;
    this.queue = [];
    this.awaitingApproval = false;
    this.awaitingPermission = false;
    clearAutosave(this.agent.vfs.root);
    this._setInput('');
    this.push('info', `New session: ${id}${discarded ? ` · ${discarded} staged discarded (sesi baru bersih)` : ''}`);
    this.mode = 'chat';
    this.render();
  }

  _complete() {
    const input = this.input;
    if (!input.startsWith('/')) {
      const space = this.input.lastIndexOf(' ');
      const word = space < 0 ? input : input.slice(space + 1);
      if (word.includes('@')) {

        const atIdx = word.lastIndexOf('@');
        const frag = word.slice(atIdx + 1);
        const atMatches = this._atCompletions(frag);
        if (atMatches.length === 1) {
          this._setInput(this.input.slice(0, space + 1) + word.slice(0, atIdx) + '@' + atMatches[0]);
          return;
        }
        if (atMatches.length > 1) {
          this._invalidateChat();
          this.transcript.push({ type: 'info', text: '→ @' + atMatches.join(', @') });
          this.scroll = 0;
        }
        return;
      }
      const matches = this._pathCompletions(word);
      if (matches.length === 1) {
        this._setInput(input.slice(0, space + 1) + matches[0]);
        return;
      }
      if (matches.length > 1) {
        this._invalidateChat();
        this.transcript.push({ type: 'info', text: '→ ' + matches.join(', ') });
        this.scroll = 0;
      }
      return;
    }
    const cmds = this._slashCommands().map((c) => c.slice(1));
    const matched = cmds.filter((c) => c.startsWith(input.slice(1)));
    if (matched.length === 1) {
      this._setInput('/' + matched[0] + ' ');
    } else if (matched.length > 1) {
      this._invalidateChat();
      this.transcript.push({ type: 'info', text: '→ /' + matched.join(', /') });
      this.scroll = 0;
    }
  }

  // BFS lewat seluruh path workspace (VFS), cocokkan substring (fuzzy).
  _atCompletions(partial) {
    const q = String(partial || '').toLowerCase();
    const vfs = this.shell && this.shell.vfs;
    const out = [];
    if (!vfs || typeof vfs.listDir !== 'function') return out;
    const stack = ['/'];
    let guard = 0;
    while (stack.length && guard++ < 4000) {
      const dir = stack.pop();
      let entries;
      try {
        entries = vfs.listDir(dir);
      } catch {
        continue;
      }
      for (const e of entries || []) {
        const full = (dir === '/' ? '/' : dir + '/') + e.name;
        if (e.dir) {
          stack.push(full);
          continue;
        }
        if (!q || full.toLowerCase().includes(q)) out.push(full);
        if (out.length >= 30) return out;
      }
    }
    return out;
  }

  // Saat kirim, perluas @<vfs path> jadi isi file supaya AI benar-benar
  // melihat kontennya (bukan cuma teks "@/src/x.js").
  _expandAtRefs(text) {
    return String(text).replace(/@(\/[\w.@+$~\-/()]+)/g, (_m, p) => {
      const content = this._readWorkspaceFile(p);
      if (content == null) return _m;
      return `\n<file:${p}>\n${content.slice(0, 8000)}${content.length > 8000 ? '\n…[truncated]' : ''}\n</file>\n`;
    });
  }

  _readWorkspaceFile(v) {
    const vfs = this.shell && this.shell.vfs;
    if (!vfs || typeof vfs.read !== 'function') return null;
    try {
      return vfs.read(v);
    } catch {
      return null;
    }
  }

  _pathCompletions(word) {
    if (!word || word.startsWith('/')) return [];
    const parts = word.split('/');
    const cur = parts[parts.length - 1];
    const dir = this.shell.cwd || '/';
    const entries = this.shell.vfs ? this.shell.vfs.listDir(dir) : [];
    return entries
      .filter((e) => e.name.startsWith(cur))
      .slice(0, 20)
      .map((e) => e.name + (e.dir ? '/' : ''));
  }

  _slashCommands() {
    return [
      '/help', '/clear', '/reset', '/init', '/provider', '/s', '/key', '/model', '/models', '/p', '/base', '/config', '/dev', '/about', '/credits',
      '/apply', '/reject', '/copy', '/img', '/paste', '/credit', '/kit', '/mouse', '/snd', '/shell', '/find', '/palette', '/theme', '/split', '/auto', '/websearch', '/ws', '/notes', '/ps', '/kill',       '/set', '/resume', '/usage', '/tokens', '/logs', '/expand', '/collapse', '/reasoning', '/think', '/diff', '/todo', '/sh', '/rule', '/skill', '/undo', '/redo', '/save', '/sessions', '/load', '/exit', '/plan', '/mcp',
      '/settings', '/setting', '/compact', '/new', '/perm', '/relax',
    ];
  }

  // Batas scroll maksimum. Sisa 2 baris dipakai marker atas/bawah, jadi top
  // content tetap bisa dicapai penuh saat scroll ke paling atas.
  _maxScrollFor(total, bodyRows) {
    if (total <= bodyRows) return 0;
    return Math.max(0, total - Math.max(1, bodyRows - 2));
  }

  _maxScroll() {
    const cols = Math.max(40, process.stdout.columns || 80);
    const rows = Math.max(12, process.stdout.rows || 30);
    const chatW = this._chatPaneWidth(cols);
    const bodyRows = Math.max(3, rows - 3 - this._inputArea(this._footCols()).height);
    return this._maxScrollFor(this._chatLines(chatW, Infinity).length, bodyRows);
  }

  _submit() {
    const text = this.input;
    const trimmed = text.trim();
    this._setInput('');
    this.historyIdx = -1;
    this.historyNav = false;
    if (!trimmed) return;
    if (this._tryAttachDropped(trimmed)) {
      this.render();
      return;
    }
    if (trimmed.startsWith('/')) {
      this._saveHistory(trimmed);
      this._slash(trimmed);
      return;
    }
    this._saveHistory(trimmed);
    this._planReset();
    this._expandedToolGroups.clear();
    this.transcript.forEach((t) => { t.expanded = false; });
    const imgs = this.pendingImages;
    this.pendingImages = [];
    const expanded = this._expandAtRefs(text.trim());
    for (const line of text.split('\n')) this.push('user', line);
    if (imgs.length) {
      for (const im of imgs) this.push('info', `📎 attached image: ${im.path}`);
      const parts = [];
      if (expanded.trim()) parts.push({ type: 'text', text: expanded });
      for (const im of imgs) parts.push({ type: 'image_url', image_url: { url: im.dataUrl } });
      this._runAI(parts);
      return;
    }
    this._runAI(expanded);
  }

  _saveHistory(line) {
    if (!line || !line.trim()) return;
    if (this.store) this.store.addHistory(line);
    this.history.push(line);
    if (this.history.length > 200) this.history.shift();
  }

  _slash(text) {
    const [cmd, arg] = text.split(/\s+/);
    const rest = text.indexOf(' ') >= 0 ? text.slice(text.indexOf(' ') + 1).trim() : '';
    switch (cmd) {
    case '/settings':
    case '/setting':
      this.mode = 'settings';
      this.settingsIdx = 0;
      break;
    case '/provider':
    case '/s': {
      const sub = rest ? rest.toLowerCase() : '';
      if (sub.startsWith('add')) this._providerAdd(rest);
      else if (sub.startsWith('custom')) this._providerCustom(rest);
      else if (sub.startsWith('rm') || sub.startsWith('del')) this._providerRm(rest);
      else if (sub.startsWith('enable')) this._providerToggle(rest, true);
      else if (sub.startsWith('disable')) this._providerToggle(rest, false);
      else if (sub.startsWith('manifest')) this._providerManifest(rest);
      else if (sub === 'refresh') this._providerRefresh();
      else if (sub === 'list') this._psLikeProviders();
      else {
        this.mode = 'provider';
        this.providerIdx = Math.max(0, providerList().indexOf(this.cfg().provider));
      }
      break;
    }
    case '/model':
    case '/models':
    case '/p':
      this._openModel();
      break;
    case '/base': {
      const url = rest.trim();
      if (!url) {
        this.push('info', `Current base URL: ${this.cfg().baseUrl}${this.cfg()._baseOverride ? ' (override)' : ''}`);
        break;
      }
      saveConfig({ baseUrl: url, _baseOverride: true });
      this.agent.refresh();
      this.push('info', `Base URL diubah → ${url}`);
      break;
    }
    case '/sh': {
      const c = rest;
      if (!c) {
        this.push('info', 'usage: /sh <command> — run a shell command (allow/ask/deny rules like run_command)');
        break;
      }
      const decision = this.agent.classifyShell(c);
      if (decision.decision === 'deny') {
        this.push('error', `Command blocked by rule (${decision.reason}).`);
        break;
      }
      const run = () => {
        let shellSnapshot = null;
        if (this.agent && typeof this.agent.beforeShell === 'function') {
          try {
            shellSnapshot = this.agent.beforeShell(c);
          } catch (error) {
            this.push('error', error.message || String(error));
            this.render();
            return;
          }
        }
        this.push('tool', `$ ${c}`);
        this.render();
        runCommand(c, { cwd: this.agent.vfs.root, timeout: 120000, jail: !!this.cfg().runJail, shell: this.cfg().shell })
          .then((res) => {
            try {
              this.agent.afterShell?.(shellSnapshot);
            } catch (error) {
              this.push('error', error.message || String(error));
              this.render();
              return;
            }
            const out = [res.stdout, res.stderr ? `STDERR:\n${res.stderr}` : ''].filter(Boolean).join('\n').trim();
            const undoNote = shellSnapshot && shellSnapshot.partial
              ? `\n[UNDO PARTIAL: ${shellSnapshot.skipped.length} file dilewati karena batas ukuran snapshot.]`
              : '';
            this.push(res.exit === 0 ? 'result' : 'error', `${out || '(tanpa output)'}\n[exit ${res.exit}]${undoNote}`);
            this.render();
          })
          .catch((e) => {
            let detail = e.message || String(e);
            try {
              this.agent.afterShell?.(shellSnapshot);
            } catch (snapshotError) {
              detail += `\n${snapshotError.message || String(snapshotError)}`;
            }
            this.push('error', detail);
            this.render();
          });
      };
      if (decision.decision === 'allow') run();
      else {
        this._askPerm({
          type: 'shell',
          reason: decision.reason,
          command: c,
          cwd: this.agent.vfs.root,
          shell: describeShell(this.cfg().shell),
          timeout: 120000,
          background: false,
          alwaysConfirm: !!decision.alwaysConfirm,
        }).then((ok) => {
          if (ok) run();
          else this.push('info', 'Canceled.');
        });
      }
      break;
    }
    case '/key':
      this.mode = 'key';
      this.keyHeader = `API key for ${(providerInfo(this.cfg().provider) || {}).name || this.cfg().provider}`;
      this.keyBuffer = '';
      break;
    case '/config': {
      const c = this.cfg();
      this.push('info', `provider=${c.provider} baseUrl=${c.baseUrl} model=${c.model} key=${maskKey(c.apiKey)}`);
      break;
    }
    case '/dev':
    case '/about':
    case '/credits':
      this._openDev();
      break;
    case '/reset':
      this._planReset();
      this.agent.reset();
      this.push('info', 'AI history reset.');
      break;
    case '/init': {
      this._planReset();
      this.push('user', '/init');
      this._runAI(
        'INIT PROJECT (onboarding): analyze this workspace — start with workspace_tree, then read key files (package.json / README / entry points / config). ' +
            'Create an AGENTS.md at the workspace root covering: project purpose, structure, how to build/test/lint/run, and coding conventions. ' +
            'Keep it practical (around 150 lines max). Write it to /AGENTS.md via write_file (it will be staged), then STOP for approval.'
      );
      break;
    }
    case '/todo': {
      const sub = (text.split(/\s+/)[1] || '').toLowerCase();
      if (sub === 'list' || sub === '') this._openTodo();
      else this._todo(text);
      break;
    }
    case '/diff': {
      if (!this.agent.vfs.hasPending()) {
        this.push('info', 'Nothing staged.');
        break;
      }
      this._presentApproval();
      break;
    }
    case '/apply':
      this._applyCmd(arg);
      break;
    case '/reject':
      this._rejectCmd(arg);
      break;
    case '/copy':
      this._copyCmd(arg);
      break;
    case '/img':
      this._imgCmd(rest);
      break;
    case '/paste':
      this._pasteCmd();
      break;
    case '/credit':
      this._creditCmd(rest);
      break;
    case '/kit':
      this._kitCmd(rest);
      break;
    case '/mouse':
      this._mouseCmd(arg);
      break;
    case '/snd':
      this._sndCmd(arg);
      break;
    case '/find':
      this._openFind(rest);
      break;
    case '/palette':
      this._openPalette();
      break;
    case '/split':
      this._openSplit(rest);
      break;
    case '/relax':
      this._relaxCmd();
      break;
    case '/theme':
      this._themeCmd(arg);
      break;
    case '/shell':
      this._shellCmd(arg);
      break;
    case '/auto':
      this._autoCmd(arg);
      break;
    case '/websearch':
    case '/ws':
      this._openWebSearch();
      break;
    case '/notes':
      this._notesCmd(arg);
      break;
    case '/ps':
      this._psCmd(null);
      break;
    case '/kill':
      this._psCmd(arg);
      break;
    case '/set':
      this._setCmd(text.slice(5).trim());
      break;
    case '/resume':
      this._resumeCmd();
      break;
    case '/usage':
    case '/tokens':
      this._usageCmd();
      break;
    case '/logs':
      this._logsCmd();
      break;
    case '/expand':
    case '/collapse':
      this._expandCmd(cmd === '/expand' ? 'expand' : 'collapse', arg);
      break;
    case '/reasoning':
    case '/think':
      this._reasoningCmd(rest);
      break;
    case '/compact': {
      const parts = rest.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      if (sub === 'mode') {
        const mode = (parts[1] || '').toLowerCase();
        const allowed = ['legacy', 'shadow', 'safe', 'experimental', 'urich', 'off'];
        if (!allowed.includes(mode)) {
          this.push('info', 'Usage: /compact mode <legacy|shadow|safe|experimental|urich|off>');
        } else {
          this.agent.setConfig({ compactionMode: mode });
          saveConfig({ compactionMode: mode });
          this.push('info', `Compaction mode: ${mode} (saved)`);
        }
        this.render();
        break;
      }
      if (sub === 'auto') {
        const value = (parts[1] || '').toLowerCase();
        if (!value) {
          const mode = this.agent.compactionStats().mode;
          if (mode !== 'urich') {
            this.push('info', 'Usage: /compact auto <on|off> (auto test only in urich mode: /compact mode urich)');
            this.render();
            break;
          }
          this.push('info', 'Testing auto-compaction (urich)...');
          this.render();
          this.agent
            .compactIfNeeded(false, { trigger: 'auto' })
            .then((s) => {
             const st = this.agent.compactionStats();
             this.push(s ? 'info' : 'error', s
               ? `Auto test: compacted · mode=${st.mode} · trigger=${st.lastTrigger || '-'} · ${st.beforeTokens || '-'} → ${st.afterTokens || '-'} tok`
               : this._compactionNoResultText(st));
             if (this.agent) this._lastCompactionAt = this.agent.lastCompactionAt || this._lastCompactionAt;
              this.render();
            })
            .catch((e) => {
              this.push('error', 'Auto test failed: ' + e.message);
              this.render();
            });
          break;
        }
        if (!['on', 'off'].includes(value)) this.push('info', 'Usage: /compact auto <on|off>');
        else {
          const enabled = value === 'on';
          this.agent.setConfig({ compactionAuto: enabled });
          saveConfig({ compactionAuto: enabled });
          this.push('info', `Auto-compaction: ${enabled ? 'on' : 'off'} (saved)`);
        }
        this.render();
        break;
      }
      if (sub === 'threshold') {
        const value = (parts[1] || '').toLowerCase();
        if (value === 'auto' || value === 'adaptive') {
          this.agent.setConfig({ compactionThreshold: 0.45, compactionThresholdLocked: false });
          saveConfig({ compactionThreshold: 0.45, compactionThresholdLocked: false });
          this.agent._autoCompactThreshold = 0.45;
          this.agent._thresholdLocked = false;
          this.push('info', 'Compaction threshold: adaptive (saved)');
        } else {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0.3 || n > 0.75) {
            this.push('info', 'Usage: /compact threshold <0.3-0.75 | auto>');
          } else {
            this.agent.setConfig({ compactionThreshold: n, compactionThresholdLocked: true });
            saveConfig({ compactionThreshold: n, compactionThresholdLocked: true });
            this.agent._autoCompactThreshold = n;
            this.agent._thresholdLocked = true;
            this.push('info', `Compaction threshold: ${n} (locked, saved)`);
          }
        }
        this.render();
        break;
      }
      if (sub === 'keep') {
        const value = (parts[1] || '').toLowerCase();
        if (value === 'auto' || value === 'adaptive') {
          this.agent.setConfig({ compactionKeepTokens: 0 });
          saveConfig({ compactionKeepTokens: 0 });
          this.push('info', 'Compaction keep tokens: adaptive (saved)');
        } else {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 400) {
            this.push('info', 'Usage: /compact keep <tokens>=400 | auto>');
          } else {
            this.agent.setConfig({ compactionKeepTokens: n });
            saveConfig({ compactionKeepTokens: n });
            this.push('info', `Compaction keep tokens: ${n} (saved)`);
          }
        }
        this.render();
        break;
      }
      if (sub === 'buffer') {
        const value = (parts[1] || '').toLowerCase();
        if (value === 'auto' || value === 'adaptive') {
          this.agent.setConfig({ compactionBufferRatio: 0 });
          saveConfig({ compactionBufferRatio: 0 });
          this.push('info', 'Compaction buffer: adaptive 30% (saved)');
        } else {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0.1 || n > 0.5) {
            this.push('info', 'Usage: /compact buffer <0.1-0.5 | auto>');
          } else {
            this.agent.setConfig({ compactionBufferRatio: n });
            saveConfig({ compactionBufferRatio: n });
            this.push('info', `Compaction buffer: ${n} (saved)`);
          }
        }
        this.render();
        break;
      }
      if (sub === 'stats') {
        const stats = this.agent.compactionStats();
        this.push('info', `Compaction: mode=${stats.mode} · active=${stats.compactions}x · checkpoint=${stats.checkpoint ? stats.checkpoint.id : 'none'}\n` + JSON.stringify({ shadow: stats.shadow, validation: stats.validation, urich: stats.urich }, null, 2));
        this.render();
        break;
      }
      if (sub === 'rollback') {
        const record = this.agent.rollbackCompaction();
        this.push(record ? 'info' : 'error', record ? `Compaction rollback restored: ${record.checkpoint_id}` : 'No compaction checkpoint to roll back.');
        this.render();
        break;
      }
      this.push('info', 'Compacting history...');
      this._syncCompactionLive();
      this.render();
      const liveTimer = setInterval(() => {
        if (this.closed) {
          clearInterval(liveTimer);
          return;
        }
        this._syncCompactionLive();
        this.render();
      }, 220);
       this.agent
         .compactIfNeeded(true)
           .then((s) => {
              if (s) {
                const st = this.agent.compactionStats ? this.agent.compactionStats() : null;
                const text = this._compactionResultText('manual', st);
                this._pushTypedCompactionLines(text.split('\n'));
                if (this.agent) this._lastCompactionAt = this.agent.lastCompactionAt || this._lastCompactionAt;
              } else {
               const st = this.agent.compactionStats ? this.agent.compactionStats() : null;
               this.push('error', this._compactionNoResultText(st));
             }
             this.render();
           })
        .catch((e) => {
          this.push('error', 'Failed to compact: ' + e.message);
          this.render();
        })
        .finally(() => {
          clearInterval(liveTimer);
          this.compactionLive = null;
          this.render();
        });
      break;
    }
    case '/clear':
      this.transcript = [];
      this._invalidateChat();
      break;
    case '/new':
      this._newSession();
      return;
    case '/perm':
      this._permCmd(text);
      break;
    case '/help':
      this._openHelp();
      break;
    case '/exit':
      return this.quit();
    case '/rule':
      this._ruleCmd(text);
      break;
    case '/skill':
      this._skillCmd(text);
      break;
    case '/plan': {
      const task = rest.trim();
      if (!task) {
        this.push('info', 'usage: /plan <task> — AI membuat RENCANA dulu (tanpa mengubah file), lalu [y] execute · [n] revise · [Esc] dismiss');
        break;
      }
      this._planReset();
      if (this.agent && typeof this.agent.setPlanMode === 'function') this.agent.setPlanMode(true);
      this.planning = true;
      for (const line of task.split('\n')) this.push('user', line);
      this._runAI(task);
      break;
    }
    case '/mcp':
      this._mcpCmd(rest).catch((e) => {
        this.push('error', `MCP error: ${e && e.message ? e.message : e}`);
        this.render();
      });
      break;
    case '/undo':
      this._undoCmd();
      break;
    case '/redo':
      this._redoCmd();
      break;
    case '/save':
      this._saveSession();
      break;
    case '/sessions': {
      const sub = (arg || '').toLowerCase();
      if (sub === 'import') this._sessionImport(rest.replace(/^import\s+/i, ''));
      else if (sub === 'export') this._sessionExport(rest.replace(/^export\s+/i, ''));
      else if (sub === 'list') this._listSessions();
      else this._openSessions();
      break;
    }
    case '/load':
      this._planReset();
      this._loadSession(arg);
      break;
    default:
      this.push('info', `unknown command: ${cmd} (try /help for the list)`);
    }
  }

  // ─── Search chat (mode 'find') ───
  // Semua baris chat (full, bukan yang terpotong window) discari; hasilnya
  // disorot inverse di window yang tampil. n/N atau Enter cycle, Esc tutup.
  _findLines(chatW) {
    const ansi = this._chatLines(chatW, Infinity);
    const plain = ansi.map((l) => stripAnsi(l));
    return { ansi, plain };
  }

  _openFind(q) {
    this.mode = 'find';
    this.find = { q: String(q || ''), matches: [], cur: 0 };
    this._findRefresh();
  }

  _findRefresh() {
    const cols = Math.max(40, process.stdout.columns || 80);
    const chatW = this._chatPaneWidth(cols);
    const { plain } = this._findLines(chatW);
    const q = (this.find.q || '').toLowerCase();
    this.find.matches = q ? plain.map((l, i) => (l.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0) : [];
    this.find.cur = 0;
    if (this.find.matches.length) this._findScrollTo(this.find.matches[0]);
    this.render();
  }

  _findScrollTo(row) {
    const cols = Math.max(40, process.stdout.columns || 80);
    const rows = Math.max(12, process.stdout.rows || 30);
    const chatW = this._chatPaneWidth(cols);
    const total = this._findLines(chatW).plain.length;
    // Mode find: tanpa box input, footer = garis + hints (2 baris).
    const bodyRows = Math.max(3, rows - 4);
    // Taruh kira-kira di tengah viewport.
    this.scroll = Math.max(0, total - row - Math.floor(bodyRows / 2));
  }

  _findStep(delta) {
    const n = this.find.matches.length;
    if (!n) return;
    this.find.cur = (this.find.cur + delta + n) % n;
    this._findScrollTo(this.find.matches[this.find.cur]);
    this.render();
  }

  _handleFind(key) {
    if (key === 'esc' || key === 'ctrl+c') {
      this.mode = 'chat';
      this.find = null;
      this.render();
      return;
    }
    if (key === 'enter' || key === 'n' || key === 'down') return this._findStep(1);
    if (key === 'N' || key === 'up' || (key && key.ch === 'N')) return this._findStep(-1);
    if (key === 'backspace') {
      this.find.q = this.find.q.slice(0, -1);
      this._findRefresh();
      return;
    }
    if (key && key.ch && key.ch.length === 1 && key.ch >= ' ') {
      this.find.q += key.ch;
      this._findRefresh();
    }
  }

  // ─── Command palette (mode 'palette', Ctrl+K atau /palette) ───
  // Fuzzy search semua aksi: slash command, sesi tersimpan, skill.
  _openPalette() {
    if (!this.helpList) this.helpList = this._helpListData();
    const items = [];
    // Slash commands (dari daftar help — deskripsi ikut jadi hint).
    for (const [cmd, desc] of this.helpList) {
      if (!cmd.startsWith('/')) continue;
      items.push({ label: cmd.split(' ')[0], hint: desc, run: () => this._slash(cmd.split(' ')[0]) });
    }
    items.push({ label: '/compact mode urich', hint: 'enable DIS-URICH mode (default)', run: () => this._slash('/compact mode urich') });
    items.push({ label: '/compact auto', hint: 'test auto-compaction in urich mode', run: () => this._slash('/compact auto') });
    // Sesi tersimpan.
    try {
      if (this.store && typeof this.store.listSessions === 'function') {
        for (const s of this.store.listSessions()) {
          items.push({ label: `/load ${s.id}`, hint: `session · ${s.label || s.ts || ''}`, run: () => this._loadSession(s.id) });
        }
      }
    } catch {}
    // Skill.
    try {
      if (this.store && typeof this.store.skills === 'function') {
        for (const s of this.store.skills()) {
          items.push({ label: `/skill use ${s.name}`, hint: 'skill', run: () => this._skillCmd(`/skill use ${s.name}`) });
        }
      }
    } catch {}
    this.paletteItems = items;
    this.paletteFilter = '';
    this.paletteIdx = 0;
    this._paletteRefresh();
    this.mode = 'palette';
    this.render();
  }

  _paletteRefresh() {
    const f = (this.paletteFilter || '').toLowerCase();
    if (!f) {
      this.paletteFiltered = this.paletteItems.slice(0, 50);
    } else {
      // Fuzzy: semua huruf query muncul berurutan (bukan harus contiguous).
      const scored = [];
      for (const it of this.paletteItems) {
        const hay = (it.label + ' ' + (it.hint || '')).toLowerCase();
        let hi = 0;
        let ok = true;
        for (const ch of f) {
          hi = hay.indexOf(ch, hi);
          if (hi < 0) {
            ok = false;
            break;          }
          hi++;
        }
        if (ok) scored.push({ it, score: hay.indexOf(f) >= 0 ? 0 : 1 });
      }
      scored.sort((a, b) => a.score - b.score);
      this.paletteFiltered = scored.slice(0, 50).map((s) => s.it);
    }
    if (this.paletteIdx >= this.paletteFiltered.length) this.paletteIdx = 0;
  }

  _handlePalette(key) {
    if (key === 'esc' || key === 'ctrl+c' || key === 'ctrl+k') {
      this.mode = 'chat';
      this.render();
      return;
    }
    if (key === 'up') {
      if (this.paletteFiltered.length) this.paletteIdx = (this.paletteIdx - 1 + this.paletteFiltered.length) % this.paletteFiltered.length;
      this.render();
      return;
    }
    if (key === 'down') {
      if (this.paletteFiltered.length) this.paletteIdx = (this.paletteIdx + 1) % this.paletteFiltered.length;
      this.render();
      return;
    }
    if (key === 'enter') {
      const it = this.paletteFiltered[this.paletteIdx];
      this.mode = 'chat';
      if (it && typeof it.run === 'function') it.run();
      this.render();
      return;
    }
    if (key === 'backspace') {
      this.paletteFilter = this.paletteFilter.slice(0, -1);
      this.paletteIdx = 0;
      this._paletteRefresh();
      this.render();
      return;
    }
    if (key && key.ch && key.ch.length === 1 && key.ch >= ' ') {
      this.paletteFilter += key.ch;
      this.paletteIdx = 0;
      this._paletteRefresh();
      this.render();
    }
  }

  _bodyPalette(cols, bodyRows) {
    const out = ['', p(C.bold, '  Command Palette'), '', `  ${p(C.dim, '>')} ${p(C.heading, this.paletteFilter || '')}${p(C.gray, '▍')}`, ''];
    const rows = Math.max(3, bodyRows - out.length - 2);
    const win = windowedList(this.paletteFiltered, this.paletteIdx, rows);
    if (!this.paletteFiltered.length) out.push(p(C.dim, '  (tidak ada yang cocok)'));
    win.items.forEach((it, i) => {
      const abs = win.start + i;
      const sel = abs === this.paletteIdx;
      const marker = sel ? p(C.cyan, ' ► ') : '   ';
      out.push(`  ${marker}${sel ? p(C.cyan + C.bold, it.label) : it.label}${it.hint ? '  ' + p(C.dim, it.hint) : ''}`);
    });
    out.push('');
    out.push(p(C.dim, `  ${this.paletteFiltered.length} aksi · ↑↓ pilih · Enter jalankan · Esc tutup`));
    return out.slice(0, bodyRows);
  }

  // Satu sumber data untuk /help DAN command palette.
  _helpListData() {
    const list = [
      ['Ctrl+B/S/N/P/G', 'sidebar · settings · new session · switch model · mouse · Esc stop'],
      ['{ } · [ ]', 'Scroll sidebar · resize sidebar (when input empty & sidebar shown)'],
      ['Alt+1..9', 'Switch to a recent session (⇥ tab strip in the header)'],
      ['@ file', 'Type @ then Tab to reference a workspace file — its content is sent to the AI'],
      ['/help', 'Show this command list'],
      ['/settings · /setting', 'Settings (Ctrl+S): provider · API key · model · notifications'],
      ['/provider', 'Choose AI provider'],
      ['/s · /provider', 'Shortcut: set provider (same as /provider)'],
      ['/provider add|rm|enable|disable|list|manifest|refresh', 'Manage providers (custom, ON/OFF, remote manifest)'],
      ['/key <key>', 'Set provider API key'],
      ['/model [n|name]', 'List/set model'],
      ['/p · /model', 'Shortcut: choose model (same as /model)'],
      ['/base [url]', 'View / override provider base URL'],
      ['/config', 'Show config'],
      ['/dev · /about', 'About & developer attribution (NTVGraph · Niyusha)'],
      ['/reset', 'Reset AI history'],
      ['/init', 'Analyze this project and create an AGENTS.md (staged) with structure, build/test commands & conventions'],
      ['/apply [n|path]', 'Approve staged changes → AI continues'],
      ['/apply auto', 'Approve all + auto-apply for this session'],
      ['/reject [n|path]', 'Reject staged changes → AI re-strategizes'],
      ['/copy [all]', 'Copy last answer / whole chat to clipboard'],
      ['/img <path...>', 'Attach image(s) to your next message, or just drop/paste a file path (needs a vision-capable model); /img cancel to clear'],
      ['/paste', 'Paste an image (or path) from the clipboard to attach to your next message (Ctrl+V also works where the terminal forwards it)'],
      ['/credit [on|off]', `Show/hide the "${CREDIT_TEXT}" footer on kit-generated sites (default off — turning it on is much appreciated!)`],
      ['/kit [web] <name>', 'Scaffold a NEW site from a Niyusha kit (signature look); staged for your review'],
      ['/sh <cmd>', 'Run a shell command (allow/ask/deny rules like run_command)'],
      ['/mouse [on|off]', 'Toggle mouse text-select (select chat, auto-copy)'],
      ['/snd [on|off|bell|double|ding]', 'Sound when AI finishes: bell · double beep · ding (system). Default: off'],
      ['/shell [auto|cmd|powershell|pwsh|bash|wsl]', 'Choose shell for run_command (default auto; auto-WSL for UNC paths; fallback if shell missing)'],
      ['/auto [on|off]', 'Autonomous mode: auto-apply files + auto shell (dangerous & outside still asked); files stay /undo-able'],
      ['/websearch · /ws', 'Web search settings (on/off · provider · API key · limit)'],
      ['/notes [clear]', 'View/save session notes (scratch notepad)'],
      ['/ps · /kill <pid>', 'List / stop background processes'],
      ['/set <key> <value>', 'Change params: temperature maxtokens streaming timeout retries retrybasems autocontinue cacheratio showcost runjail runundo banner icon'],
      ['NIYUSHA_ASCII=1', 'Force ASCII mascot/symbols if your terminal shows boxes or `?` (legacy console)'],
      ['/resume', 'Resume last session (autosave)'],
      ['/usage · /tokens', 'Session token usage: accumulated input/output/total + live context meter'],
      ['/logs', 'View recent errors/events (~/.niyusha/logs.jsonl)'],
      ['/expand [n] · /collapse [n]', 'Expand/collapse n-th box — code & reasoning (default: last)'],
      ['/reasoning [n|all|collapse]', 'Show/hide full reasoning (alias /think; default collapsed tail)'],
      ['/diff', 'Show staged changes in chat'],
      ['/undo', 'Rollback last change — applied files OR shell-command effects (workspace restored)'],
      ['/redo', 'Re-apply the last change you rolled back with /undo (files only)'],
      ['/todo <add|list|done|rm> <n>', 'Task management'],
      ['/perm <list|allow|deny|rm|reset>', 'Command permission rules (allow/ask/deny)'],
      ['/rule add|rm|clear', 'Rules for THIS session only (auto-clear when session ends); core rules: AGENTS.md/rules.md'],
      ['/skill <save|use|ls|rm|auto|on|off|log>', 'Save / use / inspect conditional skills'],
      ['/save', 'Save this conversation'],
      ['/sessions', 'Interactive picker: Enter load · n new · s save · d delete (list: /sessions list)'],
      ['/sessions export|import', 'Export/import sessions to/from a JSON file (cross-workspace)'],
      ['/load <id>', 'Load a saved session'],
      ['/compact [mode <...>|auto [on|off]|stats|rollback]', 'Compact AI history; default mode urich (DIS-URICH), legacy = traditional compaction (auto with no value = auto test)'],
      ['/clear', 'Clear the screen'],
      ['/new', 'New session (Ctrl+N)'],
      ['/exit', 'Quit'],
      ['/find <term>', 'Search the chat transcript (n next · N prev · keep typing to refine)'],
      ['/palette', 'Command palette — fuzzy search all actions (Ctrl+K)'],
      ['/plan <task>', 'AI makes a PLAN only (no file changes) → [y] execute · [n] revise · [Esc] dismiss'],
      ['/mcp', 'MCP servers — ls · add <name> <cmd> [--trusted] [--env K=V] · addurl · rm · on|off · trust · refresh'],
      ['/theme [name]', 'Color theme: dark-blue · matrix · cyberpunk · slate · midnight (default: dark-blue)'],
      ['/split [n|path]', 'Review staged changes side-by-side (left before · right after)'],
      ['/relax', 'Relax mode: minimal monochrome chat (toggle: Ctrl+R or /relax)'],
    ];
    // Urut: baris keybinding tetap di atas (urutan asli), lalu slash command
    // urut abjad berdasarkan huruf awal supaya /help gampang dipindai.
    const key = (s) => String(s).replace(/^\//, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const other = list.filter((r) => !String(r[0]).startsWith('/'));
    const cmds = list.filter((r) => String(r[0]).startsWith('/'));
    cmds.sort((a, b) => {
      const ka = key(a[0]);
      const kb = key(b[0]);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return [...other, ...cmds];
  }

  // ─── Split diff viewer (mode 'split') ───
  _openSplit(idx) {
    const pending = this.agent.vfs && this.agent.vfs.pendingChanges ? this.agent.vfs.pendingChanges() : [];
    if (!pending.length) {
      this.push('info', 'Tidak ada perubahan staged. Minta AI mengubah file dulu, lalu /split.');
      this.render();
      return;
    }
    let i = 0;
    if (idx) {
      const n = Number(idx);
      if (Number.isInteger(n) && n >= 1 && n <= pending.length) i = n - 1;
      else {
        const found = pending.findIndex((c) => c.path === (idx.startsWith('/') ? idx : '/' + idx) || c.path.endsWith('/' + idx.replace(/^\/+/, '')));
        if (found >= 0) i = found;
      }
    }
    const c = pending[i];
    const pairs = splitPairs(this._diffTextFor(c));
    this.split = { pairs, path: c.path, op: c.op, idx: 0, n: i + 1, total: pending.length };
    this.mode = 'split';
    this.render();
  }

  _handleSplit(key) {
    if (key === 'esc' || key === 'q' || key === 'ctrl+c') {
      this.mode = 'chat';
      this.split = null;
      this.render();
      return;
    }
    const rows = Math.max(3, (process.stdout.rows || 30) - 8);
    if (key === 'up') this.split.idx = Math.max(0, this.split.idx - 1);
    else if (key === 'down') this.split.idx = Math.min(Math.max(0, this.split.pairs.length - rows), this.split.idx + 1);
    else if (key === 'pgup') this.split.idx = Math.max(0, this.split.idx - rows);
    else if (key === 'pgdn') this.split.idx = Math.min(Math.max(0, this.split.pairs.length - rows), this.split.idx + rows);
    else if (key === 'tab') {
      // ganti file berikutnya
      this._openSplit((this.split.n % this.split.total) + 1);
      return;
    }
    this.render();
  }

  _bodySplit(cols, bodyRows) {
    const s = this.split;
    const out = [];
    const w = Math.max(20, Math.floor((cols - 1) / 2));
    const opTag = s.op === 'create' ? 'baru' : s.op === 'delete' ? 'hapus' : 'ubah';
    let added = 0;
    let removed = 0;
    for (const pr of s.pairs) {
      if (pr.right && !pr.ctx) added++;
      if (pr.left && !pr.ctx) removed++;
    }
    out.push('');
    out.push(`  ${p(C.orange + C.bold, '▶ ⧗ SPLIT DIFF')} ${p(C.cyan, s.path)}  ${p(C.dim, opTag)}  ${p(C.green, '+' + added)} ${p(C.red, '-' + removed)}  ${p(C.dim, `(${s.n}/${s.total})`)}`);
    out.push('');
    const rows = Math.max(3, bodyRows - 5);
    const win = s.pairs.slice(s.idx, s.idx + rows);
    out.push('  ' + p(C.dim, '─ SEBELUM '.padEnd(w - 1, '─')) + '┬' + p(C.dim, '─ SESUDAH '.padEnd(w - 1, '─')));
    for (const pr of win) {
      if (pr.header) {
        out.push('  ' + p(C.dim, truncateDisp(pr.header, w * 2)));
        continue;
      }
      const ltxt = pr.left == null ? '' : pr.left;
      const rtxt = pr.right == null ? '' : pr.right;
      const lcol = pr.left == null ? C.dim : pr.ctx ? C.gray : C.red;
      const rcol = pr.right == null ? C.dim : pr.ctx ? C.gray : C.green;
      const lmark = pr.ctx ? '  ' : '- ';
      const rmark = pr.ctx ? '  ' : '+ ';
      out.push(
        '  ' +
          p(lcol, this._splitPad(lmark + truncateDisp(ltxt, w - 4), w - 2)) +
          p(C.dim, '│') +
          p(rcol, this._splitPad(rmark + truncateDisp(rtxt, w - 4), w - 2))
      );
    }
    if (s.pairs.length > rows) {
      out.push('');
      out.push(p(C.dim, `  ↑↓ scroll · PgUp/PgDn · Tab file berikutnya (${s.idx + 1}–${Math.min(s.pairs.length, s.idx + rows)} dari ${s.pairs.length}) · Esc tutup`));
    } else {
      out.push('');
      out.push(p(C.dim, '  Tab file berikutnya · Esc tutup'));
    }
    return out.slice(0, bodyRows);
  }

  // Padding aman-ANSI untuk viewer split.
  _splitPad(s, width) {
    const v = visibleLen(s);
    return v >= width ? cutAnsi(s, width) : s + ' '.repeat(width - v);
  }

  _openHelp() {
    this.helpList = this._helpListData();
    this.mode = 'help';
    this.helpIdx = 0;
    this.helpScroll = 0;
  }

  _handleHelp(key) {
    const k = typeof key === 'string' ? key : (key && key.ch) || '';
    if (k === 'esc' || k === 'q' || k === 'enter') {
      this.mode = 'chat';
      return;
    }
    const page = Math.max(8, Math.floor(((this._view && this._view.h) || 24) - 8));
    if (k === 'up') {
      this.helpScroll = Math.max(0, this.helpScroll - 1);
      return;
    }
    if (k === 'down') {
      this.helpScroll++;
      return;
    }
    if (k === 'pgup') {
      this.helpScroll = Math.max(0, this.helpScroll - page);
      return;
    }
    if (k === 'pgdn') {
      this.helpScroll += page;
      return;
    }
  }

  _bodyHelp(cols, bodyRows) {
    const out = ['', p(C.bold + C.cyan, '  Niyusha Terminal — Help')];
    out.push('');
    const items = this.helpList.map(([cmd, desc]) => `  ${p(C.green, cmd.padEnd(26))} ${p(C.dim, desc)}`);
    const total = items.length;
    // Sisa 3 baris untuk marker atas/bawah + hint scroll.
    const rows = Math.max(3, bodyRows - out.length - 3);
    this.helpScroll = Math.max(0, Math.min(this.helpScroll, total - rows));
    const win = items.slice(this.helpScroll, this.helpScroll + rows);
    out.push(...win);
    if (this.helpScroll > 0) out.push(p(C.dim, `  ↑ … ${this.helpScroll} more above`));
    if (this.helpScroll + rows < total) out.push(p(C.dim, `  ↓ … ${total - this.helpScroll - rows} more below`));
    out.push(p(C.dim, '  ↑↓ scroll · PgUp/PgDn · q/Esc back'));
    return out.slice(0, bodyRows);
  }

  _todos() {
    if (this.store) return this.store.todos();
    const st = this.agent.state || (this.agent.state = {});
    if (!Array.isArray(st.todos)) st.todos = [];
    return st.todos;
  }

  _persistTodos() {
    if (this.store) this.store.setTodos(this._todos());
  }

  // Ganti seluruh daftar todo (termasuk mengosongkannya). Dipakai saat start
  // baru, sesi baru, dan restore agar todo tidak "menempel" dari sesi lain.
  _replaceTodos(list) {
    const cur = this._todos();
    cur.length = 0;
    if (Array.isArray(list)) cur.push(...list);
    if (this.agent) {
      this.agent.state = this.agent.state || {};
      this.agent.state.todos = cur;
    }
    this._persistTodos();
  }

  _todo(text) {
    const todos = this._todos();
    const parts = text.split(/\s+/);
    const sub = (parts[1] || 'list').toLowerCase();
    const arg = parts.slice(2).join(' ').trim();
    if (sub === 'list') {
      if (!todos.length) return this.push('info', 'No todos. Add one: /todo add <task>');
      const done = todos.filter((t) => t.done || t.status === 'completed').length;
      this.push('info', `Todos — ${done}/${todos.length} completed`);
      const mark = (t) => (t.done || t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]');
      todos.forEach((t, i) => this.push('info', `${i + 1}. ${mark(t)} ${t.text}`));
      return;
    }
    if (sub === 'add') {
      if (!arg) return this.push('info', 'Usage: /todo add <task>');
      todos.push({ text: arg, status: 'pending', done: false });
      this._persistTodos();
      return this.push('info', `Todo added (${todos.length} total): ${arg}`);
    }
    if (sub === 'done' || sub === 'undo' || sub === 'rm') {
      const n = parseInt(parts[2] || '', 10);
      const idx = Number.isNaN(n) ? -1 : n - 1;
      if (idx < 0 || idx >= todos.length) return this.push('info', `Usage: /todo ${sub} <number>`);
      if (sub === 'done') {
        todos[idx].done = true;
        todos[idx].status = 'completed';
      } else if (sub === 'undo') {
        todos[idx].done = false;
        todos[idx].status = 'pending';
      } else todos.splice(idx, 1);
      this._persistTodos();
      this.push('info', `Todo #${n} ${sub === 'rm' ? 'removed' : sub === 'done' ? 'done ✓' : 'reopened'}.`);
      return;
    }
    if (sub === 'clear') {
      todos.length = 0;
      this._persistTodos();
      return this.push('info', 'All todos cleared.');
    }
    this.push('info', 'todo commands: add <text>, list, done <n>, undo <n>, rm <n>, clear');
  }

  _openTodo() {
    this.mode = 'todo';
    this.todoIdx = 0;
  }

  _handleTodo(key) {
    const todos = this._todos();
    const k = typeof key === 'string' ? key : (key && key.ch) || '';
    if (k === 'esc' || k === 'q') {
      this.mode = 'chat';
      return;
    }
    if (k === 'up') {
      this.todoIdx = Math.max(0, this.todoIdx - 1);
      return;
    }
    if (k === 'down') {
      this.todoIdx = Math.min(todos.length - 1, this.todoIdx + 1);
      return;
    }
    if (k === 'enter' || k === ' ') {
      const t = todos[this.todoIdx];
      if (!t) return;
      t.done = !t.done;
      t.status = t.done ? 'completed' : 'pending';
      this._persistTodos();
      return;
    }
    if (k === 'x' || k === 'd') {
      todos.splice(this.todoIdx, 1);
      this._persistTodos();
      if (this.todoIdx >= todos.length) this.todoIdx = Math.max(0, todos.length - 1);
      return;
    }
  }

  _bodyTodo(cols, bodyRows) {
    const out = ['', p(C.bold, '  Todo')];
    const todos = this._todos();
    if (!todos.length) {
      out.push(p(C.dim, '  (no tasks yet)  /todo add <task>'));
      return out.slice(0, bodyRows);
    }
    const listRows = Math.max(3, bodyRows - out.length - 4);
    const win = windowedList(todos, this.todoIdx, listRows);
    win.items.forEach((t, i) => {
      const abs = win.start + i;
      const sel = abs === this.todoIdx;
      const isDone = t.done || t.status === 'completed';
      const mark = isDone ? p(C.green, '[x]') : t.status === 'in_progress' ? p(C.yellow, '[~]') : p(C.dim, '[ ]');
      const style = isDone ? C.gray : t.status === 'in_progress' ? C.bold : C.reset;
      // Satu todo = satu checkbox; baris lanjutan diberi indent, bukan mark lagi.
      const width = Math.max(10, cols - 8);
      wrap(sanitizeText(t.text == null ? '' : t.text), width).forEach((ln, li) => {
        out.push((li === 0 ? `  ${sel ? p(C.cyan, '►') : ' '} ${mark} ` : '        ') + p(style, ln));
      });
    });
    out.push('');
    out.push(p(C.dim, '  Enter toggle · x delete · ↑↓ select · q back'));
    return out.slice(0, bodyRows);
  }

  _permCmd(text) {
    const parts = text.split(/\s+/);
    const sub = (parts[1] || 'list').toLowerCase();
    const perms = this.agent.permissions();
    const persist = (patch) => {
      setPermissions(patch);
      this.agent.refresh();
    };
    if (sub === 'reset') {
      persist({ allow: DEFAULT_PERMISSIONS.allow.slice(), deny: DEFAULT_PERMISSIONS.deny.slice() });
      return this.push('info', 'Permission rules reset to defaults.');
    }
    if (sub === 'allow' || sub === 'deny') {
      const pattern = parts.slice(2).join(' ').trim();
      if (!pattern) return this.push('info', `Usage: /perm ${sub} <pattern>`);
      const list = (perms[sub] || []).slice();
      if (list.includes(pattern)) return this.push('info', `Already exists: ${pattern}`);
      list.push(pattern);
      persist(sub === 'allow' ? { allow: list } : { deny: list });
      return this.push('info', `Rule ${sub} added: ${pattern}`);
    }
    if (sub === 'rm' || sub === 'remove' || sub === 'del') {
      const scope = (parts[2] || '').toLowerCase();
      const n = parseInt(parts[3] || '', 10);
      if ((scope !== 'allow' && scope !== 'deny') || Number.isNaN(n)) {
        return this.push('info', 'Usage: /perm rm <allow|deny> <n>');
      }
      const list = (perms[scope] || []).slice();
      if (n < 1 || n > list.length) return this.push('info', 'Invalid number.');
      const removed = list.splice(n - 1, 1)[0];
      persist(scope === 'allow' ? { allow: list } : { deny: list });
      return this.push('info', `Rule removed: ${removed}`);
    }
    this.push('info', `Permission rules (global) — allow ${perms.allow.length}, deny ${perms.deny.length}:`);
    perms.allow.forEach((p, i) => this.push('info', `  allow ${i + 1}. ${p}`));
    perms.deny.forEach((p, i) => this.push('info', `  deny  ${i + 1}. ${p}`));
    if (this.agent.sessionAllow && this.agent.sessionAllow.length) {
      this.push('info', 'This session (temporary):');
      this.agent.sessionAllow.forEach((p) => this.push('info', `  + ${p}`));
    }
    this.push('info', 'Set: /perm allow <pattern> · /perm deny <pattern> · /perm rm <allow|deny> <n> · /perm reset');
  }

  _ruleCmd(text) {
    const parts = text.split(/\s+/);
    const sub = (parts[1] || 'list').toLowerCase();
    const arg = parts.slice(2).join(' ').trim();
    const agent = this.agent;
    if (sub === 'add') {
      if (!arg) return this.push('info', 'Usage: /rule add <text> — rule untuk SESI INI saja (otomatis hilang saat sesi berakhir)');
      agent.addSessionRule(arg);
      agent.invalidatePrompt?.();
      return this.push('info', `Rule sesi ditambahkan (${agent.sessionRules.length} total, SEMENTARA — auto-clear saat sesi berakhir): ${arg}`);
    }
    if (sub === 'rm' || sub === 'remove' || sub === 'del') {
      const n = parseInt(parts[2] || '', 10);
      const ok = agent.removeSessionRule(n);
      agent.invalidatePrompt?.();
      return this.push('info', ok ? `Rule sesi #${n} dihapus.` : `Rule sesi #${n} tidak ada.`);
    }
    if (sub === 'clear') {
      agent.clearSessionRules();
      agent.invalidatePrompt?.();
      return this.push('info', 'Semua rule sesi dibersihkan.');
    }
    const sr = Array.isArray(agent.sessionRules) ? agent.sessionRules : [];
    const core = (this.store && typeof this.store.rules === 'function' ? this.store.rules() : []) || [];
    if (!sr.length && !core.length) {
      return this.push('info', 'Belum ada rule. /rule add <text> (sementara, sesi ini) · rules inti permanen: buat file AGENTS.md / rules.md di project.');
    }
    if (sr.length) {
      this.push('info', `Rules sesi (SEMENTARA — ${sr.length} · auto-clear saat sesi berakhir · /rule rm <n> atau /rule clear):`);
      sr.forEach((r, i) => this.push('info', `  ${i + 1}. [sesi] ${r}`));
    }
    if (core.length) {
      this.push('info', `Rules inti (permanen — ${core.length}):`);
      core.forEach((r, i) => this.push('info', `  ${i + 1}. [inti] ${r.text}`));
    }
    this.push('info', 'Tambah sementara: /rule add <text> · hapus: /rule rm <n> / /rule clear');
  }

  _skillCmd(text) {
    const parts = text.split(/\s+/);
    const sub = (parts[1] || 'ls').toLowerCase();
    const name = parts[2] || '';
    const rest = parts.slice(3).join(' ').trim();
    if (!this.store) return this.push('info', 'Store unavailable.');
    const scfg = this.cfg().skills || { auto: true, max_active: 2, budget_chars: 1800, disabled: [] };
    const disabled = Array.isArray(scfg.disabled) ? scfg.disabled.slice() : [];
    if (sub === 'save') {
      if (!name || !rest) return this.push('info', 'Usage: /skill save <name> <instructions>');
      this.store.saveSkill(name, rest);
      return this.push('info', `Skill '${name}' saved (global).`);
    }
    if (sub === 'rm' || sub === 'remove' || sub === 'del') {
      const ok = this.store.removeSkill(name);
      return this.push('info', ok ? `Skill '${name}' removed.` : `Skill '${name}' not found.`);
    }
    const reg = this._regSkills();
    if (sub === 'auto') {
      const val = parts[2] === 'off' ? false : parts[2] === 'on' ? true : undefined;
      if (val === undefined) return this.push('info', 'Usage: /skill auto on|off');
      saveConfig({ skills: { ...scfg, auto: val } });
      return this.push('info', val ? '✓ Skill index di prompt: ON (AI bisa lihat & pilih skill)' : '✓ Skill index di prompt: OFF (AI tak lihat daftar skill)');
    }
    if (sub === 'on' || sub === 'off') {
      const found = reg.findById(name);
      if (!found) return this.push('info', `Skill registry '${name}' not found.`);
      const turnOn = sub === 'on';
      const next = disabled.filter((d) => d !== found.id);
      if (!turnOn) next.push(found.id);
      saveConfig({ skills: { ...scfg, disabled: next } });
      return this.push('info', turnOn ? `✓ Skill '${found.id}' enabled` : `Skill '${found.id}' disabled`);
    }
    if (sub === 'log') {
      const log = this.agent && this.agent.skillLog;
      if (!log || !log.length) return this.push('info', 'Belum ada aktivasi skill (log kosong).');
      log.slice(-10).forEach((e) =>
        this.push('info', `${new Date(e.at).toLocaleTimeString()} · [${e.ids.join(', ')}] ${(e.reasons || []).join('; ')} · ~${Math.round((e.chars || 0) / 4)} tok`)
      );
      return;
    }
    if (sub === 'use') {
      const s = this.store.skills().find((x) => x.name === name);
      if (s) {
        this.push('user', `Use skill ${name}`);
        this._runAI(`Use the following skill "${name}", then execute it as instructed:\n\n${s.body}`);
        return;
      }
      const body = reg.content(name);
      if (!body) {
        const hint = reg.list().join(', ');
        return this.push('info', `Skill '${name}' not found. Registry: ${hint || '(kosong)'}`);
      }
      this.push('user', `Use skill ${name}`);
      this._runAI(`Use the following skill "${name}", then execute it as instructed:\n\n${body}`);
      return;
    }
    // ls default
    this.push('info', `Skill registry (${reg.list().length} — index:${scfg.auto === false ? 'OFF' : 'ON'})`);
    const regIdx = reg.index({ disabled, maxChars: 100000 });
    if (regIdx) this.push('info', regIdx);
    const saved = this.store.skills();
    if (!saved.length) return;
    this.push('info', '—— Skill tersimpan (/skill save) ——');
    saved.forEach((s, i) => this.push('info', `${i + 1}. ${s.name}: ${s.body.replace(/\n/g, ' ').slice(0, 70)}`));
  }

  _regSkills() {
    if (!this._regSkillsMod) {
      try {
        this._regSkillsMod = require('./skills');
      } catch {
        this._regSkillsMod = { list: () => [], findById: () => null, content: () => null, index: () => null };
      }
    }
    return this._regSkillsMod;
  }

  _undoCmd() {
    if (!this.agent.vfs || typeof this.agent.vfs.popSnapshot !== 'function') {
      return this.push('info', 'Undo is not available in this session.');
    }
    const snap = this.agent.vfs.popSnapshot();
    if (!snap) return this.push('info', 'Nothing to roll back.');
    const n = this.agent.vfs.restoreSnapshot(snap);
    const pendingCount = this.agent.vfs.hasPending ? this.agent.vfs.pendingChanges().length : 0;
    const pendingNote = pendingCount ? ` Masih ada ${pendingCount} perubahan staged (belum nyata).` : '';
    if (snap.kind === 'workspace') {
      const skipped = Array.isArray(snap.skipped) ? snap.skipped.length : 0;
      const partial = snap.partial ? ` · partial undo: ${skipped}${skipped >= 100 ? '+' : ''} file(s) were too large to back up and left as-is` : '';
      this.push('info', `Shell effects rolled back (${n} files). Workspace restored to pre-command state${partial}.`);
      this.agent.addContextNote?.(
        'undo',
        `User menjalankan /undo: efek shell dibatalkan; ${n} file nyata dikembalikan ke kondisi sebelum perintah terakhir${snap.partial ? ' (undo parsial: file besar dilewati)' : ''}.${pendingNote}`
      );
    } else {
      this.agent.vfs.pushRedo(snap);
      this.push('info', `Rolled back ${n} changes (${snap.label}). Files restored. /redo to re-apply.`);
      this.agent.addContextNote?.(
        'undo',
        `User menjalankan /undo: ${n} perubahan yang sudah diterapkan dibatalkan dan file nyata dikembalikan ke snapshot "${snap.label}".${pendingNote}`
      );
    }
  }

  _redoCmd() {
    if (!this.agent.vfs || typeof this.agent.vfs.redoSnapshot !== 'function') {
      return this.push('info', 'Redo is not available in this session.');
    }
    const r = this.agent.vfs.redoSnapshot();
    if (!r || !r.n) {
      this.push('info', 'Nothing to redo. Change files → /apply → /undo → /redo.');
      return;
    }
    this.push('info', `Redone ${r.n} changes (${(r.snap && r.snap.label) || 're-applied'}). Files re-applied. /undo to roll back again.`);
    this.agent.addContextNote?.('undo', `User menjalankan /redo: ${r.n} perubahan diterapkan ulang ke file nyata.`);
  }

  // Attach satu gambar (vision). Terima path host, workspace ('/...'), file://,
  // '~', serta quote/spasi ter-escape. Return true kalau berhasil.
  _attachImageSpec(spec) {
    let clean = String(spec || '').trim().replace(/^["']|["']$/g, '').replace(/\\ /g, ' ');
    if (!clean) return false;
    if (clean.startsWith('file://')) clean = clean.slice(7);
    if (clean.startsWith('~')) clean = (process.env.HOME || process.env.USERPROFILE || '') + clean.slice(1);
    let real = clean;
    if (!fs.existsSync(real) && clean.startsWith('/') && this.agent && this.agent.vfs) {
      real = path.join(this.agent.vfs.root, clean.replace(/^\/+/, ''));
    }
    try {
      const st = fs.statSync(real);
      if (!st.isFile()) return false;
      const ext = path.extname(real).slice(1).toLowerCase();
      const mime =
        ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'bmp' ? 'image/bmp' : null;
      if (!mime) return false;
      if (st.size > 8 * 1024 * 1024) {
        this.push('error', `Image too large (>8MB): ${clean}`);
        return false;
      }
      const dataUrl = `data:${mime};base64,${fs.readFileSync(real).toString('base64')}`;
      this.pendingImages.push({ path: clean, name: path.basename(real), dataUrl });
      const n = this.pendingImages.length;
      this.push('info', `📎 Image attached: ${clean} (${Math.round(st.size / 1024)} KB)${n > 1 ? ` [${n} total]` : ''}. Sent with your next message (needs a vision-capable model).`);
      return true;
    } catch {
      return false;
    }
  }

  // Deteksi file yang di-drop/paste ke terminal (teks = path gambar) → attach.
  _tryAttachDropped(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.includes('\n')) return false;
    const unq = raw.replace(/^["']|["']$/g, '');
    if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(unq)) return false;
    const looksPath = /^["']?(\/|~|\.\/|\.\.\/|[A-Za-z]:[\\/])/.test(raw) || raw.startsWith('file://');
    if (!looksPath) return false;
    return this._attachImageSpec(raw);
  }

  // Attach gambar ke pesan berikutnya (model vision). Path host / workspace '/'.
  // Bisa banyak: /img a.png b.png. Drop/paste path file juga otomatis. /img cancel untuk bersihkan.
  _imgCmd(arg) {
    const spec = String(arg || '').trim();
    if (!spec) {
      if (this.pendingImages.length) {
        return this.push('info', `Attached (${this.pendingImages.length}): ${this.pendingImages.map((i) => i.path).join(', ')}. /img cancel to remove.`);
      }
      return this.push('info', 'Usage: /img <path...> — attach image(s) (needs a vision-capable model). Drop/paste a file path also works. /img cancel to clear.');
    }
    if (/^(cancel|clear)$/i.test(spec)) {
      this.pendingImages = [];
      return this.push('info', 'Image attachment(s) cleared.');
    }
    if (this._attachImageSpec(spec)) return;
    const parts = spec.split(/\s+/).filter(Boolean);
    let any = false;
    for (const p of parts) if (this._attachImageSpec(p)) any = true;
    if (!any) this.push('error', `Cannot attach image: ${spec} (cek path/format: png/jpg/gif/webp/bmp, max 8MB).`);
  }

  // Baca gambar dari clipboard OS → path file sementara (atau null).
  _clipboardImage() {
    const { execFileSync } = require('child_process');
    const os = require('os');
    const out = path.join(os.tmpdir(), `niyusha-paste-${Date.now()}.png`);
    const isWin = process.platform === 'win32' || !!process.env.WSL_DISTRO_NAME || !!process.env.WSL_INTEROP;
    try {
      if (isWin) {
        const ps =
          'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;' +
          '$img=[Windows.Forms.Clipboard]::GetImage();' +
          `if($img){$img.Save('${out.replace(/'/g, '\'\'')}',[System.Drawing.Imaging.ImageFormat]::Png);Write-Output 'OK'}` +
          'else{Write-Output \'NOIMG\'}';
        const exe = process.platform === 'win32' ? 'powershell' : 'powershell.exe';
        // windowsHide mencegah PowerShell 5.1 menempel ke console TUI dan
        // mengganti font/code page (layar mengecil + cursor muncul).
        const r = execFileSync(exe, ['-NoProfile', '-STA', '-Command', ps], {
          timeout: 8000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).toString();
        return /OK/.test(r) && fs.existsSync(out) ? out : null;
      }
      if (process.platform === 'darwin') {
        execFileSync('pngpaste', [out], { timeout: 8000 });
        return fs.existsSync(out) ? out : null;
      }
      for (const [cmd, args] of [['wl-paste', ['-t', 'image/png']], ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']]]) {
        try {
          const buf = execFileSync(cmd, args, { timeout: 8000 });
          if (buf && buf.length) {
            fs.writeFileSync(out, buf);
            return out;
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  // Baca teks dari clipboard OS (untuk path gambar yang disalin).
  _clipboardText() {
    const { execFileSync } = require('child_process');
    try {
      const isWin = process.platform === 'win32' || !!process.env.WSL_DISTRO_NAME || !!process.env.WSL_INTEROP;
      if (isWin) {
        const exe = process.platform === 'win32' ? 'powershell' : 'powershell.exe';
        // Base64 = output ASCII murni, jadi tidak perlu mengubah code page
        // (PowerShell 5.1 mengganti font console saat CP 65001 + output di-pipe).
        const ps = '$t=Get-Clipboard -Raw;if($null -eq $t){\'\'}else{[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))}';
        const b64 = execFileSync(exe, ['-NoProfile', '-Command', ps], {
          timeout: 5000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).toString('ascii').trim();
        return b64 ? Buffer.from(b64, 'base64').toString('utf8') : '';
      }
      if (process.platform === 'darwin') return execFileSync('pbpaste', [], { timeout: 5000 }).toString();
      try {
        return execFileSync('wl-paste', ['--no-newline'], { timeout: 5000 }).toString();
      } catch {
        return execFileSync('xclip', ['-selection', 'clipboard', '-o'], { timeout: 5000 }).toString();
      }
    } catch {
      return '';
    }
  }

  // Teks clipboard satu baris untuk input API key / filter model. Dipakai saat
  // terminal meneruskan Ctrl+V sebagai byte 0x16 (bukan bracketed paste).
  _clipboardPasteText() {
    return sanitizePasteText(String(this._clipboardText() || ''))
      .replace(/[\r\n]+/g, '')
      .trim();
  }

  // /paste (dan Ctrl+V bila diteruskan terminal): ambil gambar dari clipboard;
  // kalau hanya teks, tempel sebagai input (path gambar → langsung attach).
  _pasteCmd() {
    const img = this._clipboardImage();
    if (img) {
      const okAttach = this._attachImageSpec(img);
      try {
        fs.unlinkSync(img);
      } catch {}
      if (okAttach) {
        this.render();
        return;
      }
    }
    const txt = sanitizePasteText(String(this._clipboardText() || '').trim());
    if (txt) {
      if (this._tryAttachDropped(txt)) {
        this.render();
        return;
      }
      this._insertInput(txt);
      this.push('info', `📋 Pasted ${txt.length} chars from clipboard.`);
      this.render();
      return;
    }
    this.push('info', 'Clipboard kosong / tak ada gambar. Terminal mungkin tak mendukung — coba simpan gambar ke file lalu /img <path>.');
    this.render();
  }

  // Footer credit on sites scaffolded from Niyusha kits. Default OFF; turning
  // it ON shows a small "Made with NTVGraph × Niyusha" footer — much appreciated.
  _creditCmd(rest) {
    const a = String(rest || '').toLowerCase().trim();
    if (!a) {
      const on = this.cfg().credit === true;
      this.push('info', `Credit footer: ${on ? 'ON' : 'OFF'}.`);
      this.push('info', `When ON, sites scaffolded from Niyusha kits show a small "${CREDIT_TEXT}" footer — we would really appreciate it!`);
      this.push('info', 'Set with: /credit on  ·  /credit off  (default: off)');
      return;
    }
    if (a !== 'on' && a !== 'off') return this.push('info', 'Usage: /credit on|off');
    saveConfig({ credit: a === 'on' });
    this.push(
      'info',
      a === 'on'
        ? `✓ Credit footer ON — "${CREDIT_TEXT}" will appear on sites made with Niyusha kits. Thank you!`
        : 'Credit footer OFF.'
    );
  }

  // Scaffold situs BARU memakai kit gaya Niyusha (on-demand). File di-stage
  // lewat write_file AI, jadi masuk antrean approval seperti biasa.
  _kitCmd(rest) {
    let kits;
    try {
      kits = require('./kits');
    } catch {
      return this.push('info', 'Kit loader unavailable.');
    }
    const parts = String(rest || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      const list = kits.list();
      this.push('info', list.length ? `Niyusha kits: ${list.join(', ')}. Usage: /kit <kit> [project-name]` : 'No kits bundled.');
      return;
    }
    const kit = kits.findByName(parts[0]);
    if (!kit) return this.push('info', `Kit '${parts[0]}' not found. Available: ${kits.list().join(', ') || '(none)'}`);
    const project = parts[1] || 'site';
    const credit = this.cfg().credit === true;
    this._planReset();
    this.push('user', `/kit ${String(rest).trim()}`);
    this._runAI(
      `Create a NEW website from scratch for "${project}" using the Niyusha kit. ` +
        `First call use_skill '${kit.name}', then build the site (index.html + any needed assets) using the kit's tokens and rules. ` +
        'Deliver PRODUCTION QUALITY: complete sections (nav → hero with headline+subhead+CTAs+visual → features → stats → CTA → footer), ' +
        'strong type hierarchy, generous whitespace, at least one real visual (mockup/illustration/mesh+grain), responsive, dark/light. ' +
        'Write REAL product copy — do NOT include internal/dev labels (e.g. "// LANDING_v1", "no bloat", file names). ' +
        'Compose fresh — do NOT copy any template verbatim. Zero-dep. ' +
        (credit ? `Add a small footer "${CREDIT_TEXT}".` : 'Do NOT add any credit footer.') +
        ' Write files with write_file (they will be staged for review).'
    );
  }

  // ─── MCP (Model Context Protocol) ───
  // Bangun ulang manager dari config dan pasang ke agent (setelah add/rm/on/off).
  _mcpRebind() {
    try {
      this.mcp.stop();
    } catch {}
    this.mcp = new MCPManager(this.cfg().mcp || {});
    this.agent.mcp = this.mcp;
  }

  async _mcpCmd(rest) {
    const full = String(rest || '').trim();
    const sp = full.indexOf(' ');
    const sub = (sp === -1 ? full : full.slice(0, sp)).toLowerCase();
    const argstr = sp === -1 ? '' : full.slice(sp + 1).trim();
    const prettyY = p(C.green, '[y]');
    const prettyW = p(C.green + C.bold, '[w]');
    const prettyN = p(C.red, '[n/Esc]');
    switch (sub || 'ls') {
    case 'list':
    case 'ls': {
      await this.mcp.ready(argstr || undefined, 3000);
      this.push('result', this.mcp.describe(argstr || undefined));
      break;
    }
    case 'add': {
      const m = /^(\S+)\s+(.+)$/.exec(argstr);
      if (!m) {
        this.push('info', 'usage: /mcp add <name> <command [args...]> [--trusted] [--env K=V]');
        break;
      }
      const name = m[1];
      const tokens = m[2].split(/\s+/);
      const env = {};
      const parts = [];
      let trusted = false;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === '--trusted') trusted = true;
        else if (t === '--env' && tokens[i + 1]) {
          const kv = tokens[i + 1];
          const eq = kv.indexOf('=');
          if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
          i++;
        } else parts.push(t);
      }
      if (!parts.length) {
        this.push('info', 'command kosong.');
        break;
      }
      setMcp(name, { command: parts[0], args: parts.slice(1), env, trusted });
      this._mcpRebind();
      this.push('info', `MCP server '${name}' ditambahkan${trusted ? ' (trusted)' : ''}. Menghubungkan… (npx bisa download dulu).`);
      break;
    }
    case 'addurl': {
      const [name, url, ...flags] = argstr.split(/\s+/);
      if (!name || !url) {
        this.push('info', 'usage: /mcp addurl <name> <url> [--trusted]');
        break;
      }
      setMcp(name, { url, trusted: flags.includes('--trusted') });
      this._mcpRebind();
      this.push('info', `MCP server '${name}' (HTTP) ditambahkan.`);
      break;
    }
    case 'rm':
    case 'remove': {
      const name = argstr.trim();
      if (!name) { this.push('info', 'usage: /mcp rm <name>'); break; }
      removeMcp(name);
      this._mcpRebind();
      this.push('info', `MCP server '${name}' dihapus.`);
      break;
    }
    case 'on':
    case 'off': {
      const name = argstr.trim();
      if (!name) { this.push('info', `usage: /mcp ${sub} <name>`); break; }
      setMcp(name, { enabled: sub === 'on' });
      this._mcpRebind();
      this.push('info', `MCP server '${name}' ${sub === 'on' ? 'diaktifkan' : 'dinonaktifkan'}.`);
      break;
    }
    case 'trust': {
      const name = argstr.trim();
      if (!name) { this.push('info', 'usage: /mcp trust <name>'); break; }
      const cur = this.mcp.cfgFor(name) || {};
      const next = !cur.trusted;
      setMcp(name, { trusted: next });
      this._mcpRebind();
      this.push('info', `MCP server '${name}' trusted=${next}${next ? ' (panggilan tanpa konfirmasi)' : ''}.`);
      break;
    }
    case 'refresh': {
      this._mcpRebind();
      await this.mcp.ready(undefined, 3000);
      this.push('result', this.mcp.describe());
      break;
    }
    default:
      this.push(
        'info',
        '/mcp ls · add <name> <command [args]> [--trusted] [--env K=V] · addurl <name> <url> · rm <name> · on|off <name> · trust <name> · refresh' +
            `\n  Untrusted servers ask first: ${prettyY} allow session · ${prettyW} trust & save · ${prettyN} reject`
      );
    }
    this.render();
  }

  _saveSession() {
    if (!this.store) return this.push('info', 'Store unavailable.');
    const id = 's' + Date.now().toString(36);
    const msgs = this.transcript
      .filter((t) => t.type === 'user' || t.type === 'ai')
      .slice(-80)
      .map((t) => ({ role: t.type === 'user' ? 'user' : 'ai', text: t.text }));
    const root = this.agent.vfs.root;
    const staged = this.agent.vfs.pendingChanges();
    const note = readNote(root) || '';
    const bgs = (this.agent.backgroundPids || []).map((b) => ({ pid: b.pid, command: b.command }));
    this.store.saveSession(id, {
      ts: new Date().toISOString(),
      msgs,
      label: msgs[0] ? msgs[0].text.slice(0, 50) : '',
      todos: this._todos().map((t) => ({ text: t.text, done: !!t.done, status: t.status || (t.done ? 'completed' : 'pending') })),
      staged,
      note,
      bgs,
      usage: typeof this.agent.getSessionUsage === 'function' ? this.agent.getSessionUsage() : null,
      undo: !!this.agent.vfs.snapshots,
      summary: this.agent.summary || null,
      compactionSessionId: this.agent.compactionSessionId || null,
      goal: this.agent.goal || null,
      goalHistory: Array.isArray(this.agent.goalHistory) ? this.agent.goalHistory.slice() : [],
      goalLedger: Array.isArray(this.agent.goalLedger) ? this.agent.goalLedger.map((entry) => ({ ...entry })) : [],
      decisionLedger: Array.isArray(this.agent.decisionLedger) ? this.agent.decisionLedger.map((entry) => ({ ...entry })) : [],
      failures: Array.isArray(this.agent.failures) ? this.agent.failures.slice() : [],
      resolved: Array.isArray(this.agent.resolved) ? this.agent.resolved.slice() : [],
      evidence: Array.isArray(this.agent.evidence) ? this.agent.evidence.slice() : [],
      touchedFiles: this.agent.touchedFiles instanceof Set ? [...this.agent.touchedFiles] : (Array.isArray(this.agent.touchedFiles) ? this.agent.touchedFiles.slice() : []),
      contextNotes: Array.isArray(this.agent.contextNotes) ? this.agent.contextNotes.slice() : [],
    });
    this.push('info', `Session saved: ${id}${staged.length ? ` (${staged.length} staged)` : ''}${note ? ' · note saved' : ''}. /load ${id} to continue.`);
  }

  _listSessions() {
    if (!this.store) return this.push('info', 'Store unavailable.');
    const list = this.store.listSessions();
    if (!list.length) return this.push('info', 'No saved sessions yet.');
    list.forEach((s) => this.push('info', `${s.id} · ${s.ts.slice(0, 16)} · ${s.label || ''}`));
  }

  // ─── Interactive session picker (`/sessions`) ───
  _openSessions() {
    if (!this.store) return this.push('info', 'Store unavailable.');
    this._refreshSessions();
    this.sessionIdx = 0;
    this.mode = 'sessions';
    this.render();
  }

  // Daftar sesi terbaru dulu (reverse dari urutan simpan).
  _refreshSessions() {
    if (!this.store) return;
    this.sessionItems = this.store.listSessions().slice().reverse();
    if (this.sessionIdx >= this.sessionItems.length) this.sessionIdx = Math.max(0, this.sessionItems.length - 1);
  }

  _handleSessions(key) {
    const k = typeof key === 'string' ? key : (key && key.ch) || '';
    if (k === 'esc' || k === 'q') {
      this.mode = 'chat';
      return;
    }
    const list = this.sessionItems;
    if (k === 'up') {
      this.sessionIdx = Math.max(0, this.sessionIdx - 1);
      return;
    }
    if (k === 'down') {
      this.sessionIdx = Math.min(list.length - 1, this.sessionIdx + 1);
      return;
    }
    if (k === 'n') {
      this._newSession();
      return;
    }
    if (k === 's') {
      this._saveSession();
      this._refreshSessions();
      return;
    }
    if (k === 'd') {
      const s = list[this.sessionIdx];
      if (!s) return;
      if (this.store.removeSession(s.id)) this.push('info', `Deleted session ${s.id}.`);
      this._refreshSessions();
      return;
    }
    if (k === 'enter' || k === ' ') {
      const s = list[this.sessionIdx];
      if (!s) return;
      this.mode = 'chat';
      this._loadSession(s.id);
      return;
    }
  }

  _bodySessions(cols, bodyRows) {
    const out = ['', p(C.bold, '  Saved Sessions'), ''];
    const list = this.sessionItems || [];
    if (!list.length) {
      out.push(p(C.dim, '  (no saved sessions yet)'));
      out.push('');
      out.push(p(C.dim, '  n new · s save current · q back'));
      out.push(p(C.dim, '  import/export: /sessions export <id> [file] · /sessions import <file>'));
      return out.slice(0, bodyRows);
    }
    const cur = this.shell.sessionId;
    const listRows = Math.max(3, bodyRows - out.length - 4);
    const win = windowedList(list, this.sessionIdx, listRows);
    win.items.forEach((s, i) => {
      const abs = win.start + i;
      const sel = abs === this.sessionIdx;
      const isCur = s.id === cur;
      const n = (s.msgs || []).length;
      const staged = (s.staged || []).length;
      const st = this._usageTokens(s.usage);
      const tk = s.usage && Number(s.usage.total) ? ` · ${s.usage.estimated ? '≈' : ''}${fmtTok(st.equivalent)} tokens` : '';
      const label = sanitizeText(String(s.label || '(empty)')).slice(0, Math.max(8, cols - 44));
      const meta = p(C.dim, ` · ${n} msgs${staged ? ` · ${staged} staged` : ''}${tk}`);
      out.push(
        `  ${sel ? p(C.cyan, '►') : ' '} ${p(C.heading, s.id)} ${p(C.dim, (s.ts || '').slice(0, 16))} ${p(C.reset, label)}${meta}${isCur ? p(C.green, ' ✓ current') : ''}`
      );
    });
    out.push('');
    out.push(p(C.dim, `  Enter load · n new · s save current · d delete · ↑↓ select · q back  (${list.length})`));
    out.push(p(C.dim, '  import/export: /sessions export <id|all> [file] · /sessions import <file>'));
    return out.slice(0, bodyRows);
  }

  // ─── Import/export sesi lintas-workspace ───
  _resolveSessionFile(file) {
    const f = String(file || '').trim();
    const base = (this.shell && this.shell.cwd) || (this.agent && this.agent.vfs && this.agent.vfs.root) || process.cwd();
    return path.isAbsolute(f) ? f : path.resolve(base, f);
  }

  _sessionExport(rest) {
    if (!this.store) return this.push('info', 'Store unavailable.');
    const tokens = String(rest || '').trim().split(/\s+/).filter(Boolean);
    let ids = null;
    let file;
    if (!tokens.length) {
      file = 'niyusha-sessions-export.json';
    } else if (tokens[0].toLowerCase() === 'all') {
      file = tokens[1] || 'niyusha-sessions-export.json';
    } else {
      ids = [tokens[0]];
      file = tokens[1] || `niyusha-session-${tokens[0]}.json`;
    }
    const full = this._resolveSessionFile(file);
    try {
      const n = this.store.exportSessions(full, ids);
      if (!n) return this.push('info', 'Nothing to export (session not found?).');
      this.push('info', `Exported ${n} session(s) → ${full}`);
    } catch (e) {
      this.push('error', `Export failed: ${e.message}`);
    }
    this.render();
  }

  _sessionImport(file) {
    if (!this.store) return this.push('info', 'Store unavailable.');
    if (!String(file || '').trim()) return this.push('info', 'Usage: /sessions import <file.json>');
    const full = this._resolveSessionFile(file);
    try {
      const n = this.store.importSessions(full);
      this.push('info', n ? `Imported ${n} session(s) from ${full}. /sessions to open.` : `No valid sessions found in ${full}.`);
      if (this.mode === 'sessions') this._refreshSessions();
    } catch (e) {
      this.push('error', `Import failed: ${e.message}`);
    }
    this.render();
  }

  _restoreState(s, tag) {
    this.transcript = [];
    this._invalidateChat();
    this._ctxCache = null;
    this._ctxInfoCache = null;
    this.scroll = 0;
    this.awaitingApproval = false;
    this._setInput('');
    this.agent.vfs.overlay.clear();
    for (const m of s.msgs || []) {
      if (m.role === 'user') this.push('user', m.text);
      else this._pushAnswer(m.text);
    }
    if (this.agent) {
      // Reset penuh: state dari sesi sebelumnya tidak boleh ikut masuk ke
      // prompt sesi yang dimuat. Summary milik sesi yang dimuat dipulihkan
      // eksplisit di bawah agar konteks hasil kompaksi tidak hilang.
      this.agent.reset();
      this.agent.history = (s.msgs || []).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));
      this.agent.summary = typeof s.summary === 'string' && s.summary.trim() ? s.summary : null;
      if (s.compactionSessionId) this.agent.compactionSessionId = String(s.compactionSessionId);
      this.agent.goal = typeof s.goal === 'string' && s.goal.trim() ? s.goal : null;
      this.agent.goalHistory = Array.isArray(s.goalHistory) ? s.goalHistory.slice() : [];
      this.agent.goalLedger = Array.isArray(s.goalLedger) ? s.goalLedger.slice() : (this.agent.goal ? [{ text: this.agent.goal, status: 'active', source: 'restored-session', createdAt: null, endedAt: null }] : []);
      this.agent.decisionLedger = Array.isArray(s.decisionLedger) ? s.decisionLedger.slice() : [];
      this.agent.failures = Array.isArray(s.failures) ? s.failures.slice() : [];
      this.agent.resolved = Array.isArray(s.resolved) ? s.resolved.slice() : [];
      this.agent.evidence = Array.isArray(s.evidence) ? s.evidence.slice() : [];
      this.agent.touchedFiles = new Set(Array.isArray(s.touchedFiles) ? s.touchedFiles : []);
      this.agent.contextNotes = Array.isArray(s.contextNotes) ? s.contextNotes.slice() : [];
      // Akumulasi token sesi ikut dipulihkan; sesi lama tanpa data = nol.
      if (typeof this.agent.setSessionUsage === 'function') this.agent.setSessionUsage(s.usage || null);
      this.agent.backgroundPids = Array.isArray(s.bgs) ? s.bgs : [];
    }
    const restored = this.agent.vfs.restorePending(s.staged || []);
    const todos = s.todos || [];
    // Restore harus mengganti daftar, bukan menambah/mempertahankan todo lama.
    this._replaceTodos(todos);
    if (s.note) saveNote(this.agent.vfs.root, s.note);
    const extra = [];
    if (restored) extra.push(`${restored} file staged`);
    if (todos.length) extra.push(`${todos.length} todo`);
    if (s.note) extra.push('note');
    if (s.usage && Number(s.usage.total))
      extra.push(`${s.usage.estimated ? '≈' : ''}${fmtTok(this._usageTokens(s.usage).equivalent)} tokens`);
    this.push('info', `${tag} (${(s.msgs || []).length} msgs${extra.length ? ' · ' + extra.join(', ') : ''}). /diff to review staged.`);
  }

  _loadSession(id) {
    if (!this.store) return this.push('info', 'Store unavailable.');
    const s = this.store.loadSession(id);
    if (!s) return this.push('info', `Session '${id}' not found.`);
    this._endSessionRules();
    this._pushRecentSession(id);
    this.shell.sessionId = id;
    this._restoreState(s, `Session ${id} loaded`);
  }

  _resumeCmd() {
    if (!this.agent) return;
    const s = readAutosave(this.agent.vfs.root);
    if (!s || !(s.msgs || []).length) return this.push('info', 'No last session saved (autosave).');
    this._endSessionRules();
    this._planReset();
    this._restoreState(s, 'Last session resumed (autosave)');
  }

  _setCmd(rest) {
    const m = /^([a-z]+)\s+(.+)$/i.exec(rest);
    if (!m) return this.push('info', 'Usage: /set <temperature|maxtokens|streaming|timeout|retries|retrybasems|autocontinue|cacheratio|showcost|runjail|runundo|banner|icon> <value>');
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    const allow = { temperature: 1, maxtokens: 1, streaming: 2, timeout: 1, retries: 1, retrybasems: 1, autocontinue: 1, cacheratio: 1, showcost: 2, runjail: 2, runundo: 2, banner: 2, icon: 3 };
    if (!allow[key]) return this.push('info', `Unknown key: ${key}. Allowed: ${Object.keys(allow).join(', ')}`);
    let patch;
    const boolMap = { streaming: 'streaming', showcost: 'showCost', runjail: 'runJail', runundo: 'runUndo', banner: 'banner' };
    if (key === 'icon') {
      const icon = val.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(CHAT_ICONS, icon)) {
        return this.push('info', `icon: ${Object.keys(CHAT_ICONS).join(' | ')}`);
      }
      patch = { icon };
    } else if (boolMap[key]) {
      if (!/^(on|off|true|false|1|0|yes|no)$/i.test(val)) return this.push('info', `${key}: on/off`);
      const on = /^(on|true|1|yes)$/i.test(val);
      patch = { [boolMap[key]]: on };
    } else {
      const n = Number(val);
      if (!Number.isFinite(n)) return this.push('info', `value must be a number for ${key}`);
      if (key === 'temperature' && (n < 0 || n > 2)) return this.push('info', 'temperature 0-2');
      if (key === 'maxtokens' && (n < 1 || n > 100000)) return this.push('info', 'maxtokens 1-100000');
      if (key === 'retries' && (n < 0 || n > 10)) return this.push('info', 'retries 0-10');
      if (key === 'cacheratio' && (n < 0 || n > 1)) return this.push('info', 'cacheratio 0-1 (mis. 0.1 = 10%)');
      const map2 = { temperature: 'temperature', maxtokens: 'maxTokens', timeout: 'timeoutMs', retries: 'retries', retrybasems: 'retryBaseMs', autocontinue: 'autoContinue', cacheratio: 'cacheReadRatio' };
      patch = { [map2[key]]: n };
    }
    saveConfig(patch);
    this.agent.refresh();
    const bv = patch.streaming != null ? patch.streaming : patch.showCost != null ? patch.showCost : patch.runJail != null ? patch.runJail : patch.runUndo;
    this.push('info', `✓ ${key} = ${bv != null ? (bv ? 'on' : 'off') : val}.`);
  }

  _logsCmd() {
    const logs = readLogs(25);
    if (!logs.length) return this.push('info', 'No logs yet.');
    for (const l of logs) this.push('info', `  ${(l.ts || '').slice(11, 19)} ${String(l.msg || '').slice(0, 120)}`);
  }

  _usageCmd() {
    const su = this._sessionUsage();
    const info = this._contextInfo();
    const pct = Math.max(0, Math.min(100, Math.round((info.budget ? info.used / info.budget : 0) * 100)));
    const t = this._usageTokens(su);
    const cache = t.cacheRead ? ` · cache-read ${fmtTok(t.cacheRead)} (included in input)` : '';
    this.push('info', `Session · ${su.requests} recorded req${su.estimated ? ` (${su.estimated} estimated)` : ''} cumulative; includes compaction/sub-agent calls, not current context`);
    if (su.requests) {
      this.push('info', `  ${su.estimated ? '≈' : ''}${fmtTok(t.equivalent)} in+out tokens${su.estimated ? ' (estimated requests included)' : ' (provider-reported)'}`);
      this.push('info', `  input ${fmtTok(t.prompt)}${cache} · output ${fmtTok(t.completion)}`);
    } else {
      this.push('info', '  no requests yet');
    }
    this.push('info', `  current context estimate ≈${fmtTok(info.used)} / ${fmtTok(info.budget)} (${pct}%) · window ${fmtTok(info.window || 0)}`);
    this.push('info', '  Context is an estimate; provider tokenization and current prompt may differ.');
    const lastUsage = this.agent && this.agent.usage;
    if (lastUsage && Number.isFinite(lastUsage.prompt)) {
      this.push('info', `  last tracked request input: ${fmtTok(lastUsage.prompt)} provider-reported tokens`);
    }
    const cs = this.agent && typeof this.agent.compactionStats === 'function' ? this.agent.compactionStats() : null;
    if (cs) {
      this.push('info', `  compaction: mode=${cs.mode} · ${cs.compactions}x total (${cs.autoCompactions} auto) · trigger=${cs.lastTrigger || '-'} · ${cs.beforeTokens != null ? cs.beforeTokens : '-'} → ${cs.afterTokens != null ? cs.afterTokens : '-'} tok`);
    }
    if (this.cfg().showCost) {
      const cost = this._sessionCost(su);
      this.push('info', cost == null ? '  estimated cost n/a' : `  estimated cost ~ $${cost.toFixed(5)} (public-rate approximation)`);
    }
    this.render();
  }

  _compactionResultText(trigger, st) {
    const ag = this.agent;
    const count = (st && st.compactions) || (ag && ag.compactions) || 1;
    const mode = (st && st.mode) || (ag && ag.compactionMode) || '?';
    const before = st && st.beforeTokens != null ? st.beforeTokens : '?';
    const after = st && st.afterTokens != null ? st.afterTokens : '?';
    const summary = String((ag && ag.summary) || '').trim();
    let lang = 'id';
    try {
      const ce = require('./context-engine');
      const hist = (ag && ag.history) || [];
      let lastUser = '';
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i] && hist[i].role === 'user' && typeof hist[i].content === 'string') { lastUser = hist[i].content; break; }
      }

      if (!lastUser) {
        const u = (this.transcript || []).filter((t) => t.type === 'user').slice(-1)[0];
        if (u) lastUser = u.text || '';
      }
      const hint = ce.detectLanguageHint(lastUser);
      if (hint === 'en') lang = 'en';
      else if (hint === 'id' || hint === 'und') lang = 'id';
      else lang = 'en';
    } catch {}
    const T = lang === 'en' ? {
      title: 'Compaction successful',
      header: 'COMPACTION #' + count,
      body: 'Conversation context has been compacted.',
      summaryLabel: 'Active context summary:',
      noSummary: '- (summary unavailable)',
      footer: 'System message - Not a regular conversation',
    } : {
      title: 'Compaction berhasil',
      header: 'COMPACTION #' + count,
      body: 'Konteks percakapan berhasil dipadatkan.',
      summaryLabel: 'Ringkasan konteks aktif:',
      noSummary: '- (ringkasan tidak tersedia)',
      footer: 'Pesan sistem - Bukan percakapan biasa',
    };
    const lines = [
      T.title,
      '',
      T.header,
      '',
      T.body,
      '',
      T.summaryLabel,
    ];
    if (summary) {
      for (const line of summary.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) lines.push('- ' + trimmed);
      }
    } else {
      lines.push(T.noSummary);
    }
    lines.push('');
    lines.push('mode=' + mode + ' - trigger=' + (trigger || '-') + ' - ' + before + ' -> ' + after + ' tok');
    lines.push('');
    lines.push(T.footer);
    return lines.join('\n');
  }

  _compactionNoResultText(stats) {
    const outcome = stats && stats.outcome;
    if (!outcome || outcome.status === 'skipped') {
      if (stats && stats.mode === 'off') return 'Compaction skipped: compaction is disabled.';
      return 'Compaction skipped: context is below the 45% auto-compaction threshold.';
    }
    if (outcome.status === 'validation_failed') {
      return `Compaction guard: validation failed — ${outcome.reason || 'required context was not preserved'}. Active history was kept unchanged.`;
    }
    if (outcome.status === 'failed') {
      return `Compaction failed — ${outcome.reason || 'no valid compaction result was produced'}. Active history was kept unchanged.`;
    }
    return `Compaction did not complete (${outcome.status || 'unknown'}). Active history was kept unchanged.`;
  }

  _syncCompactionNotices() {
    const ag = this.agent;
    if (!ag) return;
    const at = ag.lastCompactionAt || 0;
    if (!at || at === this._lastCompactionAt) return;
    this._lastCompactionAt = at;
    const st = typeof ag.compactionStats === 'function' ? ag.compactionStats() : null;
    const trig = (st && st.lastTrigger) || 'auto';
    if (trig === 'manual') return;
    const text = this._compactionResultText(trig, st);
    this._pushTypedCompactionLines(text.split('\n'));
  }

  _pushTypedCompactionLines(lines) {
    const delay = 28;
    lines.forEach((line, i) => {
      setTimeout(() => {
        if (this.closed) return;
        this.push('info', line);
        const last = this.transcript && this.transcript.length ? this.transcript[this.transcript.length - 1] : null;
        if (last) last.compaction = true;
        this.render();
      }, i * delay);
    });
  }

  _syncCompactionLive() {
    const comp = this.agent && this.agent.lastCompactionOutcome;
    if (!comp || comp.status !== 'running') {
      this.compactionLive = null;
      return null;
    }
    const prog = comp.progress || null;
    const startedAt = Date.parse(comp.at || '') || Date.now();
    const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const rawTimeout = this.agent && this.agent.config ? this.agent.config.compactionAiTimeoutMs : 30000;
    const timeoutSec = Math.max(3, Math.round((Number(rawTimeout) || 30000) / 1000));
    const phase = prog ? (prog.label || prog.phase) : 'preparing';
    let detail = 'Menyiapkan kompaksi...';
    if (prog && prog.phase === 'atoms') {
      detail = `AI meringkas atom${prog.total ? ` ${prog.current}/${prog.total}` : ''}; fallback lokal setelah ${timeoutSec}s.`;
    } else if (prog && prog.phase === 'compress') {
      detail = 'Menyusun ringkasan lokal (cepat)...';
    } else if (prog && prog.phase === 'memory') {
      detail = 'Menyimpan & menyusun memori URich...';
    } else if (prog && prog.phase === 'validate') {
      detail = 'Memvalidasi hasil kompaksi...';
    }
    this.compactionLive = {
      phase,
      current: prog ? prog.current : 0,
      total: prog ? prog.total : 0,
      elapsed,
      detail,
    };
    return prog;
  }

  _contextInfo() {
    const ag = this.agent;
    const hist = (ag && ag.history) || [];
    const last = hist[hist.length - 1] || {};
    const usage = (ag && ag.usage) || {};
    const cfg = this.cfg();
    const key = [
      hist.length,
      typeof last.content === 'string' ? last.content.length : 0,
      last.tool_calls ? last.tool_calls.length : 0,
      ag && ag.summary ? 1 : 0,
      ag && ag.compactions ? ag.compactions : 0,
      usage.prompt,
      usage.baseChars,
      ag && ag._lastRetrievalResult ? ag._lastRetrievalResult.length : 0,
      ag && ag.planMode ? 1 : 0,
      ag && ag.goal ? ag.goal.length : 0,
      ag && ag.evidence ? ag.evidence.length : 0,
      ag && ag.failures ? ag.failures.length : 0,
      ag && ag.resolved ? ag.resolved.length : 0,
      ag && typeof ag._rulesCache === 'string' ? ag._rulesCache.length : 0,
      cfg.provider,
      cfg.model,
      ag && ag.tools ? ag.tools.length : 0,
    ].join('|');
    if (this._ctxInfoCache && this._ctxInfoCache.key === key) return this._ctxInfoCache.value;
    if (ag && typeof ag.contextTokens === 'function') {
      try {
        const value = ag.contextTokens();
        this._ctxInfoCache = { key, value };
        return value;
      } catch {}
    }
    const toolChars = (() => {
      try {
        return JSON.stringify((ag && (ag.tools || ag.allTools)) || []).length;
      } catch {
        return 0;
      }
    })();
    const chars =
      (SYSTEM_PROMPT || '').length + 4 +
      toolChars +
      hist.reduce((sum, m) => {
        let c = 4;
        if (typeof m.content === 'string') c += m.content.length;
        if (m.tool_calls) { try { c += JSON.stringify(m.tool_calls).length; } catch {} }
        return sum + c;
      }, 0) +
      String((ag && ag._lastRetrievalResult) || '').length;
    const used = Math.max(1, Math.ceil(chars / 4));
    const budget = contextBudget(cfg);
    const value = {
      used,
      budget,
      window: contextWindow(cfg.provider, cfg.model),
      msgs: hist.filter((m) => m.role === 'user').length,
      source: 'character-estimate',
      real: false,
    };
    this._ctxInfoCache = { key, value };
    return value;
  }

  _sessionUsage() {
    const ag = this.agent;
    if (ag && typeof ag.getSessionUsage === 'function') return ag.getSessionUsage();
    return { prompt: 0, completion: 0, total: 0, requests: 0, estimated: 0, startedAt: null, at: null };
  }

  _cacheRatio() {
    const r = Number(this.cfg().cacheReadRatio);
    return Number.isFinite(r) && r >= 0 ? r : 0.1;
  }

  _usageTokens(su) {
    const prompt = Math.max(0, Number(su && su.prompt) || 0);
    const cacheRead = Math.max(0, Number(su && su.cacheRead) || 0);
    const cacheWrite = Math.max(0, Number(su && su.cacheWrite) || 0);
    const completion = Math.max(0, Number(su && su.completion) || 0);
    const fresh = Math.max(0, prompt - cacheRead);
    // This is a token count, not a monetary bill. Cache tokens are a subset of input.
    const equivalent = prompt + completion;
    return { prompt, cacheRead, cacheWrite, completion, fresh, equivalent };
  }

  _sessionCost(su) {
    const c = unitCost(this.cfg().provider);
    if (!c) return null;
    // Estimate with public per-provider rates; cache pricing, discounts, and
    // provider billing details may differ.
    const promptIn = Math.max(0, Number(su && su.prompt) || 0);
    const completionOut = Math.max(0, Number(su && su.completion) || 0);
    return (promptIn * c.in + completionOut * c.out) / 1e6;
  }

  _histChars() {
    try {
      return JSON.stringify(this.agent.history || []).length;
    } catch {
      return 0;
    }
  }

  async _runAI(text) {
    const cfg = this.cfg();
    if ((cfg.providerInfo ? cfg.providerInfo.requiredKey : true) && !cfg.apiKey) {
      this.push('error', 'No AI provider configured yet. Press /s to set provider and /p to choose model (or /help).');
      this.render();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.scroll = 0; // selalu tampilkan turn terbaru di bawah
    this.selection = null;
    if (this._spinTimer) clearInterval(this._spinTimer);
    this._spinTimer = setInterval(() => {
      if (this.closed) return;
      this._syncCompactionNotices();
      const prog = this._syncCompactionLive();
      const progText = prog
        ? (prog.total ? ` · ${prog.label || prog.phase} ${prog.current}/${prog.total}` : ` · ${prog.label || prog.phase}`)
        : '';
      if (this.compactionLive) {
        this.status = `compacting context...${progText}`;
      } else if (typeof this.status === 'string' && this.status.startsWith('compacting context...')) {
        this.status = `thinking (${sanitizeText(this.cfg().model)})${this.planning ? ' · 📐 PLAN' : ''}`;
      }
      this.render();
    }, 220);
    this.abortCtrl = new AbortController();
    this.status = `thinking (${sanitizeText(cfg.model)})${this.planning ? ' · 📐 PLAN' : ''}`;
    this.agent.permission = (req) => this._askPerm(req);
    this.render();
    this.agent.refresh();
    this.live = { text: '', reasoning: '' };
    this.liveRenderAt = 0;
    const runStart = Date.now();
    try {
      const answer = await this.agent.run(text, {
        uiMode: this.relaxMode ? 'relax' : 'normal',
        signal: this.abortCtrl.signal,
        onApproval: (changes) => this._askApproval(changes),
        onSafePoint: () => this._injectQueuedAtSafePoint(),
        onRetry: (info) => {
          // Stream yang gagal di tengah sudah memancarkan sebagian delta ke
          // live; attempt ulang men-stream dari awal → reset akumulator supaya
          // teks tidak tampil dobel (final answer tetap dari return value).
          if (this.live) {
            this.live.text = '';
            this.live.reasoning = '';
          }
          this.status = `retry ${info.attempt}/${info.max} · ${(info.delayMs / 1000).toFixed(1)}s`;
          this.push('info', `⟳ failed (${info.status || 'network'}) — retry ${info.attempt}/${info.max} in ${(info.delayMs / 1000).toFixed(1)}s`);
          this.render();
        },
        onTool: (name, args) => {
          if (name === 'assistant' && args.text) {
            // Teks antara sebelum tool call (temuan sementara) tetap disimpan.
            // Sebelumnya event ini dibuang dan live.text dihapus saat tool
            // berjalan → informasi penting hilang dari layar.
            const interim = String(args.text).trim();
            if (interim) {
              this._pushAnswer(interim);
              if (this.live) this.live.text = '';
              this.render();
            }
            return;
          }
          if (name === 'reasoning') {
            // Reasoning ronde ini dikomit jadi entri transkrip permanen.
            // Salinan live-nya harus DIBUANG supaya tidak ada kotak duplikat
            // (satu dari transkrip, satu lagi dari live) yang digambar berdua.
            if (args.text) this.push('reasoning', args.text);
            if (this.live) this.live.reasoning = '';
            this.render();
            return;
          }
          if (name === 'continue') {
            this.push('info', `↻ ${args.text}`);
            return;
          }
          if (name === 'permission') {
            const tag = args.decision === 'allow' ? p(C.green, 'auto allow') : args.decision === 'deny' ? p(C.red, 'blocked') : p(C.yellow, 'ask');
            const details = [
              args.shell && `shell: ${args.shell}`,
              args.cwd && `cwd: ${args.cwd}`,
              args.background ? 'mode: background' : 'mode: foreground',
              args.timeout && `timeout: ${Math.ceil(args.timeout / 1000)}s`,
            ].filter(Boolean);
            this.push('info', `⛨ ${tag} · ${String(args.command || '')}${args.reason ? ` — ${args.reason}` : ''}${details.length ? `\n  ${details.join(' · ')}` : ''}`);
            return;
          }
          if (name === 'approval') {
            const n = args.count || 0;
            const verb = args.decision === 'reject' ? 'rejected' : this.autoApply ? 'auto-applied' : 'approved';
            const mark = args.decision === 'reject' ? '\u2717' : '\u2713';
            this.push('info', `${mark} ${verb}: ${n} changes ${args.decision === 'reject' ? 'discarded' : 'applied'}`);
            this.render();
            return;
          }
          if (name === 'subagent') {
            const role = args.role || 'explore';
            this.push('info', `↳ 🧠 sub-agent [${role}]${args.text && args.text !== role ? ' · ' + args.text : ''} — live steps:`);
            if (this.live) this.live.text = '';
            this.render();
            return;
          }
          if (name === 'subtool') {
            if (this.live) this.live.text = '';
            this.push('tool', `◆ ${toolDisplayLine(args.name, args.args)}`);
            this.render();
            return;
          }
          if (name === 'write_note') {
            const s = String(args.content || '').slice(0, 120);
            this.push('note', `📝 Catatan disimpan: ${s}`);
            this.render();
            return;
          }
          if (name === 'read_note') {
            this.push('note', '📖 Membaca catatan');
            this.render();
            return;
          }
          if (name === 'result') {
            this.currentAction = 'Standby';
            const first = String(args.text).split('\n')[0].slice(0, 160);
            this.push('result', first);
          } else {
            // Ronde ini punya tool_calls → teks yang sempat di-stream hanyalah
            // teks antara (diabaikan di transkrip). Bersihkan live.text agar
            // sisa ronde sebelumnya tidak menumpuk di dasar layar.
            if (this.live) this.live.text = '';
            this.push('tool', toolDisplayLine(name, args));
            this.currentAction = ACTION_BY_TOOL[name] || (name === 'task' ? 'thinking' : this.currentAction);
            const brief = toolSummary(name, args);
            const summary = brief != null && brief ? brief : String(args.command || args.path || args.text || '');
            this.toolLog.push({ name, summary: oneLineArg(summary, 72), ts: Date.now() });
            if (this.toolLog.length > 30) this.toolLog.shift();
          }
          this.render();
        },
        onDelta: (d) => {
          if (!this.live) return;
          if (d.text || d.reasoning) this.currentAction = 'thinking';
          if (d.text) this.live.text += d.text;
          if (d.reasoning) this.live.reasoning += d.reasoning;
          const now = Date.now();
          if (now - this.liveRenderAt > 33) {
            this.liveRenderAt = now;
            this.render();
          }
        },
      });
      this.live = null;
      this.lastAnswer = answer ? String(answer) : '';
      if (answer) this._pushAnswer(answer);
      const dt = Date.now() - runStart;
      this.push('info', fmtLatency(dt));
      this._lastLatency = dt;
       this._syncCompactionNotices();
       this.render();
       if (this.cfg().notify !== false && dt >= 15000) notify('Niyusha selesai', `Jawaban dalam ${fmtLatency(dt)}`);
      if (this.cfg().sound === true) playSound(this.cfg().soundKind || 'bell');
    } catch (e) {
      if (this.live && this.live.text) this._pushAnswer(this.live.text);
      this.live = null;
      if (e && (e.isUserAbort || e.name === 'AbortError')) {
        this.push('info', '⛔ stopped by user.');
      } else {
        appendLog(`[run] ${String(e && e.message || e)}`);
        this.push('error', e.message);
      }
    }
    this.compactionLive = null;
    this.busy = false;
    this.currentAction = null;
    this.abortCtrl = null;
    this.status = '';
    if (this._spinTimer) {
      clearInterval(this._spinTimer);
      this._spinTimer = null;
    }
    this._afterRun();
    this.render();
    this._autosaveMaybe();
    if (this.mode === 'chat') this._drainQueue();
  }

  _askPerm(req) {
    this.permReq = req;
    this.permBuf = '';
    this.awaitingPermission = true;
    const wordHint = ` — or type ${p(C.heading, '"ok" / "ya"')} / ${p(C.heading, '"no"')}`;
    if (req.type === 'skill') {
      this.push('info', `🧠 Permission needed to save skill '${String(req.id || '')}' (${String(req.reason || '')}):`);
      if (req.diff && req.diff.length) {
        const text = req.diff.length > 12000 ? req.diff.slice(0, 12000) + '\n⋯ (diff truncated)' : req.diff;
        this.transcript.push({ type: 'code', lang: 'diff', text });
      }
      this.push('info', `  choose: ${p(C.green, '[y]')} save skill · ${p(C.red, '[n/Esc]')} reject${wordHint}`);
      this.scroll = 0;
      this.render();
      return new Promise((resolve) => {
        this.permResolve = resolve;
      });
    }
    if (req.type === 'mcp') {
      this.push('info', `🔌 Izin diperlukan untuk mengirim panggilan ke server MCP eksternal "${String(req.server || '')}.${String(req.tool || '')}".`);
      if (req.reason) this.push('info', `  reason: ${req.reason}`);
      if (req.arguments !== undefined) {
        let argsText;
        try {
          argsText = JSON.stringify(req.arguments, null, 2);
        } catch {
          argsText = String(req.arguments);
        }
        this.push('tool', `arguments sent to ${String(req.server || '')}.${String(req.tool || '')}:\n${argsText}`);
      }
      this.push('info', '  [y] trust server for this session (all its tools) · [w] trust always (save) · [n/Esc] reject');
      this.scroll = 0;
      this.render();
      return new Promise((resolve) => {
        this.permResolve = resolve;
      });
    }
    if (req.type === 'path') {
      this.push('info', '📁 Izin diperlukan untuk akses path di luar workspace.');
      this.push('tool', `operation: ${String(req.op || 'unknown')}\npath: ${String(req.path || '')}`);
      this.push('info', `  workspace: ${this.agent && this.agent.vfs ? this.agent.vfs.root : '(unknown)'}`);
      this.push('info', `  reason: ${String(req.reason || 'path berada di luar workspace')}`);
      this.push('info', '  [y] allow once · [a] allow this path and its subpaths for this session · [n/Esc] deny');
      this.scroll = 0;
      this.render();
    } else {
      this.push('info', req.alwaysConfirm
        ? '⚠️ Perintah ini terdeteksi berisiko dan akan selalu meminta konfirmasi.'
        : '🔐 Izin diperlukan untuk menjalankan perintah shell:');
      this.push('tool', `shell: ${String(req.shell || describeShell(this.cfg().shell))}\ncwd: ${String(req.cwd || '(default)')}\nmode: ${req.background ? 'background process' : 'foreground'}${req.background ? '' : ` · timeout ${Math.ceil((Number(req.timeout) || 120000) / 1000)}s`}\ncommand:\n${String(req.command || '')}`);
      if (req.reason) this.push('info', `  reason: ${req.reason}`);
      const choices = req.alwaysConfirm
        ? `  choose: ${p(C.green, '[y]')} allow this run only · ${p(C.red, '[n/Esc]')} reject. Next run will ask again.`
        : `  choose: ${p(C.green, '[y]')} allow once · ${p(C.cyan, '[a]')} allow this exact command this session · ${p(C.green + C.bold, '[w]')} allow this exact command always (save) · ${p(C.red, '[n/Esc]')} reject${wordHint}`;
      this.push('info', choices);
      this.scroll = 0;
      this.render();
    }
    return new Promise((resolve) => {
      this.permResolve = resolve;
    });
  }

  // Eksekusi keputusan izin dari tombol (y/a/w/n/enter/esc) ATAU kata ketikan.
  _settlePerm(act) {
    const resolve = this.permResolve;
    const req = this.permReq || {};
    if (req.alwaysConfirm && act !== 'once' && act !== 'reject') {
      this.permBuf = '';
      this.push('info', 'This risky command can only be allowed once; it will ask again next time.');
      this.render();
      return;
    }
    this.permResolve = null;
    this.permReq = null;
    this.permBuf = '';
    this.awaitingPermission = false;
    const ok = act !== 'reject';
    const target = req.type === 'path'
      ? String(req.path || '').slice(0, 90)
      : req.type === 'skill'
        ? String(req.id || '').slice(0, 90)
        : String(req.command || '').slice(0, 80);
    let msg;
    if (req.type === 'skill') {
      msg = ok ? `✓ skill '${target}' approved — saving...` : `✗ skill rejected: ${target}`;
    } else if (req.type === 'mcp') {
      const srv = String(req.server || '');
      const tl = String(req.tool || '');
      if (!ok) msg = `✗ MCP rejected: ${srv}.${tl}`;
      else {
        if (this.agent && typeof this.agent.addMcpAllow === 'function') this.agent.addMcpAllow(srv);
        if (act === 'always') {
          try { setMcp(srv, { trusted: true }); } catch {}
          msg = `✓ MCP server '${srv}' trusted (saved to config).`;
        } else {
          msg = `✓ MCP call allowed (this session): ${srv}.${tl}`;
        }
      }
    } else if (req.type === 'path') {
      if (!ok) msg = `✗ path access denied: ${target}`;
      else {
        if (act !== 'once' && this.agent && typeof this.agent.addSessionPathAllow === 'function') this.agent.addSessionPathAllow(req.path);
        msg = act === 'once' ? `✓ path allowed once: ${target}` : `✓ path allowed this session: ${target}`;
      }
    } else if (!ok) {
      msg = `✗ REJECTED: ${target}`;
    } else {
      if (act !== 'once' && this.agent && typeof this.agent.addSessionAllow === 'function') this.agent.addSessionAllow(req.command);
      if (act === 'always') {
        try {
          const cur = loadConfig().permissions || {};
          const allow = Array.isArray(cur.allow) ? cur.allow.slice() : [];
          const cmd = String(req.command || '').trim();
          if (cmd && !allow.includes(cmd)) allow.push(cmd);
          setPermissions({ allow, deny: Array.isArray(cur.deny) ? cur.deny : undefined });
        } catch {}
        msg = `✓ ALLOWED always (saved to config): ${target}`;
      } else if (act === 'session') msg = `✓ ALLOWED (this session): ${target}`;
      else msg = `✓ ALLOWED once: ${target}`;
    }
    if (msg) this.push('info', msg);
    this.render();
    if (resolve) resolve(ok);
  }

  _handlePerm(key) {
    if (!this.permResolve) return;
    // Ketikan kata → buffer (mis. "oke", "batal", "selalu"). Buffer ikut
    // tampil di bottom bar supaya user tahu inputnya terbaca.
    if (key && typeof key === 'object' && key.ch && key.ch.length === 1 && key.ch >= ' ') {
      this.permBuf = (this.permBuf || '') + key.ch;
      const m = matchPermWord(this.permBuf);
      this.render();
      if (m) this._settlePerm(m.act);
      return;
    }
    if (key === 'backspace') {
      this.permBuf = (this.permBuf || '').slice(0, -1);
      this.render();
      return;
    }
    if (key === 'esc') return this._settlePerm('reject');
    // Enter dengan buffer kosong = izinkan sekali (perilaku lama).
    if (key === 'enter' && !this.permBuf) return this._settlePerm('once');
    const m = matchPermWord(typeof key === 'string' ? key : '');
    if (m) return this._settlePerm(m.act);
    this.render();
  }

  _askApproval(changes) {
    if (this.autoApply) {
      const paths = (Array.isArray(changes) ? changes : this.agent.vfs.pendingChanges()).map((c) => c.path);
      const n = this.agent.vfs.applyPending(paths);
      return Promise.resolve({ decision: 'apply', applied: true, count: n, paths });
    }
    this._presentApproval();
    this.awaitingApproval = true;
    this.render();
    return new Promise((resolve) => {
      this.approvalResolve = resolve;
    });
  }

  // Terapkan pending lama saat auto-apply dinyalakan. Dipisah supaya
  // /auto on, /apply auto, dan approval mid-run memakai jalur yang sama.
  _flushAutoPending() {
    const vfs = this.agent && this.agent.vfs;
    if (!vfs || typeof vfs.hasPending !== 'function' || !vfs.hasPending()) return null;
    const paths = vfs.pendingChanges().map((c) => c.path);
    try {
      const n = vfs.applyPending();
      return { applied: true, count: n, paths };
    } catch (e) {
      this.push('error', `Auto-apply gagal: ${e && e.message ? e.message : e}`);
      return null;
    }
  }

  _settleApproval(decision) {
    const resolve = this.approvalResolve;
    this.approvalResolve = null;
    this.awaitingApproval = false;
    this._markApprovalSettled(decision);
    if (resolve) resolve(decision);
  }

  // Baris header "DIFF AWAITING DECISION" dibuat sekali saat presentasi.
  // Begitu user memutuskan (y/a/n) atau approval settle, teksnya di-update di
  // tempat supaya transkrip tidak selamanya terlihat menunggu keputusan.
  _markApprovalSettled(decision) {
    const applied = decision && decision.decision === 'apply';
    const n = decision && typeof decision.count === 'number' ? decision.count : (decision && decision.paths ? decision.paths.length : null);
    let changed = false;
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      const t = this.transcript[i];
      if (t.type !== 'info') continue;
      if (t.approvalHeaderCount == null) continue;
      const cnt = n == null ? t.approvalHeaderCount : n;
      t.text = applied
        ? `${p(C.green + C.bold, '✓ DIFF APPROVED')} · ${cnt} change${cnt === 1 ? '' : 's'} applied`
        : `${p(C.red + C.bold, '✗ DIFF REJECTED')} · ${cnt} change${cnt === 1 ? '' : 's'} discarded`;
      t.approvalHeaderCount = null;
      changed = true;
    }
    // Blok diff ikut ditandai selesai → border oranye ("menunggu") dilepas.
    const seen = new Set();
    for (const t of this.transcript) {
      if (t.type === 'code' && t.approval && !seen.has(t)) {
        seen.add(t);
        t.approval = false;
        t.approved = applied;
        changed = true;
      }
    }
    if (changed) {
      this._invalidateChat();
      this.render();
    }
  }

  _afterRun() {
    if (!this.agent.vfs || typeof this.agent.vfs.hasPending !== 'function') return;
    // Selesai giliran MODE PLAN → minta keputusan eksekusi rencana.
    if (this.planning) {
      this._presentPlanDecision(this.lastAnswer);
      return;
    }
    if (!this.agent.vfs.hasPending()) {
      // Tidak ada perubahan → kalau AI menawarkan rencana, tawarkan eksekusi.
      this._maybePlanSuggest();
      return;
    }
    if (this.autoApply) {
      const n = this.agent.vfs.applyPending();
      this.push('info', `${n} changes auto-applied (session permission).`);
      return;
    }
    this._presentApproval();
  }

  // Tampilkan prompt keputusan eksekusi rencana setelah giliran /plan selesai.
  _presentPlanDecision(text) {
    if (this.busy || this.mode !== 'chat') {
      this._planReset();
      return;
    }
    const plan = String(text || '').trim();
    if (!plan) {
      this.push('info', 'MODE PLAN selesai tanpa rencana yang bisa dieksekusi.');
      this._planReset();
      return;
    }
    this.awaitingPlan = true;
    this.push('info', `${p(C.cyan + C.bold, '📐 PLAN READY')} — Execute the plan above? ${p(C.green, '[y]')} execute · ${p(C.yellow, '[n]')} revise · ${p(C.red, '[Esc]')} dismiss`);
    this.scroll = 0;
    this.render();
  }

  // Eksekusi rencana yang disetujui (B): keluar MODE PLAN → giliran BUILD
  // yang memakai isi rencana sebagai instruksi (model tidak perlu mengingat).
  _planExec() {
    const plan = String(this.lastAnswer || '').trim();
    this.awaitingPlan = false;
    this.planning = false;
    if (this.agent && typeof this.agent.setPlanMode === 'function') this.agent.setPlanMode(false);
    if (!plan) {
      this.push('info', 'No plan to execute.');
      return;
    }
    this.push('info', 'Executing plan (build mode)…');
    this.render();
    this._runAI('EKSEKUSI rencana berikut sekarang (mode BUILD — kerjakan sampai selesai: buat/ubah file via staging seperti biasa, verifikasi, jangan menawarkan rencana ulang):\n\n' + plan);
  }

  _planDiscard() {
    this.awaitingPlan = false;
    this.planning = false;
    if (this.agent && typeof this.agent.setPlanMode === 'function') this.agent.setPlanMode(false);
    this.push('info', 'Plan dismissed. Ketik tugas untuk eksekusi langsung, atau /plan <tugas> untuk rencana baru.');
    this.render();
  }

  // Reset state plan (buang mode + keputusan yang tertunda).
  _planReset() {
    this.awaitingPlan = false;
    if (this.planning) {
      this.planning = false;
      if (this.agent && typeof this.agent.setPlanMode === 'function') this.agent.setPlanMode(false);
    }
  }

  // Heuristik C: di mode BUILD, kalau AI menjawab dengan rencana (# RENCANA)
  // dan belum ada file berubah, tawarkan satu tombol eksekusi. AI TIDAK bisa
  // "nekat tidak eksekusi" — eksekusi tetap keputusan user, bukan mode.
  _maybePlanSuggest() {
    if (this.busy || this.mode !== 'chat' || this.autoApply) return;
    const text = String(this.lastAnswer || '').trim();
    if (!text) return;
    if (!/(^|\n)\s*(#{1,4}|>|-)\s*RENCANA\s*[:：]?|(^|\n)\*\*?\s*RENCANA\s*\*?\s*[:：]?/im.test(text)) return;
    this.awaitingPlan = true;
    this.push('info', `${p(C.cyan + C.bold, '📐 plan detected')} — ${p(C.green, '[y]')} execute it now · ${p(C.yellow, '[n]')} discuss/ubah · ${p(C.red, '[Esc]')} dismiss`);
    this.scroll = 0;
    this.render();
  }

  _diffTextFor(c) {
    if (c.op === 'mkdir') return '+ (new directory)';
    const ops = unifiedDiff(c.before || '', c.after || '', { context: 2 });
    const lines = ops.map((o) => (o.type === ' ' ? ' ' + o.text : o.type === '@' ? '⋯' : o.type + o.text));
    let text = lines.join('\n');
    if (text.length > 16000) text = text.slice(0, 16000) + '\n⋯ (diff truncated: too long)';
    return text;
  }

  // Tampilkan perubahan staged langsung di dalam chat (tanpa layar popup).
  _presentApproval() {
    const changes = this.agent.vfs.pendingChanges();
    if (!changes.length) {
      this.awaitingApproval = false;
      return;
    }
    let added = 0;
    let removed = 0;
    this.push('info', `${p(C.orange + C.bold, '▶ ⧗ DIFF AWAITING DECISION')} · ${changes.length} changes proposed (staged):`);
    const hdr = this.transcript[this.transcript.length - 1];
    if (hdr && hdr.type === 'info') hdr.approvalHeaderCount = changes.length;
    for (const c of changes) {
      const ops = c.op === 'mkdir' ? [{ type: '+', text: '(new directory)' }] : unifiedDiff(c.before || '', c.after || '', { context: 2 });
      const s = summarize(ops);
      added += s.added;
      removed += s.removed;
      const tag = c.op === 'create' ? 'new ' : c.op === 'delete' ? 'deleted' : c.op === 'mkdir' ? 'folder' : 'modified ';
      this.push('info', `  ${p(C.bold, tag)} ${p(C.cyan, c.path)}  ${p(C.green, '+' + s.added)} ${p(C.red, '-' + s.removed)}`);
      this.transcript.push({ type: 'code', lang: 'diff', text: this._diffTextFor(c), approval: true });
    }
    this.push(
      'info',
      `Total ${p(C.green, '+' + added)} ${p(C.red, '-' + removed)}. Press ${p(C.yellow + C.bold, 'y')} apply · ${p(C.orange + C.bold, 'a')} always · ${p(C.red + C.bold, 'n')} reject  (or /apply · /apply auto · /reject)`
    );
    this.awaitingApproval = true;
    this.scroll = 0;
  }

  _pickChanges(arg, changes) {
    if (!arg) return undefined;
    const n = Number(arg);
    const norm = arg.startsWith('/') ? arg : '/' + arg;
    const c =
      Number.isInteger(n) && n >= 1 && n <= changes.length
        ? changes[n - 1]
        : changes.find((x) => x.path === norm || x.path === arg || x.path.endsWith('/' + arg.replace(/^\/+/, '')));
    if (!c) {
      this.push('info', `No matching file: ${arg}`);
      return false;
    }
    return [c.path];
  }

  _applyCmd(arg) {
    const midrun = !!this.approvalResolve;
    if (!this.agent.vfs || !this.agent.vfs.hasPending()) {
      if (midrun) this._settleApproval({ decision: 'apply' });
      else this.awaitingApproval = false;
      return this.push('info', 'No staged changes to apply.');
    }
    const auto = /^(auto|session|semua|all|\*)$/i.test(String(arg || ''));
    if (auto) this.autoApply = true;
    let paths;
    if (arg && !auto) {
      paths = this._pickChanges(arg, this.agent.vfs.pendingChanges());
      if (paths === false) return;
    }
    if (midrun) {
      this.push('info', `✓ ${auto ? 'approved all (auto this session)' : 'approved' + (paths ? ' ' + paths.join(', ') : '')} — continuing...`);
      this._settleApproval({ decision: 'apply', paths });
      return;
    }
    const n = this.agent.vfs.applyPending(paths);
    this.push('info', `✓ ${n} change(s) applied${paths ? ` (${paths.join(', ')})` : ''} to real files.${auto ? ' Auto-apply is on for this session.' : ''}`);
    if (this.agent.vfs.hasPending()) {
      this.push('info', `Still ${this.agent.vfs.pendingChanges().length} files staged. /apply again or /reject.`);
      return;
    }
    this.awaitingApproval = false;
    this._markApprovalSettled({ decision: 'apply', count: n });
    this._resumeApproved();
  }

  _rejectCmd(arg) {
    const midrun = !!this.approvalResolve;
    if (!this.agent.vfs || !this.agent.vfs.hasPending()) {
      if (midrun) this._settleApproval({ decision: 'reject' });
      else this.awaitingApproval = false;
      return this.push('info', 'No staged changes to reject.');
    }
    let paths;
    if (arg) {
      paths = this._pickChanges(arg, this.agent.vfs.pendingChanges());
      if (paths === false) return;
    }
    if (midrun) {
      this.push('info', '✗ rejected — changes discarded, AI asked to re-strategize...');
      this._settleApproval({ decision: 'reject', paths });
      return;
    }
    const n = this.agent.vfs.discardPending(paths);
    this.push('info', `✗ ${n} change(s) rejected & discarded (not applied).`);
    if (this.agent.vfs.hasPending()) {
      this.push('info', `Still ${this.agent.vfs.pendingChanges().length} files staged. /apply or /reject for the rest.`);
      return;
    }
    this.awaitingApproval = false;
    this._markApprovalSettled({ decision: 'reject', count: n });
    this._resumeRejected();
  }

  _itemToText(t) {
    if (!t) return '';
    if (t.type === 'code') return '```' + (t.lang || '') + '\n' + (t.text || '') + '\n```';
    if (t.type === 'table') {
      const h = (t.table.header || []).join(' | ');
      const rows = (t.table.rows || []).map((r) => r.join(' | '));
      return ['| ' + h + ' |', ...rows.map((r) => '| ' + r + ' |')].join('\n');
    }
    return String(t.text || '');
  }

  _chatText(scope) {
    const items = this.transcript.filter((t) => ['user', 'ai', 'code', 'table'].includes(t.type));
    if (scope === 'all' || scope === 'semua' || scope === '1') {
      return items
        .map((t) => (t.type === 'user' ? '> ' + String(t.text).replace(/\n/g, '\n> ') : this._itemToText(t)))
        .join('\n\n')
        .trim();
    }
    // default: jawaban AI terakhir (mulai dari item 'ai' terakhir ke depan, hingga 'user' berikutnya tidak ada)
    let start = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'user') {
        start = i + 1;
        break;
      }
    }
    const from = start < 0 ? 0 : start;
    return items
      .slice(from)
      .filter((t) => t.type !== 'user')
      .map((t) => this._itemToText(t))
      .join('\n\n')
      .trim();
  }

  _osc52(text) {
    let s = String(text);
    const MAX = 100000;
    if (s.length > MAX) s = s.slice(0, MAX);
    try {
      saveLastCopy(s); // fallback file (tanpa OSC 52 bisa dibuka dari ~/.niyusha/lastcopy.txt)
    } catch {}
    try {
      process.stdout.write('\x1b]52;c;' + Buffer.from(s, 'utf8').toString('base64') + '\x07');
      return true;
    } catch {
      return false;
    }
  }

  _notesCmd(arg) {
    const root = (this.agent.vfs && this.agent.vfs.root) || '/';
    const sub = String(arg || '').toLowerCase();
    if (sub === 'clear') {
      clearNote(root);
      return this.push('info', 'Session note cleared.');
    }
    const note = readNote(root);
    if (!note) return this.push('info', 'Note is empty. The AI can save it via the write_note tool; no manual editing — /notes clear to delete.');
    const lines = note.split('\n');
    this.push('info', `📝 Session note (${lines.length} lines):`);
    for (const ln of lines) this.push('info', '  ' + ln);
  }

  _psCmd(arg) {
    const bgs = this.agent.backgroundPids || [];
    if (arg != null && arg !== '') {
      const pid = Number(arg);
      killPid(pid);
      if (this.store) this.store.removeBackground(pid);
      this.agent.backgroundPids = (this.agent.backgroundPids || []).filter((b) => Number(b.pid) !== pid);
      this.push('info', `SIGTERM sent to ${pid}.`);
      return;
    }
    if (!bgs.length) return this.push('info', 'No background processes recorded.');
    for (const b of bgs) this.push('info', `${b.pid} · ${String(b.command || '').slice(0, 60)}`);
  }

  _copyCmd(arg) {
    const scope = String(arg || '').toLowerCase();
    const text = this._chatText(scope);
    if (!text) return this.push('info', 'Nothing to copy.');
    const ok = this._osc52(text);
    const n = text.length;
    if (ok) this.push('info', `📋 Copied to clipboard (${n} chars${scope === 'all' ? ', whole chat' : ', last answer'}). If the clipboard is empty, your terminal may not support OSC 52 — use Ctrl+B then manual selection.`);
    else this.push('error', 'Failed to copy to clipboard.');
  }

  _mouseCmd(arg) {
    const a = String(arg || '').toLowerCase();
    const on = a === 'on' || a === '1' || a === 'true' ? true : a === 'off' || a === '0' || a === 'false' ? false : !this.mouseEnabled;
    this._setMouse(on);
    this.push(
      'info',
      on
        ? '🖱 Mouse-select ON: drag in the chat pane to copy (auto to clipboard). Shift+drag = native selection. Ctrl+G or /mouse off to disable.'
        : '🖱 Mouse-select off (terminal native selection restored).'
    );
    this.render();
  }

  _normSel() {
    if (!this.selection) return null;
    let { r0, c0, r1, c1 } = this.selection;
    if (r0 > r1 || (r0 === r1 && c0 > c1)) {
      const tr = r0; r0 = r1; r1 = tr;
      const tc = c0; c0 = c1; c1 = tc;
    }
    return { r0, c0, r1, c1 };
  }

  _highlightRow(plain, row, contentW) {
    const sel = this._normSel();
    if (!sel || row < sel.r0 || row > sel.r1) return null;
    const w = contentW;
    const a = row === sel.r0 ? sel.c0 : 0;
    const b = row === sel.r1 ? sel.c1 : w;
    return sliceByWidth(plain, 0, a) + '\x1b[7m' + sliceByWidth(plain, a, b) + '\x1b[0m' + sliceByWidth(plain, b);
  }

  _onMouse(m) {
    if (this.mode === 'settings') return this._onMouseSettings(m);
    if (this.mode !== 'chat' || !this._view) return;
    // Roda mouse (wheel, SGR b=64/65): di area sidebar → gulir sidebar, selain itu chat.
    if (m.b & 64) {
      const up = !(m.b & 1);
      const overSide = this.showSidebar && this._view.sideX != null && m.x - 1 >= this._view.sideX;
      if (overSide) this._scrollSide(up ? -3 : 3);
      else this._scrollBy(up ? 3 : -3);
      return;
    }
    const bodyRow = m.y - 1 - this._view.bodyStart;
    if (bodyRow < 0 || bodyRow >= this._view.bodyRows) return;
    const w = this._view.contentW;
    const col = Math.min(Math.max(m.x - 1 - this._view.gutterLen, 0), Math.max(0, w - 1));
    const btn = m.b & 3;
    const moving = (m.b & 32) !== 0;
    if (!m.release && btn === 0 && !moving) {
      this.selection = { r0: bodyRow, c0: col, r1: bodyRow, c1: col };
      this._pressAt = { r: bodyRow, c: col };
      this.render();
      return;
    }
    if (!m.release && moving && this.selection) {
      this.selection.r1 = bodyRow;
      this.selection.c1 = col;
      if (!this._dragTimer) {
        this._dragTimer = setTimeout(() => {
          this._dragTimer = null;
          this.render();
        }, 16);
      }
      return;
    }
    if (m.release && this.selection) {
      if (this._dragTimer) {
        clearTimeout(this._dragTimer);
        this._dragTimer = null;
      }
      const click = this._pressAt && this._pressAt.r === bodyRow && this._pressAt.c === col;
      this._pressAt = null;
      if (click) {
        this.selection = null;
        this._onClick(bodyRow, m.x - 1);
        this.render();
        return;
      }
      this._copySelection();
      this.selection = null;
      this.render();
    }
  }

  // Klik item Settings: pilih + buka (toggle sendiri untuk Notifications).
  _onMouseSettings(m) {
    if (m.release || (m.b & 32)) return; // hanya saat tombol ditekan
    const bodyRow = m.y - 1 - 2; // header: brand + garis
    if (bodyRow < 0) return;
    for (const hit of this._settingsHits || []) {
      if (hit.row !== bodyRow) continue;
      const items = this.settingsItems(this.cfg());
      if (!items[hit.idx]) return;
      this.settingsIdx = hit.idx;
      this._openSettingsItem(items[hit.idx].act);
      this.render();
      return;
    }
  }

  _onClick(bodyRow, col) {
    if (!this._view || this.busy) return;
    const chatW = this._view.chatW;
    if (col <= chatW) return; // klik di pane chat: tidak ada aksi item
    for (const hit of this._view.sideHits || []) {
      if (hit.row !== bodyRow) continue;
      if (hit.kind === 'todo') return this._toggleTodoAt(hit.idx);
      if (hit.kind === 'diff') {
        if (!this.agent.vfs || !this.agent.vfs.hasPending()) return;
        return this._slash('/diff');
      }
    }
  }

  _toggleTodoAt(idx) {
    const todos = this._todos();
    if (idx < 0 || idx >= todos.length) return;
    todos[idx].done = !todos[idx].done;
    this._persistTodos();
    this.push('info', `↳ todo #${idx + 1} ${todos[idx].done ? 'done ✓' : 'reopened'}: ${String(todos[idx].text).slice(0, 60)}`);
  }

  _copySelection() {
    const sel = this._normSel();
    if (!sel || !this._view) return;
    const lines = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const plain = (this._view.leftPlain && this._view.leftPlain[r]) || '';
      const a = r === sel.r0 ? sel.c0 : 0;
      const b = r === sel.r1 ? sel.c1 : this._view.contentW;
      lines.push(sliceByWidth(plain, a, b).replace(/\s+$/, ''));
    }
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const text = lines.join('\n');
    if (!text.trim()) return;
    this._osc52(text);
    this.push('info', `📋 ${text.length} chars copied from selection.`);
  }

  // Kotak yang bisa di-expand: code box + reasoning box (urutan transkrip).
  _boxList() {
    return this.transcript.filter((t) => t.type === 'code' || t.type === 'reasoning');
  }

  _expandCmd(kind, arg, only) {
    const boxes = this._boxList().filter((t) => !only || t.type === only);
    if (!boxes.length) return this.push('info', only === 'reasoning' ? 'No reasoning box yet.' : 'No collapsible box to expand.');
    const lineCountOf = (t) => (t.text || '').split('\n').length;
    const truncAt = (t) => (t.type === 'reasoning' ? 8 : 16);
    const n = Number(arg);
    let item;
    if (Number.isInteger(n) && n >= 1 && n <= boxes.length) {
      item = boxes[n - 1];
    } else if (kind === 'expand') {
      item = [...boxes].reverse().find((t) => !t.expanded && lineCountOf(t) > truncAt(t)) || boxes[boxes.length - 1];
    } else {
      item = [...boxes].reverse().find((t) => t.expanded) || boxes[boxes.length - 1];
    }
    item.expanded = kind === 'expand';
    const idx = boxes.indexOf(item) + 1;
    const what = item.type === 'reasoning' ? 'reasoning' : 'code';
    this.push('info', `${kind === 'expand' ? '▾ expanded' : '▸ collapsed'}: ${what} box #${idx}${item.type === 'code' && item.lang ? ' (' + item.lang + ')' : ''}.`);
    this.scroll = 0;
    this.render();
  }

  _toggleAllExpanded() {
    const boxes = this.transcript.filter((t) => t.type === 'code' || t.type === 'reasoning');
    const groups = [];
    let current = null;
    for (let i = 0; i < this.transcript.length; i++) {
      const t = this.transcript[i];
      if (t.type === 'tool' || t.type === 'result') {
        if (!current) {
          current = { startIdx: i, items: [], id: i };
          groups.push(current);
        }
        current.items.push(t);
      } else {
        current = null;
      }
    }
    const anyExpanded = boxes.some((t) => t.expanded) || this._expandedToolGroups.size > 0;
    if (anyExpanded) {
      boxes.forEach((t) => { t.expanded = false; });
      this._expandedToolGroups.clear();
      this.push('info', '▸ collapsed all.');
    } else {
      boxes.forEach((t) => { t.expanded = true; });
      groups.forEach((g) => { this._expandedToolGroups.add(g.id); });
      this.push('info', `▾ expanded all (${boxes.length} boxes, ${groups.length} tool groups).`);
    }
    this.render();
  }

  // /reasoning [n | all | collapse] — lihat isi reasoning penuh bila diperlukan.
  _reasoningCmd(arg) {
    const boxes = this.transcript.filter((t) => t.type === 'reasoning');
    if (!boxes.length) return this.push('info', 'No reasoning box yet.');
    const a = String(arg || '').trim().toLowerCase();
    if (a === 'all' || a === 'open' || a === 'expand') {
      boxes.forEach((t) => { t.expanded = true; });
      this.push('info', `▾ expanded all reasoning (${boxes.length}).`);
    } else if (a === 'collapse' || a === 'close' || a === 'hide') {
      boxes.forEach((t) => { t.expanded = false; });
      this.push('info', `▸ collapsed all reasoning (${boxes.length}).`);
    } else {
      const n = Number(a);
      const item = Number.isInteger(n) && n >= 1 && n <= boxes.length ? boxes[n - 1] : boxes[boxes.length - 1];
      item.expanded = !item.expanded;
      this.push('info', `${item.expanded ? '▾ expanded' : '▸ collapsed'}: reasoning #${boxes.indexOf(item) + 1}.`);
    }
    this.scroll = 0;
    this.render();
  }

  _autoCmd(arg) {
    const a = String(arg || '').toLowerCase();
    const on = a === 'on' || a === '1' || a === 'true' ? true : a === 'off' || a === '0' || a === 'false' ? false : !this.autoMode;
    this.autoMode = on;
    this.autoApply = on;
    if (on) this.agent.addSessionAllow?.('*');
    else this.agent.removeSessionAllow?.('*');
    if (on) {
      const vfs = this.agent && this.agent.vfs;
      const pending = vfs && typeof vfs.hasPending === 'function' ? vfs.hasPending() : false;
      if (pending && this.approvalResolve) {
        const res = this._flushAutoPending();
        if (res) this._settleApproval({ decision: 'apply', ...res });
      } else if (pending && !this.busy) {
        const res = this._flushAutoPending();
        if (res) {
          this.awaitingApproval = false;
          this._markApprovalSettled({ decision: 'apply', count: res.count });
          this.push('info', `${res.count} staged change(s) applied before auto mode.`);
        }
      } else if (pending) {
        this.push('info', `${vfs.pendingChanges().length} staged change(s) will be auto-applied at the next step.`);
      }
    }
    if (this.awaitingApproval && !this.approvalResolve) this.awaitingApproval = false;
    this.push(
      'info',
      on
        ? '⚡ AUTONOMOUS MODE ON: files auto-applied (still /undo-able), non-dangerous shell allowed this session. DANGEROUS commands & OUTSIDE-workspace paths still need approval (cannot be undone). /auto off to disable.'
        : '⚡ Autonomous mode off. Files wait for /apply · /reject again; shell needs permission again.'
    );
    this.scroll = 0;
    this.render();
  }

  _sndCmd(arg) {
    const a = String(arg || '').toLowerCase().trim();
    const kinds = ['bell', 'double', 'ding'];
    let kind = this.cfg().soundKind || 'bell';
    let on;
    if (kinds.includes(a)) {
      kind = a;
      on = true;
    } else if (a === 'on' || a === '1' || a === 'true') on = true;
    else if (a === 'off' || a === '0' || a === 'false') on = false;
    else if (!a) on = this.cfg().sound !== true;
    else {
      this.push('info', `Unknown sound type: ${a}. Choose: bell · double · ding`);
      return;
    }
    saveConfig({ sound: !!on, soundKind: kind });
    this.agent.refresh();
    if (on) playSound(kind);
    this.push('info', on
      ? `🔊 Completion sound ON — type "${kind}". Change: /snd bell|double|ding · disable: /snd off`
      : '🔇 Completion sound off.');
    this.scroll = 0;
    this.render();
  }

  // ─── Tema warna ───
  _openTheme() {
    this.themeIdx = Math.max(0, Object.keys(THEME_DEFS).indexOf(this.cfg().theme || 'dark-blue'));
    this.mode = 'theme';
    this.render();
  }

  _relaxCmd() {
    this.relaxMode = !this.relaxMode;
    this._glowTick = Date.now();
    if (this.relaxMode) {
      this.push('info', '◐ RELAX MODE ON — Ctrl+R atau /relax untuk keluar · Ctrl+B = sidebar');
    } else {
      this.push('info', '◑ Relax Mode OFF');
    }
    this.render();
  }

  _themeCmd(arg) {
    const a = String(arg || '').toLowerCase().trim();
    if (!a) {
      this._openTheme();
      return;
    }
    if (!THEME_DEFS[a]) {
      this.push('info', `Unknown theme: ${a}. Choose: ${Object.keys(THEME_DEFS).join(' | ')}`);
      return;
    }
    this._applyTheme(a);
  }

  _applyTheme(name) {
    saveConfig({ theme: name });
    this.agent.refresh();
    applyTheme(name);
    this._themeVersion = (this._themeVersion || 0) + 1;
    this._chatCache = null;
    this.push('info', `Theme: ${(THEME_DEFS[name] || {}).label || name}.`);
    this.scroll = 0;
    this.render();
  }

  _handleTheme(key) {
    const keys = Object.keys(THEME_DEFS);
    if (key === 'esc' || key === 'q') {
      this.mode = 'chat';
      this.render();
      return;
    }
    if (key === 'up') this.themeIdx = (this.themeIdx - 1 + keys.length) % keys.length;
    else if (key === 'down') this.themeIdx = (this.themeIdx + 1) % keys.length;
    else if (key === 'enter' || key === ' ') {
      this.mode = 'chat';
      this._applyTheme(keys[this.themeIdx]);
      return;
    }
    this.render();
  }

  _bodyTheme(cols, bodyRows) {
    const cur = this.cfg().theme || 'dark-blue';
    const keys = Object.keys(THEME_DEFS);
    const out = ['', p(C.bold, '  Theme'), ''];
    keys.forEach((k, i) => {
      const sel = i === this.themeIdx;
      const marker = sel ? p(C.cyan, ' ► ') : '   ';
      const active = k === cur ? p(C.green, ' ✓ active') : '';
      const preview = previewSwatch(k);
      out.push(`  ${marker}${sel ? p(C.cyan + C.bold, THEME_DEFS[k].label) : THEME_DEFS[k].label}${active}  ${preview}`);
    });
    out.push('');
    out.push(p(C.dim, '  ↑↓ select · Enter apply · Esc cancel · or /theme <name>'));
    return out.slice(0, bodyRows);
  }

  // ─── About / attribution (`/dev`, `/about`, `/credits`) ───
  _openDev() {
    this.mode = 'dev';
    this.render();
  }

  _handleDev(key) {
    if (key === 'esc' || key === 'enter' || (key && (key.ch === 'q' || key.ch === ' '))) {
      this.mode = 'chat';
      this.render();
    }
  }

  _bodyDev(cols, bodyRows) {
    const V = this.version;
    const label = (s) => p(C.dim, ' ' + String(s).padEnd(10));
    const value = (s) => p(C.heading, s);
    const link = (s) => p(C.sky, s);
    const rows = [
      '',
      brandArt('N I Y U S H A') + '  ' + chip('v' + V, C.sky),
      p(C.dim, 'AI coding agent in your terminal'),
      '',
      p(C.heading + C.bold, 'Attribution'),
      '',
      ` ${label('Developer')}${p(C.sky + C.bold, 'NTVGraph')}`,
      ` ${label('Creator')}${value('Hadins')}`,
      ` ${label('TUI')}${value('Niyusha')}`,
      ` ${label('Android')}${value('NTVGraph × Niyusha')}`,
      ` ${label('Python')}${value('NTVGraph × Python')}`,
      ` ${label('License')}${p(C.dim, 'MIT')}`,
      '',
      p(C.dim, 'Built and maintained by NTVGraph.'),
      p(C.dim, 'The TUI is powered by the ') + link('Niyusha') + p(C.dim, ' agent.'),
    ];
    const blockW = Math.max(...rows.map((l) => dispWidth(stripAnsi(l))));
    const pad = Math.max(0, Math.floor((cols - blockW) / 2));
    return rows.map((l) => ' '.repeat(pad) + l).slice(0, bodyRows);
  }

  _shellCmd(arg) {
    const a = String(arg || '').toLowerCase().trim();
    const opts = ['auto', 'cmd', 'powershell', 'pwsh', 'bash', 'wsl'];
    if (!a) {
      this.push('info', `Shell now: ${this.cfg().shell || 'auto'} (${describeShell(this.cfg().shell)})`);
      this.push('info', `Set: /shell ${opts.join(' | ')} — auto = PowerShell (Windows) / $SHELL (Unix), otomatis WSL untuk path UNC; kalau shell pilihan tidak ada, fallback ke default.`);
      return;
    }
    if (!opts.includes(a)) {
      this.push('info', `Unknown shell: ${a}. Choose: ${opts.join(' | ')}`);
      return;
    }
    saveConfig({ shell: a });
    this.agent.refresh();
    this.push('info', `Shell set: ${a} (${describeShell(a)}).`);
    this.scroll = 0;
    this.render();
  }

  _resumeApproved() {
    if (this.busy) return;
    this.push('info', '▶ Continuing the task...');
    this._runAI(
      '[persetujuan user] Perubahan yang aku usulkan SUDAH DITERAPKAN ke file nyata. ' +
        'Lanjutkan dan selesaikan sisa tugas. Jika seluruh tugas sudah selesai, beri ringkasan akhir singkat. ' +
        'Jika ada langkah lanjutan atau ide yang jelas, putuskan sendiri dan lanjutkan.'
    );
  }

  _resumeRejected() {
    if (this.busy) return;
    this.push('info', '▶ Re-strategizing...');
    this._runAI(
      '[penolakan user] User MENOLAK perubahan yang aku usulkan; semua perubahan itu sudah dibatalkan dan TIDAK diterapkan. ' +
        'Akui penolakan dengan singkat, jangan mengulang pendekatan yang sama, pikirkan kemungkinan alasan penolakan, ' +
        'lalu susun strategi atau alternatif baru dan lanjutkan.'
    );
  }

  _openWebSearch(keepIdx) {
    const ws = getWebsearch();
    const custom = Array.isArray(ws.custom) ? ws.custom.map((c) => c.name) : [];
    this.providers = [...knownProviders(), ...custom];
    this.wsProvider = this.providers.includes(ws.provider) ? ws.provider : this.providers[0];
    this.wsItems = [
      { label: 'Web search enabled', value: ws.enabled ? p(C.green, 'ON') : p(C.red, 'OFF'), kind: 'toggle' },
      { label: 'Provider', value: p(C.dim, this.wsProvider), kind: 'provider' },
      { label: 'API Key', value: ws.apiKeys[this.wsProvider] ? p(C.green, 'key ✓') : KNOWN[this.wsProvider] ? (KNOWN[this.wsProvider].key ? p(C.yellow, 'not set') : p(C.gray, 'public — no key')) : p(C.yellow, 'not set'), kind: 'key' },
      { label: 'Limit / run', value: p(C.dim, String(ws.maxPerRun)), kind: 'limit' },
      { label: 'Status', value: p(C.dim, `${ws.enabled ? 'on · ' : 'off · '}${this.wsProvider}${this.agent.searchUsed != null ? ` · ${this.agent.searchUsed}/${ws.maxPerRun} used` : ''}`), kind: 'status' },
    ];
    if (!keepIdx) this.wsIdx = 0;
    this.mode = 'websearch';
  }

  _handleWebSearch(key) {
    const k = typeof key === 'string' ? key : (key && key.ch) || '';
    if (k === 'esc' || k === 'q') {
      this.mode = 'chat';
      return;
    }
    if (k === 'up') {
      this.wsIdx = (this.wsIdx - 1 + this.wsItems.length) % this.wsItems.length;
      return;
    }
    if (k === 'down') {
      this.wsIdx = (this.wsIdx + 1) % this.wsItems.length;
      return;
    }
    const item = this.wsItems[this.wsIdx];
    if (!item) return;
    if (item.kind === 'toggle' && (k === 'enter' || k === ' ')) {
      const ws = getWebsearch();
      setWebsearch({ enabled: !ws.enabled });
      this.agent.invalidatePrompt?.();
      this.push('info', `Web search ${!ws.enabled ? 'ON ✓' : 'off'} (provider ${this.wsProvider}).`);
    } else if (item.kind === 'provider' && (k === 'enter' || k === 'right' || k === 'left')) {
      const delta = k === 'left' ? -1 : 1;
      const idx = (this.providers.indexOf(this.wsProvider) + delta + this.providers.length) % this.providers.length;
      this.wsProvider = this.providers[idx];
      const ws = getWebsearch();
      setWebsearch({ provider: this.wsProvider });
      this.push('info', `Provider web search: ${this.wsProvider}`);
    } else if (item.kind === 'key' && (k === 'enter' || k === ' ')) {
      this.keyTarget = 'ws-key';
      this.keyHeader = this.wsProvider + ' · web search API key (Enter save · Esc cancel)';
      this.keyBuffer = '';
      this.mode = 'key';
      return;
    } else if (item.kind === 'limit' && (k === 'enter' || k === ' ')) {
      this.keyTarget = 'ws-limit';
      this.keyHeader = 'Web search limit per run (1-20, Enter to save)';
      this.keyBuffer = '';
      this.mode = 'key';
      return;
    } else if (item.kind === 'limit' && (k === 'left' || k === 'right')) {
      const ws = getWebsearch();
      const n = Math.max(1, Math.min(20, ws.maxPerRun + (k === 'left' ? -1 : 1)));
      setWebsearch({ maxPerRun: n });
    }
    this._openWebSearch(true);
  }

  _bodyWebSearch(cols, bodyRows) {
    const out = ['', p(C.bold, '  Web Search'), ''];
    if (this.wsIdx !== undefined) {
      this.wsItems.forEach((it, i) => {
        const sel = i === this.wsIdx;
        const marker = sel ? p(C.cyan, ' ► ') : '   ';
        const label = it.label.padEnd(18);
        if (it.kind === 'status') {
          out.push(`  ${marker}${sel ? p(C.bold, label) : label}${it.value}`);
        } else {
          out.push(`  ${marker}${sel ? p(C.cyan, label) : label}  ${it.value}`);
        }
      });
    }
    out.push('');
    out.push(p(C.dim, '  ↑↓ select · Enter change · ← → provider/limit · Esc back'));
    return out.slice(0, bodyRows);
  }

  settingsItems(cfg) {
    return [
      { label: 'Provider', value: cfg.provider, act: 'provider' },
      { label: 'API Key', value: maskKey(cfg.apiKey), act: 'key' },
      { label: 'Model', value: cfg.model, act: 'model' },
      { label: 'Notifications', value: cfg.notify === false ? 'off' : 'on', act: 'notify' },
      { label: 'Theme', value: (THEME_DEFS[cfg.theme] || THEME_DEFS['dark-blue']).label, act: 'theme' },
      { label: 'Back', value: '', act: 'back' },
    ];
  }

  _handleSettings(key) {
    const items = this.settingsItems(this.cfg());
    if (key === 'esc') {
      this.mode = 'chat';
      return;
    }
    if (key === 'up') this.settingsIdx = (this.settingsIdx - 1 + items.length) % items.length;
    else if (key === 'down') this.settingsIdx = (this.settingsIdx + 1) % items.length;
    else if (key === 'enter') this._openSettingsItem(items[this.settingsIdx].act);
    else if (key.ch) {
      const i = items.findIndex((x) => x.label.toLowerCase().startsWith(key.ch.toLowerCase()));
      if (i >= 0) this.settingsIdx = i;
    }
  }

  _openSettingsItem(act) {
    if (act === 'back') {
      this.mode = 'chat';
      return;
    }
    if (act === 'provider') {
      this.mode = 'provider';
      this.providerIdx = Math.max(0, providerList().indexOf(this.cfg().provider));
      return;
    }
    if (act === 'key') {
      this.mode = 'key';
      this.keyHeader = `API key for ${(providerInfo(this.cfg().provider) || {}).name || this.cfg().provider}`;
      this.keyBuffer = '';
      return;
    }
    if (act === 'model') this._openModel();
    if (act === 'notify') {
      const next = this.cfg().notify === false;
      saveConfig({ notify: next });
      this.agent.refresh();
      this.push('info', `Desktop notifications ${next ? 'ON' : 'OFF'} — shown when a long task (>15 s) finishes.`);
    }
    if (act === 'theme') this._openTheme();
  }

  _openQuick() {
    this.mode = 'quick';
    this.quickFilter = '';
    this.quickIdx = 0;
    this.quickError = '';
    this.quickLoading = true;
    this.quickItems = [];
    this.quickFiltered = [];
    this.render();
    const full = loadConfig();
    const keys = full.apiKeys || {};
    const targets = providerList().filter((name) => {
      if (providerDisabled(name)) return false;
      const preset = providerInfo(name);
      return !preset.requiredKey || keys[name];
    });
    if (!targets.length) {
      this.quickLoading = false;
      this.quickError = 'No provider configured yet. Press Ctrl+S to add an API key.';
      this.render();
      return;
    }
    Promise.all(
      targets.map((name) =>
        this.agent
          .listModelsFor(name)
          .then((models) => ({ name, models }))
          .catch((e) => ({ name, error: e.message }))
      )
    )
      .then((results) => {
        const items = [];
        let anyError = '';
        for (const r of results) {
          if (r.error) {
            anyError = `${r.name}: ${r.error}`;
            continue;
          }
          for (const m of r.models) items.push({ provider: r.name, model: m });
        }
        this.quickItems = items;
        this.quickFiltered = items;
        const cur = { provider: full.provider, model: full.model };
        const at = items.findIndex((it) => it.provider === cur.provider && it.model === cur.model);
        this.quickIdx = at >= 0 ? at : 0;
        this.quickLoading = false;
        this.quickError = items.length ? '' : anyError || 'No models found.';
      })
      .catch((e) => {
        this.quickLoading = false;
        this.quickError = e.message;
      })
      .finally(() => this.render());
  }

  _handleQuick(key) {
    if (key === 'esc') {
      this.mode = 'chat';
      return;
    }
    if (this.quickLoading) return;
    if (key === 'backspace') {
      this.quickFilter = this.quickFilter.slice(0, -1);
      this._applyQuickFilter();
      return;
    }
    if (key === 'up') {
      if (this.quickFiltered.length) this.quickIdx = (this.quickIdx - 1 + this.quickFiltered.length) % this.quickFiltered.length;
      return;
    }
    if (key === 'down') {
      if (this.quickFiltered.length) this.quickIdx = (this.quickIdx + 1) % this.quickFiltered.length;
      return;
    }
    if (key === 'enter') {
      const pick = this.quickFiltered[this.quickIdx];
      if (!pick) return;
      setProvider(pick.provider);
      setModel(pick.provider, pick.model);
      this.agent.refresh();
      this.push('info', `Active model: ${pick.model} (provider ${pick.provider}).`);
      this.mode = 'chat';
      return;
    }
    if (key.ch) {
      this.quickFilter += key.ch;
      this._applyQuickFilter();
    }
  }

  _applyQuickFilter() {
    const f = this.quickFilter.toLowerCase();
    this.quickFiltered = f
      ? this.quickItems.filter((it) => (it.model + ' ' + it.provider).toLowerCase().includes(f))
      : this.quickItems;
    this.quickIdx = 0;
  }

  _openModel() {
    this.mode = 'model';
    this.modelFilter = '';
    this.modelIdx = 0;
    this.modelError = '';
    this.modelLoading = true;
    this.modelList = [];
    this.modelFiltered = [];
    this.render();
    this.agent
      .listModels()
      .then((list) => {
        this.modelList = list;
        this.modelFiltered = list;
        this.modelLoading = false;
        const cur = loadConfig().model;
        const at = list.indexOf(cur);
        this.modelIdx = at >= 0 ? at : 0;
        this.status = '';
      })
      .catch((e) => {
        const info = providerInfo(loadConfig().provider) || {};
        if (Array.isArray(info.models) && info.models.length) {
          this.modelList = info.models.slice();
          this.modelFiltered = info.models.slice();
          this.modelLoading = false;
          this.modelError = '';
          this.modelIdx = Math.max(0, info.models.indexOf(loadConfig().model));
          this.push('info', `Katalog /models tak tersedia — memakai daftar model preset (${info.models.join(', ')}).`);
          this.status = '';
          return;
        }
        this.modelLoading = false;
        this.modelError = e.message;
        this.status = '';
      })
      .finally(() => this.render());
  }

  _handleProvider(key) {
    const names = providerList();
    if (key === 'esc') {
      if (this.firstRun) {
        this.mode = 'chat';
        this.push('info', 'Provider setup skipped. Use /s to set a provider later.');
        this.render();
      } else {
        this.mode = 'settings';
      }
      return;
    }
    if (key === 'up') this.providerIdx = (this.providerIdx - 1 + names.length) % names.length;
    else if (key === 'down') this.providerIdx = (this.providerIdx + 1) % names.length;
    else     if (key === 'enter') {
      const name = names[this.providerIdx];
      if (providerDisabled(name)) {
        this.push('info', `Provider '${name}' sedang OFF (belum tersedia). Aktifkan: /provider enable ${name}`);
        return;
      }
      if (name === 'custom') {
        const info = providerInfo('custom') || {};
        this.customSlotData = {
          name: info.name || 'Custom',
          baseUrl: info.baseUrl || 'http://localhost:8080/v1',
          model: info.model || 'gpt-4o-mini',
          requiredKey: info.requiredKey !== false,
        };
        this.customSlotStep = 0;
        this.customSlotBuffer = this.customSlotData.name;
        this.mode = 'customslot';
        this.render();
        return;
      }
      setProvider(name);
      this.agent.refresh();
      const preset = providerInfo(name);
      const cfg = loadConfig();
      if (preset.requiredKey && !cfg.apiKey) {
        this.push('info', `Provider active: ${name} — enter the API key.`);
        this.mode = 'key';
        this.keyHeader = `API key for ${preset.name}`;
        this.keyBuffer = '';
      } else {
        this.push('info', `Provider active: ${name} (key: ${maskKey(cfg.apiKey)})`);
        this.status = `provider=${sanitizeText(name)}`;
        this.mode = 'settings';
        this.settingsIdx = 1;
      }
      this.firstRun = false;
    }
  }

  _handleCustomSlot(key) {
    if (key === 'esc') {
      this.mode = 'provider';
      this.render();
      return;
    }
    if (key === 'backspace') {
      this.customSlotBuffer = this.customSlotBuffer.slice(0, -1);
      return;
    }
    if (key === 'enter') {
      const val = this.customSlotBuffer.trim();
      if (this.customSlotStep === 0) {
        if (val) this.customSlotData.name = val;
        this.customSlotStep = 1;
        this.customSlotBuffer = this.customSlotData.baseUrl || '';
      } else if (this.customSlotStep === 1) {
        if (val) this.customSlotData.baseUrl = val;
        this.customSlotStep = 2;
        this.customSlotBuffer = this.customSlotData.model || '';
      } else {
        if (val) this.customSlotData.model = val;
        try {
          setCustomProvider({
            name: this.customSlotData.name,
            baseUrl: this.customSlotData.baseUrl,
            model: this.customSlotData.model,
            requiredKey: this.customSlotData.requiredKey,
          });
          setProvider('custom');
          this.agent.refresh();
          const cfg = loadConfig();
          const info = providerInfo('custom') || {};
          if (info.requiredKey && !cfg.apiKey) {
            this.keyTarget = 'ai';
            this.keyBuffer = '';
            this.keyHeader = `API key for ${info.name || 'Custom'}`;
            this.mode = 'key';
          } else {
            this.push('info', `Custom slot active: ${cfg.provider} (${cfg.baseUrl})`);
            this.mode = 'settings';
            this.settingsIdx = 1;
          }
          this.firstRun = false;
        } catch (e) {
          this.push('error', e.message);
          this.mode = 'provider';
        }
      }
      this.render();
      return;
    }
    if (key === 'ctrl+v') {
      const txt = this._clipboardPasteText();
      if (txt) this.customSlotBuffer += txt.replace(/[\r\n]+/g, '');
      return;
    }
    if (key && key.paste != null) {
      this.customSlotBuffer += String(key.paste).replace(/[\r\n]+/g, '');
      return;
    }
    if (key.ch) this.customSlotBuffer += key.ch;
  }

  _providerAdd(rest) {
    const parts = String(rest || '').split(/\s+/).slice(1).filter(Boolean);
    const [name, baseUrl, model] = parts;
    if (!name || !baseUrl) return this.push('info', 'Usage: /provider add <name> <baseUrl> [model]  (e.g. /provider add local http://localhost:8080/v1 my-model)');
    try {
      addCustomProvider({ name, baseUrl, model });
      this.agent.refresh();
      this.push('info', `✓ Custom provider '${name}' added (${baseUrl}). Set API key via /provider → choose → key.`);
      this.mode = 'provider';
      this.providerIdx = Math.max(0, providerList().indexOf(name));
    } catch (e) {
      this.push('error', e.message);
    }
  }

  _providerCustom(rest) {
    const parts = String(rest || '').split(/\s+/).slice(1).filter(Boolean);
    const [name, baseUrl, model] = parts;
    try {
      const patch = {};
      if (name) patch.name = name;
      if (baseUrl) patch.baseUrl = baseUrl;
      if (model) patch.model = model;
      const info = setCustomProvider(patch);
      this.agent.refresh();
      this.push('info', `✓ Custom slot updated: ${info.name} (${info.baseUrl}).`);
      this.mode = 'provider';
      this.providerIdx = Math.max(0, providerList().indexOf('custom'));
    } catch (e) {
      this.push('error', e.message);
    }
  }

  _providerRm(rest) {
    const name = String(rest || '').split(/\s+/)[1];
    if (!name) return this.push('info', 'Usage: /provider rm <name>');
    removeCustomProvider(name);
    this.agent.refresh();
    this.push('info', `✓ Custom provider '${name}' removed.`);
  }

  _providerToggle(rest, on) {
    const name = String(rest || '').split(/\s+/)[1];
    if (!name) return this.push('info', `Usage: /provider ${on ? 'enable' : 'disable'} <name>`);
    if (!providerInfo(name)) return this.push('info', `Unknown provider: '${name}'.`);
    setProviderEnabled(name, on);
    this.push('info', `Provider '${name}' → ${on ? 'ON ✓' : 'OFF'}.`);
  }

  _providerManifest(rest) {
    const val = String(rest || '').split(/\s+/).slice(1).join(' ').trim();
    if (!val) return this.push('info', `Current manifest URL: ${manifestUrl() || '(not set)'}. Usage: /provider manifest <url | off>`);
    if (/^(off|none|-)$/i.test(val)) {
      setManifestUrl('');
      this.push('info', 'Provider manifest disabled.');
      return;
    }
    setManifestUrl(val);
    this.push('info', `Fetching manifest from ${val} ...`);
    this.render();
    fetchManifest(val)
      .then((list) => {
        this.agent.refresh();
        this.push('info', `✓ Manifest loaded: ${list.length} provider (${list.map((p) => p.name).join(', ')}).`);
        this.render();
      })
      .catch((e) => {
        this.push('error', 'Manifest failed: ' + e.message);
        this.render();
      });
  }

  _providerRefresh() {
    const url = manifestUrl();
    if (!url) return this.push('info', 'No manifest URL set yet. Set: /provider manifest <url>');
    fetchManifest(url)
      .then((list) => {
        this.agent.refresh();
        this.push('info', `✓ Manifest refreshed: ${list.length} provider.`);
        this.render();
      })
      .catch((e) => {
        this.push('error', 'Manifest failed: ' + e.message);
        this.render();
      });
  }

  _psLikeProviders() {
    for (const n of providerList()) {
      const info = providerInfo(n) || {};
      this.push('info', `  ${n.padEnd(12)} ${String(info.name || '').padEnd(18)} ${info.requiredKey ? '' : '(no key)'}`);
    }
  }

  _handleKey(key) {
    if (key === 'esc') {
      if (this.keyTarget !== 'ai') {
        this.keyTarget = 'ai';
        this.keyBuffer = '';
        this.mode = 'websearch';
        this._openWebSearch(true);
        return;
      }
      if (this.firstRun) {
        this.mode = 'chat';
        this.push('info', 'API key setup skipped. Use /s to configure it later.');
        this.render();
      } else {
        this.mode = 'settings';
      }
      return;
    }
    if (key === 'backspace') {
      this.keyBuffer = this.keyBuffer.slice(0, -1);
      return;
    }
    if (key === 'enter') {
      if (!this.keyBuffer) return;
      if (this.keyTarget === 'ws-limit') {
        const n = parseInt(this.keyBuffer, 10);
        if (!Number.isFinite(n) || n < 1 || n > 20) {
          this.push('info', 'Limit must be a number 1-20.');
          this.keyBuffer = '';
          return;
        }
        setWebsearch({ maxPerRun: n });
        this.keyTarget = 'ai';
        this.keyBuffer = '';
        this.mode = 'websearch';
        this._openWebSearch(true);
        return;
      }
      if (this.keyTarget === 'ws-key') {
        const ws = getWebsearch();
        setWebsearch({ apiKeys: { [ws.provider]: this.keyBuffer } });
        this.push('info', `Web search API key saved for ${ws.provider}: ${maskKey(this.keyBuffer)}`);
        this.keyTarget = 'ai';
        this.keyBuffer = '';
        this.mode = 'websearch';
        this._openWebSearch(true);
        return;
      }
      const provider = this.cfg().provider;
      setKey(provider, this.keyBuffer);
      this.agent.refresh();
      this.push('info', `API key saved for ${provider}: ${maskKey(this.keyBuffer)}`);
      this.keyBuffer = '';
      this.firstRun = false;
      this.mode = 'settings';
      this.settingsIdx = 2;
      return;
    }
    if (key === 'ctrl+v') {
      const txt = this._clipboardPasteText();
      if (txt) this.keyBuffer += txt;
      return;
    }
    if (key && key.paste != null) { this.keyBuffer += key.paste.replace(/[\r\n]+/g, ''); return; }
    if (key.ch) this.keyBuffer += key.ch;
  }

  _handleModel(key) {
    if (key === 'esc') {
      this.mode = 'settings';
      this.settingsIdx = 2;
      return;
    }
    if (this.modelLoading) return;
    if (key === 'backspace') {
      this.modelFilter = this.modelFilter.slice(0, -1);
      this._applyFilter();
      return;
    }
    if (key === 'up') {
      if (this.modelFiltered.length) this.modelIdx = (this.modelIdx - 1 + this.modelFiltered.length) % this.modelFiltered.length;
      return;
    }
    if (key === 'down') {
      if (this.modelFiltered.length) this.modelIdx = (this.modelIdx + 1) % this.modelFiltered.length;
      return;
    }
    if (key === 'enter') {
      const pick = this.modelFiltered[this.modelIdx];
      if (!pick) return;
      setModel(this.cfg().provider, pick);
      this.agent.refresh();
      this.push('info', `Active model: ${pick}`);
      this.mode = 'settings';
      this.settingsIdx = 2;
      return;
    }
    if (key === 'ctrl+v') {
      const txt = this._clipboardPasteText();
      if (txt) {
        this.modelFilter += txt;
        this._applyFilter();
      }
      return;
    }
    if (key && key.paste != null) {
      this.modelFilter += key.paste.replace(/[\r\n]+/g, '');
      this._applyFilter();
      return;
    }
    if (key.ch) {
      this.modelFilter += key.ch;
      this._applyFilter();
    }
  }

  _applyFilter() {
    const f = this.modelFilter.toLowerCase();
    this.modelFiltered = f ? this.modelList.filter((m) => m.toLowerCase().includes(f)) : this.modelList;
    this.modelIdx = 0;
  }

  _hints() {
    const map = {
      chat: `${key('Enter')}${lbl(' send ')} · ${key('↑↓/PgUp')}${lbl(' scroll ')} · ${key('Ctrl+B')}${lbl(' side')} · ${key('Ctrl+R')}${lbl(' relax')} · ${key('Ctrl+S')}${lbl(' set')} · ${key('Esc')}${lbl(' stop')}`,
      settings: `${key('↑↓')} select  ${key('Enter')} open  ${key('Esc')} back`,
      provider: `${key('↑↓')} select provider  ${key('Enter')} use  ${key('Esc')} cancel`,
      key: `${key('Enter')} save  ${key('Esc')} cancel  ${key('Backspace')} delete`,
      model: `${key('↑↓')} select  ${key('type')} filter  ${key('Enter')} set  ${key('Esc')} cancel`,
      quick: `${key('↑↓')} select model  ${key('type')} filter  ${key('Enter')} use  ${key('Esc')} cancel`,
      websearch: `${key('↑↓')} select  ${key('Enter')} change  ${key('←→')} provider/limit  ${key('Esc')} back`,
      theme: `${key('↑↓')} select  ${key('Enter')} apply  ${key('Esc')} back`,
      dev: `${key('Esc')} back`,
      split: `${key('↑↓')} scroll  ${key('Tab')} next file  ${key('Esc')} close`,
      find: this.find
        ? `${this.find.matches.length ? p(C.green, `${this.find.cur + 1}/${this.find.matches.length}`) + '  ' : ''}${key('n')} next  ${key('N')} prev  ${key('type')} refine  ${key('Esc')} close`
        : '',
      todo: `${key('Enter')} toggle  ${key('x')} delete  ${key('↑↓')} select  ${key('q/Esc')} back`,
      sessions: `${key('↑↓')} select  ${key('Enter')} load  ${key('n')} new  ${key('s')} save  ${key('d')} delete  ${key('q/Esc')} back`,
      help: `${key('↑↓')} scroll  ${key('Esc')} back`,
    };
    return map[this.mode] || '';
  }

  _title() {
    const map = {
      chat: 'Chat',
      settings: 'Settings',
      provider: 'Select Provider',
      key: this.keyHeader || 'Input API Key',
      model: 'Select Model',
      quick: 'Switch Model (Ctrl+P)',
      find: 'Find',
      theme: 'Theme',
      dev: 'About',
      split: 'Split Diff',
      palette: 'Command Palette (Ctrl+K)',
      websearch: 'Web Search',
      todo: 'Todo',
      sessions: 'Saved Sessions',
      help: 'Help',
    };
    return map[this.mode] || this.mode;
  }

  // Chip git branch (dari .git/HEAD) — di-cache 2 dtk agar render streaming murah.
  _gitChip() {
    const now = Date.now();
    if (this._gitCache && now - (this._gitCacheAt || 0) < 2000) return this._gitCache;
    let out = '';
    try {
      const root = (this.agent && this.agent.vfs && this.agent.vfs.root) || process.cwd();
      const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
      const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      const branch = m ? m[1] : head.slice(0, 7);
      if (branch) out = chip(`⎇ ${branch}`, C.slate);
    } catch {}
    this._gitCache = out;
    this._gitCacheAt = now;
    return out;
  }

  // Chip meter konteks — di-cache 800 ms agar render streaming murah.
  _ctxChip() {
    const now = Date.now();
    if (this._ctxCache && now - (this._ctxCacheAt || 0) < 800) return this._ctxCache;
    let out = '';
    try {
      const c = this.agent && typeof this.agent.contextTokens === 'function' ? this.agent.contextTokens() : null;
      if (c && c.budget) {
        const pct = Math.max(0, Math.min(100, Math.round((c.used / c.budget) * 100)));
        const cells = 5;
        const filled = Math.round((pct / 100) * cells);
        const bar = '▓'.repeat(filled) + '░'.repeat(Math.max(0, cells - filled));
        const col = pct >= 85 ? C.red : pct >= 60 ? C.yellow : C.green;
        out = chip(`ctx ≈${bar} ${pct}%`, col);
      }
    } catch {}
    this._ctxCache = out;
    this._ctxCacheAt = now;
    return out;
  }

  // State maskot: sibuk → aksi berjalan; kalau tidak, terakhir error/jawaban/idle.
  _mascotState() {
    if (this.busy) return this.currentAction || 'thinking';
    for (let i = this.transcript.length - 1; i >= 0 && i >= this.transcript.length - 3; i--) {
      const t = this.transcript[i];
      if (!t) continue;
      if (t.type === 'error') return 'error';
      if (t.type === 'ai') return 'done';
    }
    return 'idle';
  }

  render() {
    if (this.closed) return;
    const cols = Math.max(40, process.stdout.columns || 80);
    const rows = Math.max(12, process.stdout.rows || 30);
    const cfg = this.cfg();

    const lines = [];
    // SATU baris header: maskot + brand (tiap huruf beda warna) di kiri;
    // status, sesi, indikator, dan info model di kanan.
    // (git branch & ctx meter sengaja tidak ditampilkan — dianggap kurang guna.)
    let brand, statusTag, q, autoTag, tabStrip, noKey, updChip, right, headerLineChar;
    if (this.relaxMode) {
      brand = `${p(C.violet + C.bold, UI_SYMBOLS.relax)} ${p(C.muted, 'RELAX')}`;
      statusTag = this.busy ? p(C.cyan, UI_SYMBOLS.dot + ' ' + this.status) : p(C.green, UI_SYMBOLS.dot);
      right = `${statusTag} ${p(C.dim, UI_SYMBOLS.sep + ' z to exit')}`;
      headerLineChar = p(C.dim, '─');
    } else {
      brand = `${mascotBadge(this._mascotState())} ${brandArt('NTVGraph x Niyusha')}`;
      if (this.busy) {
        const spin = this._spinFrames[Math.floor(Date.now() / 120) % this._spinFrames.length];
        const pulse = Math.floor(Date.now() / 500) % 2 === 0 ? C.cyan : C.blue;
        statusTag = `${p(pulse, UI_SYMBOLS.dot + ' ' + this.status)} ${p(C.cyan, spin)}${p(C.dim, ' ' + bounceDots())}`;
      } else {
        statusTag = p(C.green, UI_SYMBOLS.dot + ' ready');
      }
      q = this.queue.length ? chip(`${UI_SYMBOLS.queue} ${this.queue.length} queued`, C.teal) : '';
      autoTag = this.autoMode ? chip(UI_SYMBOLS.auto, C.sky + C.bold) : '';
      tabStrip =
        (this.recentSessions || []).length > 1
          ? ` ${p(C.dim, UI_SYMBOLS.tab)} ${this.recentSessions
            .slice(0, 9)
            .map((id, i) => (id === this.shell.sessionId ? p(C.cyan + C.bold, String(i + 1)) : p(C.dim, String(i + 1))))
            .join(' ')}`
          : '';
      noKey = cfg.providerInfo && cfg.providerInfo.requiredKey && !cfg.apiKey ? chip(UI_SYMBOLS.warn + ' no API key', C.red + C.bold) : '';
      updChip = this._updateShown ? chip(`${UI_SYMBOLS.up} v${this._updateShown} out`, C.green + C.bold) : '';
      right = `${statusTag} ${chip(this.shell.sessionId, C.teal)}${updChip}${noKey}${q}${autoTag}${tabStrip} ${chip(sanitizeText(cfg.provider), C.slate)} ${p(C.dim, UI_SYMBOLS.sep)} ${p(C.orange + C.bold, sanitizeText(cfg.model))}`.trimEnd();
      headerLineChar = null;
    }
    if (this.relaxMode) {
      lines.push('');
    } else {
      lines.push(row(brand, right, cols));
      lines.push(headerLineChar ? p(C.dim, headerLineChar.repeat(cols)) : gradientLine('─', cols));
    }

    const isChat = this.mode === 'chat';
    const isFind = this.mode === 'find';
    // Footer (garis + input + bar bawah) hanya se-lebar kolom chat saat
    // sidebar tampil; sidebar diteruskan sampai baris terakhir layar.
    const useSide = (isChat || isFind) && this.showSidebar;
    const chatW = useSide ? this._chatWidth(cols) : cols;
    const sideW = useSide ? cols - 1 - chatW : 0;
    const inputArea = isChat ? this._inputArea(chatW) : null;
    // Mode find menampilkan chat + highlight (bukan body mode biasa).
    // Chat: tanpa garis pemisah di atas box input (box input sudah cukup)
    // → tinggi = header(2) + inputH + bar(1). Find: garis + hints (2 baris).
    const bodyRows = isChat
      ? Math.max(3, rows - 4 - (inputArea ? inputArea.height : 2))
      : Math.max(3, rows - 4);

    // Body selalu diisi tepat bodyRows baris supaya footer (garis + input + hint)
    // menempel di dasar layar, bukan mengambang di tengah.
    let body = isChat || isFind ? this._chatWithSidebar(cols, bodyRows) : this._body(cols, bodyRows);
    body = body.slice(0, bodyRows);
    while (body.length < bodyRows) body.push('');
    lines.push(...body);

    // Footer dipotong selebar kolom chat; sidebar diteruskan ke bawah
    // (baris kosong kalau konten sidebar sudah habis).
    const sideRest = this._sideRest || [];
    let restIdx = 0;
    const footRow = (left) => {
      if (!useSide) return left;
      const sideLine = sideRest[restIdx++] || '';
      return padLine(left, chatW) + p(C.gray, '│') + padLine(this.relaxMode ? this._relaxPaint(sideLine) : sideLine, sideW);
    };
    if (isChat) {
      // Mode chat: tanpa garis pemisah — box input langsung menempel di body.
      const inputLines = inputArea ? inputArea.lines : [''];
      for (const l of inputLines) lines.push(footRow(l));
      // Baris spasi agar input tidak mepet langsung ke bottom bar / footer.
      lines.push(footRow(''));
      lines.push(footRow(this._bottomBar(chatW)));
    } else {
      lines.push(footRow(gradientLine('─', chatW)));
      lines.push(footRow(this._hints()));
    }

    const frame = lines.slice(0, rows).map((l) => padLine(l, cols)).join('\n');
    // ?25l: pastikan cursor tetap tersembunyi walau child process (clipboard)
    // sempat menampilkannya kembali.
    process.stdout.write('\x1b[?25l\x1b[H' + frame + '\x1b[J');
  }

  _body(cols, bodyRows) {
    if (this.mode === 'settings') return this._bodySettings(cols, bodyRows);
    if (this.mode === 'theme') return this._bodyTheme(cols, bodyRows);
    if (this.mode === 'dev') return this._bodyDev(cols, bodyRows);
    if (this.mode === 'split') return this._bodySplit(cols, bodyRows);
    if (this.mode === 'palette') return this._bodyPalette(cols, bodyRows);
    if (this.mode === 'provider') return this._bodyProvider(cols, bodyRows);
    if (this.mode === 'customslot') return this._bodyCustomSlot(cols, bodyRows);
    if (this.mode === 'key') return this._bodyKey(cols, bodyRows);
    if (this.mode === 'model') return this._bodyModel(cols, bodyRows);
    if (this.mode === 'quick') return this._bodyQuick(cols, bodyRows);
    if (this.mode === 'websearch') return this._bodyWebSearch(cols, bodyRows);
    if (this.mode === 'todo') return this._bodyTodo(cols, bodyRows);
    if (this.mode === 'sessions') return this._bodySessions(cols, bodyRows);
    if (this.mode === 'help') return this._bodyHelp(cols, bodyRows);
    return [];
  }

  _chatWidth(cols) {
    // Lebar sidebar: override manual (this._sideW) menang atas auto 20%.
    let sideW = this._sideW > 0 ? this._sideW : Math.max(20, Math.min(40, Math.round(cols * 0.2)));
    if (cols - 1 - sideW < 36) sideW = Math.max(16, cols - 1 - 36);
    return cols - 1 - sideW;
  }

  // Lebar pane chat yang benar-benar dipakai _chatWithSidebar: saat sidebar
  // disembunyikan, sisakan 1 kolom untuk scrollbar mini.
  _chatPaneWidth(cols) {
    return this.showSidebar ? this._chatWidth(cols) : cols - 1;
  }

  // Ubah lebar sidebar dengan `[` / `]` (saat input kosong & sidebar tampil).
  // Disimpan ke config supaya bertahan antar-sesi.
  _resizeSidebar(delta) {
    const cols = Math.max(40, process.stdout.columns || 80);
    const cur = this._sideW > 0 ? this._sideW : Math.max(20, Math.min(40, Math.round(cols * 0.2)));
    const min = 16;
    const max = Math.max(min, cols - 1 - 36);
    const next = Math.max(min, Math.min(max, cur + delta));
    if (next === this._sideW) return;
    this._sideW = next;
    try {
      saveConfig({ sidebarWidth: next });
    } catch {}
    this.render();
  }

  // Scroll sidebar (kolom kanan) dengan `{` / `}` — konten yang panjang
  // (mis. banyak todo) bisa digulir sampai bawah.
  _scrollSide(delta) {
    const total = this._sideTotal || 0;
    const rows = this._sideRows || 0;
    const maxStart = Math.max(0, total - rows);
    const next = Math.min(maxStart, Math.max(0, (this.sideScroll || 0) + delta));
    if (next === this.sideScroll) return;
    this.sideScroll = next;
    this.render();
  }

  _chatBaseRows(chatW) {
    const version = this._transcriptVersion || 0;
    const theme = this._themeVersion || 0;
    if (this._chatCache && this._chatCache.chatW === chatW && this._chatCache.version === version && this._chatCache.theme === theme) {
      return this._chatCache.rows;
    }
    const inner = Math.max(10, chatW - 10);
    const rowsAll = [];
    let lastWasUser = false;
    let lastDay = null;
    // Bubble chat: border membulat + aksen glow.
    // Lebar SELALU turunan chatW (sudah dikurangi sidebar aktif) supaya tidak
    // melebihi contentW = chatW - 2 di _chatWithSidebar.
    const pushBubble = (accent, head, timeStr, bodyLines, bg, opts = {}) => {
      const bw = Math.max(12, chatW - 6);
      let h = head;
      let ts = timeStr || '';
      const wrapW = Math.max(8, bw - 4);
      const lines = bodyLines.length ? bodyLines : [' '];
      // Tanpa border: cukup label + baris konten (latar tetap seperti utama).
      if (opts.border === false) {
        rowsAll.push('  ' + p(accent + C.bold, h) + (ts ? p(C.dim, '  ' + ts) : ''));
        lines.forEach((ln) => rowsAll.push('  ' + ln));
        return bw;
      }
      const hwOf = () => dispWidth(h) + (ts ? 1 + dispWidth(ts) : 0);
      if (bw - 2 - hwOf() < 3) ts = '';
      if (bw - 2 - hwOf() < 3) h = truncateDisp(h, Math.max(4, bw - 5));
      const fill = bw - 2 - hwOf();
      rowsAll.push(
        p(accent, '╭') + p(accent + C.bold, h) + (ts ? p(C.dim, ' ' + ts) : '') + p(accent, '─'.repeat(fill) + '╮')
      );
      lines.forEach((ln) => {
        const padw = Math.max(0, wrapW - visibleLen(ln));
        rowsAll.push(p(accent, '│ ') + (bg || '') + ln + ' '.repeat(padw) + C.reset + p(accent, ' │'));
      });
      rowsAll.push(p(accent, '╰' + '─'.repeat(bw - 2) + '╯'));
      return bw;
    };
    // Baris alur tool/hasil: indent 2 kolom + lebar konten SAMA dengan bubble AI
    // (aiW = chatW - 10) lalu dirapikan (justify) sehingga rata kiri-kanan.
    const toolW = Math.max(8, chatW - 10);
    const flowRows = (marker, text) => {
      const mW = dispWidth(stripAnsi(marker));
      const bodyW = Math.max(8, toolW - mW);
      const wrapped = wrap(String(text == null || text === '' ? ' ' : text), bodyW);
      return wrapped.map((ln, k) => ({
        plain: k < wrapped.length - 1 ? justifyLine(ln, bodyW) : ln,
        first: k === 0,
      }));
    };
    const flowCont = (mW) => ' '.repeat(2 + mW);
    for (let ti = 0; ti < this.transcript.length; ti++) {
      const t = this.transcript[ti];
      // Pemisah hari (Today / tanggal) — ala WhatsApp/Slack, rata tengah.
      if (t.ts) {
        const day = new Date(t.ts).toDateString();
        if (day !== lastDay) {
          lastDay = day;
          const label = day === new Date().toDateString() ? 'Today' : day;
          const sep = `─── ${label} ───`;
          const pad = Math.max(0, Math.floor((chatW - 4 - dispWidth(sep)) / 2));
          if (rowsAll.length) rowsAll.push('');
          rowsAll.push(p(C.dim, ' '.repeat(pad) + sep));
          rowsAll.push('');
        }
      }
      const style = TYPE_STYLE[t.type] || TYPE_STYLE.info;
      if (t.type === 'user') {
        if (lastWasUser === false && rowsAll.length && rowsAll[rowsAll.length - 1] !== '') rowsAll.push('');
        lastWasUser = true;
      } else if (lastWasUser) {
        rowsAll.push('');
        lastWasUser = false;
      }
      // Pesan user & jawaban AI digabung per-run (tiap baris disimpan terpisah
      // di transcript) → satu bubble utuh, lebarnya mengikuti chatW/sidebar.
      if (t.type === 'user' || t.type === 'ai') {
        const run = [t];
        while (ti + 1 < this.transcript.length && this.transcript[ti + 1].type === t.type) run.push(this.transcript[++ti]);
        const bw = Math.max(12, chatW - 6);
        const wrapW = Math.max(8, bw - 4);
        const timeStr = t.ts ? new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        if (t.type === 'user') {
          const text = run.map((g) => sanitizeText(g.text || '')).join('\n');
          const wrapped = wrap(text, wrapW);
          wrapped.forEach((ln, i) => {
            if (i === 0) {
              const ts = timeStr ? ` ${p(C.dim, '· ' + timeStr)}` : '';
              rowsAll.push(`  ${p(C.orange, ln)}${ts}`);
            } else {
              rowsAll.push(`  ${p(C.orange, ln)}`);
            }
          });
        } else {
          // Bubble borderless: teks lebar konten tapi sisakan jarak kanan
          // (konten = chatW-2; aiW = chatW-10 -> sisa ~6 kolom sebelum pemisah).
          const aiW = Math.max(8, chatW - 10);
          const bodyLines = [];
          run.forEach((g, gi) => {
            if (gi) bodyLines.push('');
            renderMarkdownBlock(sanitizeText(g.text || ''), aiW).forEach((ln) => bodyLines.push(ln));
          });
          if (t.continuation) {
            if (rowsAll.length && rowsAll[rowsAll.length - 1] !== '') rowsAll.push('');
            bodyLines.forEach((ln) => rowsAll.push('  ' + ln));
          } else {
            pushBubble(C.violet, chatIconLabel(this.cfg().icon, 'niyusha'), timeStr, bodyLines, null, { border: false });
          }
          rowsAll.push('');
        }
        continue;
      }
      if (t.type === 'code' || t.type === 'reasoning') {
        if (rowsAll.length && rowsAll[rowsAll.length - 1] !== '') rowsAll.push('');
        const body = sanitizeText(t.text || '');
        const lineCount = body === '' ? 0 : body.split('\n').length;

        if (t.type === 'reasoning') {
          const REASON_MAX = 8;
          const collapsed = !t.expanded && lineCount > REASON_MAX;
          const icon = '◐';
          const meta = lineCount > 1 ? `${lineCount} lines` : '';
          const headerIcon = p(C.violet + C.bold, icon);
          const headerText = p(C.muted, 'reasoning');
          const headerMeta = meta ? p(C.muted, ` · ${meta}`) : '';
          const expandHint = collapsed ? p(C.dim, ` · +${lineCount - REASON_MAX} · [e] expand`) : '';
          rowsAll.push(`  ${headerIcon} ${headerText} ${headerMeta}${expandHint}`);
          const lines = body.split('\n');
          const shown = collapsed ? lines.slice(-REASON_MAX) : lines;
          const wrapped = [];
          shown.forEach(l => {
            const segs = wrap(l === '' ? ' ' : l, inner - 4);
            segs.forEach((seg, si) => {
              const words = seg.trim().split(/\s+/).filter(Boolean).length;
              const shouldJust = si < segs.length - 1 && words >= 7;
              const fmt = shouldJust ? justifyLine(seg, inner - 4) : seg;
              wrapped.push(fmt);
            });
          });
          wrapped.forEach(ln => {
            rowsAll.push(`  ${p(C.border, '│')} ${p(C.muted, ln)}`);
          });
          rowsAll.push('');
          continue;
        }

        const title = t.lang || 'code';
        const color = C.orange;
        let box;
        if (isDiffText(body, t.lang)) {
          const collapsed = !t.expanded && lineCount > 16;
          const border = t.approval ? C.orange : t.approved === true ? C.success : t.approved === false ? C.red : C.border;
          box = boxedDiffLines(body, chatW - 6, title, { maxRows: collapsed ? 12 : 0, tail: false, border });
        } else {
          const collapsed = !t.expanded && lineCount > 16;
          box = boxedLines(body, chatW - 6, title, color, { maxRows: collapsed ? 12 : 0, tail: false, numbers: true, meta: collapsed ? `${lineCount} lines · [e] expand` : `${lineCount} lines`, lang: t.lang });
        }
        box.forEach((ln) => {
          rowsAll.push(`  ${ln}`);
        });
        if (t.approval) {
          rowsAll.push(`  ${p(C.orange + C.bold, '▶ awaiting decision')}`);
        } else if (t.approved === true) {
          rowsAll.push(`  ${p(C.success, '✓ approved')}`);
        } else if (t.approved === false) {
          rowsAll.push(`  ${p(C.red, '✗ rejected')}`);
        }
        continue;
      }
      if (t.type === 'table') {
        const tbl = {
          header: (t.table.header || []).map(sanitizeText),
          rows: (t.table.rows || []).map((r) => r.map(sanitizeText)),
        };
        renderTable(tbl, inner).forEach((ln) => rowsAll.push('  ' + ln));
        continue;
      }
      // ── Box notifikasi update npm — border hijau, kontras dengan chat ──
      if (t.type === 'update') {
        if (rowsAll.length && rowsAll[rowsAll.length - 1] !== '') rowsAll.push('');
        const CW = Math.max(20, chatW - 12);
        const bodyLines = [];
        for (const para of sanitizeTrusted(t.text || '').split('\n')) {
          wrap(para === '' ? ' ' : para, CW).forEach((ln) => bodyLines.push(ln));
        }
        rowsAll.push(p(C.green, '  ╭' + '─'.repeat(CW + 2) + '╮'));
        for (const ln of bodyLines) {
          const pad = Math.max(0, CW - dispWidth(stripAnsi(ln)));
          rowsAll.push(p(C.green, '  │ ') + p(C.heading + C.bold, ln) + (pad ? ' '.repeat(pad) : '') + p(C.green, ' │'));
        }
        rowsAll.push(p(C.green, '  ╰' + '─'.repeat(CW + 2) + '╯'));
        rowsAll.push('');
        continue;
      }
      // ── Step timeline: aktivitas tool (● node) + hasil (│ ↳ cabang) ──
      // Hunian panjang dilipat: 2 baris awal + penanda + 7 baris terakhir.
      // Detail utuh di transkrip & Tool log sidebar; /copy tetap penuh.
      if (t.type === 'tool' || t.type === 'result') {
        const group = [];
        while (ti < this.transcript.length && (this.transcript[ti].type === 'tool' || this.transcript[ti].type === 'result')) {
          group.push({ g: this.transcript[ti], idx: ti });
          ti++;
        }
        ti--;
        const gLines = [];
        for (const { g, idx } of group) {
          if (g.type === 'tool') {
            const full = sanitizeText(g.text || '');
            const name = full.split(/\s+/)[0] || 'tool';
            const rest = sanitizeText(formatToolArgs(full.slice(name.length).trim()));
            const next = this.transcript[idx + 1];
            const dur = next && next.ts && g.ts ? next.ts - g.ts : 0;
            const durTag = dur > 50 && dur < 600000 ? ` · ${dur >= 1000 ? (dur / 1000).toFixed(1) + 's' : dur + 'ms'}` : '';
            const plain = name + (rest ? ' ' + rest : '') + durTag;
            for (const r of flowRows('● ', plain)) {
              if (!r.first) {
                gLines.push(flowCont(2) + p(C.dim, r.plain));
                continue;
              }
              const nm = r.plain.slice(0, name.length);
              gLines.push('  ' + p(C.violet + C.bold, '● ') + p(C.bold + C.heading, nm) + p(C.dim, r.plain.slice(name.length)));
            }
          } else {
            for (const r of flowRows('↳ ', sanitizeText(g.text || ' '))) {
              gLines.push((r.first ? '  ' + p(C.violet + C.dim, '↳ ') : flowCont(2)) + p(C.gray, r.plain));
            }
          }
        }
        const FOLD_MAX = 10;
        const groupId = group[0].idx;
        const isExpanded = this._expandedToolGroups.has(groupId);
        if (gLines.length > FOLD_MAX && !isExpanded) {
          const HEAD = 2;
          const TAIL = 7;
          const hidden = gLines.length - HEAD - TAIL;
          rowsAll.push(...gLines.slice(0, HEAD));
          rowsAll.push(p(C.dim, `  ⋯ +${hidden} lines folded (${group.length} tool steps) · [e] expand`));
          rowsAll.push(...gLines.slice(gLines.length - TAIL));
        } else {
          rowsAll.push(...gLines);
        }
        continue;
      }
      // ── Temuan sederhana (reasoning) — tetap terlihat di layar, tidak hilang ──
      if (t.type === 'reasoning') {
        if (rowsAll.length && rowsAll[rowsAll.length - 1] !== '') rowsAll.push('');
        const text = String(t.text || '');
        const wrapped = wrap(text, inner);
        const maxShow = 6;
        const shown = wrapped.slice(0, maxShow);
        shown.forEach((ln, i) => {
          rowsAll.push(i === 0 ? p(C.cyan + C.bold, '  💡 ') + p(C.cyan, ln) : ' '.repeat(6) + p(C.cyan, ln));
        });
        if (wrapped.length > maxShow) {
          rowsAll.push(' '.repeat(6) + p(C.dim, `… +${wrapped.length - maxShow} baris lain`));
        }
        rowsAll.push('');
        continue;
      }
      // Baris lain (info/error/queued) — polos dengan prefix gaya.
      const rawPrefix = style.prefix || '';
      const pad = rawPrefix ? dispWidth(stripAnsi(rawPrefix)) : style.pad == null ? 5 : style.pad;
      // Info/queued = milik TUI (boleh berisi warna p() sendiri) → sanitizeTrusted
      // mempertahankan SGR; error membawa konten eksternal → strip semua ESC.
      const body = t.type === 'error' ? sanitizeText(t.text || ' ') : sanitizeTrusted(t.text || ' ');
      const wrapped = wrap(body, inner);
      wrapped.forEach((ln, i) => {
        rowsAll.push(i === 0 ? style.prefix + p(style.color, ln) : ' '.repeat(pad) + p(style.color, ln));
      });
    }
    this._chatCache = { chatW, version, theme, rows: rowsAll };
    return rowsAll;
  }

  _relaxPaint(s) {
    const str = String(s || '');
    if (!this.relaxMode) return str;
    let painted = str.replace(/\x1b\[[0-9;]*m/g, (m) => {
      const n = parseInt(m.slice(2, -1), 10);
      const keep = n === 0 || n === 39 || n === 90 || n === 37 || n === 97;
      if (keep) return m;
      return '\x1b[90m';
    });
    if (/\b(?:y apply|a always|n reject)\b/.test(stripAnsi(painted))) {
      painted = colorizeAnsiText(painted, 'y apply', C.yellow + C.bold);
      painted = colorizeAnsiText(painted, 'a always', C.orange + C.bold);
      painted = colorizeAnsiText(painted, 'n reject', C.red + C.bold);
    }
    return painted;
  }

  _zenNoProvider() {
    const cfg = this.cfg();
    const preset = providerInfo(cfg.provider);
    return !!(preset && preset.requiredKey) && !cfg.apiKey;
  }

  _chatRows(chatW) {
    let rowsAll = this._chatBaseRows(chatW).slice();
    const inner = Math.max(10, chatW - 10);
    if (this.relaxMode) rowsAll = rowsAll.map((r) => this._relaxPaint(r));
    if (this.compactionLive) {
      const spin = ['◐','◑','◒','◓'][Math.floor(Date.now()/120)%4];
      const cl = this.compactionLive;
      const meta = cl.total ? ` · ${cl.phase} ${cl.current}/${cl.total}` : ` · ${cl.phase}`;
      rowsAll.push('');
      rowsAll.push(`  ${p(C.orange + C.bold, spin)} ${p(C.yellow + C.bold, 'Compaction')}${p(C.dim, meta)}${p(C.dim, ` · ${cl.elapsed}s`)}`);
      const detailLines = wrap(cl.detail, Math.max(10, inner - 4));
      rowsAll.push(`  ${p(C.border, '│')} ${p(C.muted, detailLines[0] || cl.detail)}`);
      rowsAll.push('');
    }
    if (this.live) {
      if (this.live.reasoning) {
        const spin = ['◐','◑','◒','◓'][Math.floor(Date.now()/120)%4];
        const headerIcon = p(C.violet + C.bold, spin);
        const headerText = p(C.muted, 'reasoning');
        const headerMeta = p(C.dim, ' · live thinking...');
        rowsAll.push(`  ${headerIcon} ${headerText} ${headerMeta}`);
        const lines = sanitizeText(this.live.reasoning).split('\n');
        const tailLines = lines.slice(-8);
        const wrapped = [];
        tailLines.forEach(l => {
          const segs = wrap(l === '' ? ' ' : l, inner - 4);
          segs.forEach(s => wrapped.push(s));
        });
        wrapped.forEach(ln => {
          rowsAll.push(`  ${p(C.border, '│')} ${p(C.muted, ln)}`);
        });
        rowsAll.push('');
      }
      if (this.live.text) {
        const caret = this.busy ? '▍' : '';
        const parts = splitStream(sanitizeText(this.live.text));
        parts.forEach((part, pi) => {
          const last = pi === parts.length - 1;
          if (part.type === 'code') {
            if (rowsAll.length && rowsAll[rowsAll.length - 1] !== '') rowsAll.push('');
            const title = part.lang || 'code';
            const box = isDiffText(part.text, part.lang)
              ? boxedDiffLines(part.text, chatW - 8, title, { maxRows: 12, tail: true })
              : boxedLines(part.text, chatW - 8, title, C.orange, { maxRows: 12, tail: true, numbers: true, lang: part.lang });
            box.forEach((ln, i) => rowsAll.push(i === 0 ? p(C.orange, '  </> ') + ln : '      ' + ln));
          } else if (part.text.trim() || (last && caret)) {
            const text = part.text + (last ? caret : '');
            renderMarkdownBlock(text, inner).forEach((ln) => rowsAll.push(p(C.violet, '│ ') + ln));
          }
        });
      }
    }
    // ── Area findings permanen: temuan sederhana tanpa box, bersih ──
    if (this.findings && this.findings.length) {
      rowsAll.push('');
      rowsAll.push(p(C.yellow + C.bold, '📋 Temuan sederhana:'));
      this.findings.forEach((f) => {
        const wrapped = wrap(f, inner);
        wrapped.forEach((ln, k) => {
          rowsAll.push((k === 0 ? '  • ' : '    ') + p(C.yellow, ln));
        });
      });
    }
    return rowsAll;
  }

  _chatLines(chatW, bodyRows) {
    const rowsAll = this._chatRows(chatW);
    const total = rowsAll.length;
    if (bodyRows === Infinity) return rowsAll;

    // Jaga posisi baca: saat konten tumbuh dan user sedang scroll ke atas,
    // geser scroll sebanyak pertumbuhan supaya tampilan tidak meluncur.
    if (this.scroll > 0 && this._lastRowCount != null) this.scroll += total - this._lastRowCount;
    this._lastRowCount = total;
    const maxScroll = this._maxScrollFor(total, bodyRows);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));

    // Dasar chat: sisakan ruang napas di bawah pesan terakhir supaya tidak
    // mepet garis/input. History TIDAK dipotong — hanya viewport digeser naik
    // beberapa baris saat posisi scroll berada di paling bawah.
    if (this.scroll === 0 && total > bodyRows) {
      const pad = Math.min(3, Math.max(1, bodyRows - 3));
      let contentRows = Math.max(1, bodyRows - pad); // kapasitas isi (marker + konten)
      let start = Math.max(0, total - contentRows);
      const win = [];
      if (start > 0) {
        contentRows = Math.max(1, contentRows - 1); // sisakan 1 baris untuk penanda ↑
        start = Math.max(0, total - contentRows);
        win.push(p(C.gray, `  ↑ ${start} earlier · PgUp`));
      }
      win.push(...rowsAll.slice(start, total));
      this._win = { start, end: total, total };
      while (win.length < bodyRows) win.push('');
      return win;
    }

    const end = total - this.scroll;
    let showBot = end < total;
    let showTop = false;
    let cap = Math.max(1, bodyRows - (showBot ? 1 : 0));
    if (end - cap > 0) {
      showTop = true;
      cap = Math.max(1, cap - 1);
    }
    const start = Math.max(0, end - cap);
    const win = rowsAll.slice(start, end);
    this._win = { start, end, total };
    if (showTop && start > 0) win.unshift(p(C.gray, `  ↑ ${start} earlier · PgUp`));
    if (showBot && end < total) win.push(p(C.gray, `  ↓ ${total - end} newer · PgDn`));
    return win;
  }

  // Sparkline aktivitas token (blok 8-level; warna mengikuti tingkat).
  _sampleSpark(used, w) {
    if (!this._spark) this._spark = [];
    if (this._sparkAt !== used) {
      this._spark.push(used);
      if (this._spark.length > 40) this._spark.shift();
      this._sparkAt = used;
    }
    const arr = this._spark;
    if (arr.length < 2) return null;
    const width = Math.max(6, Math.min(w, 36));
    const max = Math.max(...arr, 1);
    const BLOCKS = '▁▂▃▄▅▆▇█';
    const data = arr.slice(-width);
    let out = '';
    const pad = width - data.length;
    if (pad > 0) out += p(C.dim, '▁'.repeat(pad));
    for (const v of data) {
      const lvl = Math.max(0, Math.min(7, Math.round((v / max) * 7)));
      const color = lvl <= 2 ? C.teal : lvl <= 4 ? C.sky : lvl <= 6 ? C.yellow : C.red;
      out += p(color, BLOCKS[lvl]);
    }
    return out;
  }

  _sidebarLines(sideW) {
    const w = Math.max(10, sideW - 2);
    const out = [];
    const hits = [];
    this._sideHits = hits;
    out.push(' ' + p(C.gray, `Niyusha v${this.version}`));
    if (this.autoMode) out.push(' ' + p(C.cyan + C.bold, '⚡ autonomous on · /auto off'));
    try {
      const note = readNote((this.agent.vfs && this.agent.vfs.root) || '/');
      if (note) out.push(' ' + p(C.gray, `📝 note · ${note.length} B`));
    } catch {}
    const info = this._contextInfo();
    const todos = this._todos();
    const done = todos.filter((t) => t.done || t.status === 'completed').length;
    const pct = Math.round(((info.budget ? info.used / info.budget : 0) * 100));

    const su = this._sessionUsage();
    const t = this._usageTokens(su);
    out.push(' ' + sec('Context estimate', p(C.gray, 'budget'), w));
    out.push(' ' + p(C.reset, `≈${fmtTok(info.used)} / ${fmtTok(info.budget)} tokens`));
    out.push(' ' + tokenBar(info.used, info.budget, Math.max(4, w - 2)));
    const spark = this._sampleSpark(info.used, Math.max(10, w - 9));
    if (spark) out.push(' ' + p(C.dim, 'trend ') + spark);
    const compactionStats = this.agent.compactionStats ? this.agent.compactionStats() : null;
    const compactionOutcome = compactionStats && compactionStats.outcome;
    const totalComp = (compactionStats && compactionStats.compactions) || info.compactions || 0;
    const autoComp = (compactionStats && compactionStats.autoCompactions) || 0;
    const manualComp = Math.max(0, totalComp - autoComp);
    const lastTag = compactionStats && compactionStats.lastTrigger ? ` · last ${compactionStats.lastTrigger}` : '';
    const compCountTag = totalComp > 0 ? `summarized ${totalComp}x${autoComp > 0 ? ` · auto ${autoComp}x` : ''}${manualComp > 0 ? ` · manual ${manualComp}x` : ''}${lastTag} · ` : '';
    const mem = this.agent.summary ? p(C.yellow, compCountTag) : '';
    const mode = compactionStats ? compactionStats.mode : '';
    const modeTag = mode ? p(C.dim, `[${mode}] `) : '';
    const lat = this._lastLatency != null ? ` · ${p(C.teal, fmtLatency(this._lastLatency))}` : '';
    const ctxLine = `${modeTag}${mem}${pct}% budget · ${info.msgs ? `${info.msgs} msgs` : 'system+tools'}${lat}`;
    for (const ln of wrap(ctxLine, w)) out.push(' ' + p(C.dim, ln));
    if (compactionOutcome && !['completed', 'skipped'].includes(compactionOutcome.status)) {
      const prog = compactionOutcome.status === 'running' ? compactionOutcome.progress : null;
      const progTag = prog
        ? (prog.total ? ` (${prog.label || prog.phase} ${prog.current}/${prog.total})` : ` (${prog.label || prog.phase})`)
        : '';
      const title = compactionOutcome.status === 'validation_failed'
        ? `${compactionOutcome.trigger === 'auto' ? 'Auto ' : ''}compaction guard: validation failed`
        : compactionOutcome.status === 'running'
          ? `Compaction: running${progTag}`
          : `Compaction: ${compactionOutcome.trigger === 'auto' ? 'auto ' : ''}failed`;
      const detail = compactionOutcome.reason ? ` — ${sanitizeText(compactionOutcome.reason)}` : '';
      const statusText = `${title}${detail}`;
      const statusColor = compactionOutcome.status === 'validation_failed' ? C.yellow : C.red;
      for (const line of wrap(statusText, Math.max(8, w - 1))) {
        out.push(' ' + p(statusColor, line));
      }
    }
    if (this.cfg().showCost) {
      const cost = this._sessionCost(su);
      out.push(' ' + p(C.gray, cost == null ? 'estimated cost n/a' : `~$${cost.toFixed(2)} est. cost`));
    }
    if (info.window) {
      const autoCheck = compactionStats && compactionStats.auto && mode !== 'off'
        ? ` · auto trigger ≈${fmtTok(Math.floor(info.budget * (this.agent && Number(this.agent._autoCompactThreshold) ? this.agent._autoCompactThreshold : 0.45)))}`
        : '';
      for (const ln of wrap(`window ${fmtTok(info.window)}${autoCheck}`, w)) out.push(' ' + p(C.gray, ln));
    }
    out.push('');
    out.push(' ' + sec('Session', p(C.gray, `${su.requests} req${su.estimated ? ` · ${su.estimated} est` : ''}`), w));
    if (!su.requests) {
      out.push(' ' + p(C.dim, 'no requests yet'));
    } else {
      const cache = t.cacheRead ? ` · cache-read ${fmtTok(t.cacheRead)} ⊂ input` : '';
      const sessLine = `${su.estimated ? '≈' : ''}${fmtTok(t.equivalent)} in+out tokens · in ${fmtTok(t.prompt)}${cache} · out ${fmtTok(t.completion)}`;
      for (const line of wrap(sessLine, w)) out.push(' ' + p(C.reset, line));
    }
    out.push('');
    out.push(' ' + sec('Todo', p(C.gray, `${done}/${todos.length}`), w));
    if (!todos.length) {
      out.push(' ' + p(C.dim, '(no tasks yet)'));
    } else {
      todos.slice(0, 20).forEach((t, ti) => {
        const isDone = t.done || t.status === 'completed';
        const inProgress = t.status === 'in_progress';
        const mark = isDone ? p(C.green, '[x]') : inProgress ? p(C.yellow, '[~]') : p(C.dim, '[ ]');
        const taskText = sanitizeText(t.text == null ? '' : t.text);
        // Prefix checkbox hanya di baris pertama; baris wrap = indent 5 kolom.
        for (const [li, ln] of wrap(taskText, Math.max(8, w - 5)).entries()) {
          hits.push({ row: out.length, kind: 'todo', idx: ti });
          out.push((li === 0 ? ' ' + mark + ' ' : ' '.repeat(5)) + p(isDone ? C.gray : inProgress ? C.bold : C.reset, ln));
        }
      });
    }
    out.push(' ' + p(C.gray, '/todo add <task>'));
    out.push('');
    const pending = this.agent.vfs && typeof this.agent.vfs.hasPending === 'function' ? this.agent.vfs.pendingChanges() : [];
    if (pending.length) {
      hits.push({ row: out.length, kind: 'diff' });
      out.push(' ' + sec('Staging', p(C.yellow, `${pending.length}`), w));
      for (const c of pending.slice(0, 6)) {
        const tag = c.op === 'create' ? p(C.green, 'C') : c.op === 'delete' ? p(C.red, 'D') : p(C.yellow, 'M');
        for (const ln of wrap(c.path, w - 5)) out.push('  ' + p(C.dim, tag) + ' ' + p(C.gray, ln));
      }
      if (pending.length > 6) out.push(' ' + p(C.gray, `+${pending.length - 6} more`));
      if (this.awaitingApproval) out.push(' ' + p(C.yellow, 'menunggu: /apply | /reject'));
      else out.push(' ' + p(C.gray, '/apply | /reject'));
      out.push('');
    }
    out.push(' ' + sec('Workspace', p(C.gray, 'root'), w));
    const root = this.agent.vfs ? this.agent.vfs.root : (this.shell.root || this.shell.cwd || '/');
    for (const ln of wrap(root, w)) out.push(' ' + p(C.dim, ln));
    out.push('');
    out.push(' ' + sec('Tools', p(C.gray, `${this._toolsList().length}`), w));
    const toolsLine = this._toolsList().join(', ');
    for (const ln of wrap(toolsLine, w)) out.push(' ' + p(C.gray, ln));
    out.push('');
    const logs = this.toolLog || [];
    if (logs.length) {
      out.push(' ' + sec('Tool log', p(C.gray, `${logs.length}`), w));
      for (const lg of logs.slice(-6).reverse()) {
        const logLine = sanitizeText(`${lg.name} ${lg.summary || ''}`);
        for (const ln of wrap(logLine, w)) out.push('  ' + p(C.gray, ln));
      }
      out.push('');
    }
    out.push(' ' + p(C.dim, '· run_command = real shell'));
    out.push(' ' + p(C.dim, '  permission rules allow/ask/deny.'));
    out.push(' ' + p(C.dim, '  configure: /perm'));
    return out;
  }

  _toolsList() {
    const t = this.agent && Array.isArray(this.agent.tools) ? this.agent.tools : [];
    return t.map((x) => (x && x.function && x.function.name) || '').filter(Boolean);
  }

  // Mini scrollbar di tepi kanan pane chat (kolom pemisah). Track `│` redup,
  // thumb `┃` terang mengikuti posisi viewport. Hanya muncul saat konten
  // melebihi tinggi pane (tidak ada overflow → garis pemisah biasa).
  _scrollbarChar(row, bodyRows, track = '│') {
    const w = this._win;
    if (!w || !(w.total > bodyRows)) return p(C.gray, track);
    const maxScroll = this._maxScrollFor(w.total, bodyRows);
    const frac = maxScroll > 0 ? Math.min(1, Math.max(0, (maxScroll - this.scroll) / maxScroll)) : 1;
    const len = Math.max(1, Math.round((bodyRows * bodyRows) / w.total));
    const top = Math.round(frac * Math.max(0, bodyRows - len));
    return row >= top && row < top + len ? p(C.sky, '┃') : p(C.gray, track);
  }

  _chatWithSidebar(cols, bodyRows) {
    const gutter = '  ';
    const useSide = this.showSidebar;
    // Saat sidebar disembunyikan, sisakan 1 kolom tepi untuk mini scrollbar.
    const chatW = this._chatPaneWidth(cols);
    const sideW = useSide ? cols - 1 - chatW : 0;
    const contentW = chatW - gutter.length;
    const chatLines = this._chatLines(chatW, bodyRows);
    let sideLines = [];
    let sideStart = 0;
    if (useSide) {
      const full = this._sidebarLines(sideW);
      const total = full.length;
      const maxStart = Math.max(0, total - bodyRows);
      this.sideScroll = Math.min(Math.max(0, this.sideScroll || 0), maxStart);
      sideStart = this.sideScroll;
      sideLines = full.slice(sideStart, sideStart + bodyRows);
      if (sideStart > 0) sideLines[0] = ' ' + p(C.cyan, '↑ more above — { or Alt+↑');
      if (sideStart + bodyRows < total) sideLines[sideLines.length - 1] = ' ' + p(C.cyan, '↓ more below — } or Alt+↓');
      this._sideTotal = total;
      this._sideRows = bodyRows;
      this._sideStart = sideStart;
      // Sisa sidebar setelah bodyRows — dipakai render() untuk meneruskan
      // kolom sidebar melewati footer sampai baris terakhir layar.
      this._sideRest = full.slice(sideStart + bodyRows);
    } else {
      this._sideTotal = 0;
      this._sideRows = 0;
      this._sideStart = 0;
      this._sideRest = [];
    }
    const out = [];
    const leftPlain = [];
    for (let i = 0; i < bodyRows; i++) {
      let contentRaw = chatLines[i] || '';
      // Sorot hasil pencarian (mode find) sebelum padding.
      if (this.mode === 'find' && this.find && this.find.q) {
        const absRow = (this._win ? this._win.start : 0) + i;
        const isCur = this.find.matches[this.find.cur] === absRow;
        contentRaw = highlightAnsi(contentRaw, stripAnsi(contentRaw), this.find.q, isCur);
      }
      const content = padLine(contentRaw, contentW);
      const plain = stripAnsi(content);
      leftPlain.push(plain);
      const hl = this.selection ? this._highlightRow(plain, i, contentW) : null;
      const left = gutter + (hl || content);
      // Saat sidebar disembunyikan, tepi kanan blank (track `' '`) supaya tidak
      // ada garis nyasar; thumb `┃` tetap muncul kalau chat overflow.
      const scrollbar = this._scrollbarChar(i, bodyRows, useSide ? '│' : ' ');
      const paintedScrollbar = this.relaxMode ? this._relaxPaint(scrollbar) : scrollbar;
      const sideContent = useSide ? padLine(this.relaxMode ? this._relaxPaint(sideLines[i] || '') : (sideLines[i] || ''), sideW) : '';
      out.push(left + paintedScrollbar + sideContent);
    }
    const hasTop = useSide && (this._sideStart || 0) > 0;
    const hasBottom = useSide && (this._sideStart || 0) + bodyRows < (this._sideTotal || 0);
    this._view = {
      bodyStart: 2, // header kini 2 baris: brand + garis gradient
      bodyRows,
      contentW,
      gutterLen: gutter.length,
      leftPlain,
      chatW,
      sideX: useSide ? gutter.length + contentW + 1 : null,
      sideHits: useSide
        ? (this._sideHits || [])
          .map((h) => ({ ...h, row: h.row - (this._sideStart || 0) }))
          .filter((h) => h.row >= 0 && h.row < sideLines.length && !(h.row === 0 && hasTop) && !(h.row === sideLines.length - 1 && hasBottom))
        : [],
    };
    return out;
  }

  _inputRows(cols) {
    const width = Math.max(20, cols - 4);
    const cps = [...this.input];
    const curCp = Math.max(0, Math.min(this.cursor ?? cps.length, cps.length));
    if (!cps.length) return { width, rows: [{ start: 0, end: 0, text: '' }], cur: { row: 0, col: 0 } };
    const rows = [];
    let row = [];
    let w = 0;
    let start = 0;
    let rowIdx = 0;
    let cur = null;
    const flush = () => rows.push({ start, end: start + row.length, text: row.join('') });
    for (let i = 0; i <= cps.length; i++) {
      if (i === curCp && cur === null) cur = { row: rowIdx, col: row.length };
      if (i === cps.length) break;
      const ch = cps[i];
      if (ch === '\n') {
        flush();
        row = [];
        w = 0;
        start = i + 1;
        rowIdx++;
        continue;
      }
      const cw = dispWidth(ch);
      if (row.length && w + cw > width) {
        flush();
        row = [];
        w = 0;
        start = i;
        rowIdx++;
      }
      row.push(ch);
      w += cw;
    }
    if (row.length) flush();
    else if (!rows.length) rows.push({ start: 0, end: 0, text: '' });
    else if (cps[cps.length - 1] === '\n') rows.push({ start: cps.length, end: cps.length, text: '' });
    if (cur === null) cur = { row: rows.length - 1, col: row.length };
    return { width, rows, cur };
  }

  _inputArea(cols) {
    const { width, rows, cur } = this._inputRows(cols);
    const MINH = 2;
    const MAXH = 5;
    const H = Math.min(MAXH, Math.max(MINH, rows.length));
    const winStart = Math.max(0, cur.row - (H - 1));
    const shown = rows.slice(winStart, winStart + H);
    while (shown.length < H) shown.push({ start: 0, end: 0, text: '' });
    const cps = [...this.input];
    const qArea = this._queueArea(cols);
    if (this.relaxMode) {
      const mark = this.busy ? p(C.cyan, '> ') : this._zenNoProvider() ? p(C.red, '> ') : p((C.brightGreen || C.green) + C.bold, '> ');
      const phText = cps.length === 0 ? truncateDisp('ask niyusha...', Math.max(4, width - 4)) : '';
      const out = shown.map((r, i) => {
        const abs = winStart + i;
        let inner;
        if (abs !== cur.row) {
          if (abs >= rows.length) return '';
          const lead = i === 0 && winStart > 0 ? p(C.dim, '… ') : '  ';
          inner = lead + r.text;
        } else {
          const cs = cps.slice(r.start, r.start + cur.col);
          const cc = cps[r.start + cur.col] || ' ';
          const ca = cps.slice(r.start + cur.col + 1, r.end);
          const ph = phText ? p(C.dim, phText) : '';
          if (cps.length === 0) {
            inner = mark + ph;
          } else {
            inner = mark + p(C.reset, cs.join('')) + p(C.inverse, cc) + p(C.reset, ca.join(''));
          }
        }
        return '  ' + inner;
      });
      return { lines: [...qArea.lines, ...out], height: H + qArea.height };
    }
    const mark = this.busy ? p(C.cyan, '· ') : this._zenNoProvider() ? p(C.red, '· ') : p((C.brightGreen || C.green) + C.bold, '> ');
    const phText = cps.length === 0 ? truncateDisp('Ask Niyusha anything…', Math.max(4, width - 4)) : '';
    const out = shown.map((r, i) => {
      const abs = winStart + i;
      let inner;
      if (abs !== cur.row) {
        if (abs >= rows.length) return '';
        const lead = i === 0 && winStart > 0 ? p(C.dim, '… ') : '  ';
        inner = lead + r.text;
      } else {
        const cs = cps.slice(r.start, r.start + cur.col);
        const cc = cps[r.start + cur.col] || ' ';
        const ca = cps.slice(r.start + cur.col + 1, r.end);
        const ph = phText ? p(C.dim, phText) : '';
        if (cps.length === 0) {
          inner = mark + ph;
        } else {
          inner = mark + p(C.heading, cs.join('')) + p((C.brightGreen || C.green) + C.inverse, cc) + p(C.heading, ca.join(''));
        }
      }
      return '  ' + inner;
    });
    return { lines: [...qArea.lines, ...out], height: H + qArea.height };
  }

  // Pesan antre ditampilkan mengambang di atas input (bukan di transcript),
  // supaya tidak tertutup pekerjaan LLM yang sedang berjalan.
  _queueArea(cols) {
    if (!this.queue || !this.queue.length) return { lines: [], height: 0 };
    const width = Math.max(20, cols - 6);
    const MAX = 3;
    const lines = [];
    lines.push(' ' + p(C.teal + C.bold, `⏳ ${this.queue.length} queued`) + p(C.dim, ' · terkirim otomatis saat AI siap (2×Enter = hentikan & kirim)'));
    for (const e of this.queue.slice(0, MAX)) {
      const txt = String(e.text).replace(/\n/g, ' ⏎ ');
      lines.push('   ' + p(C.dim, (wrap(txt, width)[0] || '').slice(0, width)));
    }
    if (this.queue.length > MAX) lines.push('   ' + p(C.gray, `+${this.queue.length - MAX} more queued`));
    return { lines, height: lines.length };
  }

  _bottomBar(cols) {
    if (this.relaxMode) {
      const state = this.awaitingPermission
        ? 'waiting for permission'
        : this.awaitingApproval
          ? 'waiting for diff decision'
          : this.awaitingPlan
            ? 'waiting for plan decision'
            : this.busy
              ? (this.currentAction && this.currentAction !== 'thinking' ? this.currentAction : this.status || 'thinking')
              : this.queue && this.queue.length
                ? `ready · ${this.queue.length} queued`
                : 'ready';
      const credit = p(C.gray, cols < 56 ? 'Niyusha' : CREDIT_TEXT);
      const stateWidth = Math.max(5, cols - visibleLen(credit) - 7);
      const ready = state === 'ready';
      const activityColor = ready ? C.gray : (C.heading + (this.busy || this.awaitingPermission || this.awaitingApproval || this.awaitingPlan ? C.bold : ''));
      const activity = p(activityColor, `AI · ${truncateDisp(state, stateWidth)}`);
      let left = credit;
      const sep = p(C.gray, ' · ');
      const actLen = visibleLen(activity);
      if (visibleLen(left) + 2 + visibleLen(sep) + actLen > cols) left = truncateDisp(left, Math.max(0, cols - 2 - visibleLen(sep) - actLen));
      return left + sep + '  ' + activity;
    }
    const info = this._contextInfo();
    const todos = this._todos();
    const done = todos.filter((t) => t.done).length;
    const pct = Math.round((info.budget ? info.used / info.budget : 0) * 100);
    const right = p(C.dim, `${this._title()} · ctx ≈${fmtTok(info.used)}/${fmtTok(info.budget)} (${pct}%) · todo ${done}/${todos.length}`);
    // Bar butuh-keputusan dapat latar oranye penuh supaya mata langsung
    // tertuju ke sana (izin shell & approval staged).
    if (this.awaitingPermission) {
      const isPath = this.permReq && this.permReq.type === 'path';
      const buf = this.permBuf ? `  ${p(C.heading, '› ' + this.permBuf)}${p(C.gray, '▍')}` : '';
      const choices = this.permReq && this.permReq.alwaysConfirm
        ? `${p(C.green + C.bold, 'y')} once  ${p(C.red + C.bold, 'n/Esc')} deny`
        : `${p(C.green + C.bold, 'y')} once  ${p(C.cyan + C.bold, 'a')} session  ${p(C.green + C.bold, 'w')} always  ${p(C.red + C.bold, 'n/Esc')} deny`;
      const left =
        `${p(C.bold + C.heading, isPath ? '📁 path permission' : '🔐 shell permission')}  ` +
        `${choices}` +
        `  ${p(C.dim, '· or type ok/ya/no')}${buf}`;
      return rowBg(left, right, cols, C.orangeBg);
    }
    if (this.awaitingApproval) {
      const left =
        `${p(C.bold + C.heading, '⧗ awaiting decision')}  ` +
        `${p(C.yellow + C.bold, 'y')} apply  ${p(C.orange + C.bold, 'a')} always  ${p(C.red + C.bold, 'n')} reject  ` +
        `${p(C.dim, '· or type (/apply /reject)')}`;
      return rowBg(left, right, cols, C.orangeBg);
    }
    // Kalau hints + info tidak muat (terutama sidebar aktif → chat sempit),
    // jangan buang info kanan (mode · ctx · todo): turunkan hints dulu —
    // ringkas, lalu dipotong. Info kanan selalu tampil utuh.
    const hints = this._hints();
    const r = visibleLen(right);
    if (visibleLen(hints) + r + 2 <= cols) return row(hints, right, cols);
    // Ctrl+S set WAJIB selalu terlihat — degrade: ringkas → mid → micro (Ctrl+S saja).
    const short = `${key('Enter')}${lbl(' send ')} · ${key('Esc')}${lbl(' stop ')} · ${key('Ctrl+B')}${lbl(' side')} · ${key('Ctrl+R')}${lbl(' relax')} · ${key('Ctrl+S')}${lbl(' set')} · ${key('Ctrl+P')}${lbl(' model')}`;
    if (visibleLen(short) + r + 2 <= cols) return row(short, right, cols);
    const mid = `${key('Ctrl+B')}${lbl(' side')} · ${key('Ctrl+R')}${lbl(' relax')} · ${key('Ctrl+S')}${lbl(' set')} · ${key('Ctrl+P')}${lbl(' model')}`;
    if (visibleLen(mid) + r + 2 <= cols) return row(mid, right, cols);
    const micro = `${key('Ctrl+S')} set`;
    if (visibleLen(micro) + r + 2 <= cols) return row(micro, right, cols);
    // Ekstrem sempit: info kanan dipadatkan supaya Ctrl+S tetap muat.
    const rightTiny = p(C.dim, `${this._title()} c${fmtTok(info.used)}/${fmtTok(info.budget)} ${pct}% · ${done}/${todos.length}`);
    if (visibleLen(micro) + visibleLen(rightTiny) + 2 <= cols) return row(micro, rightTiny, cols);
    return row(micro, '', cols);
  }

  _bodySettings(cols, bodyRows) {
    const cfg = this.cfg();
    const items = this.settingsItems(cfg);
    const out = ['', p(C.bold, '  Niyusha — Settings'), ''];
    // Hit-test untuk klik mouse: baris body → indeks item.
    const hits = [];
    items.forEach((it, i) => {
      hits.push({ row: out.length, idx: i });
      const sel = i === this.settingsIdx;
      const marker = sel ? p(C.cyan, ' ► ') : '   ';
      const label = it.label.padEnd(12);
      const rawValue = it.value == null ? '' : sanitizeText(it.value);
      const value = rawValue ? (sel ? p(C.bold, rawValue) : p(C.dim, rawValue)) : '';
      out.push(`  ${marker}${sel ? p(C.cyan, label) : label}${value ? ' ' + value : ''}`);
    });
    this._settingsHits = hits;
    out.push('');
    out.push(p(C.dim, '  All changes are saved automatically to ' + require('./config').CONFIG_FILE));
    return out.slice(0, bodyRows);
  }

  _bodyProvider(cols, bodyRows) {
    const names = providerList();
    const keys = loadConfig().apiKeys || {};
    const out = ['', p(C.bold, '  Select AI provider'), ''];
    const listRows = Math.max(3, bodyRows - out.length - 2);
    const win = windowedList(names, this.providerIdx, listRows);
    win.items.forEach((name, i) => {
      const abs = win.start + i;
      const sel = abs === this.providerIdx;
      const pre = sel ? p(C.cyan, ' \u25b8 ') : '   ';
      const title = sanitizeText(name).padEnd(11);
      const info = providerInfo(name) || {};
      let keyState;
      if (providerDisabled(name)) keyState = p(C.red + C.bold, 'OFF');
      else if (info.sponsored) keyState = p(C.green + C.bold, '🎁 FREE (sponsored)');
      else if (!info.requiredKey) keyState = p(C.green, 'no key (keyless)');
      else if (keys[name]) keyState = p(C.green, 'key ✓');
      else if (info.keyEnv && process.env[info.keyEnv]) keyState = p(C.green, 'env ✓');
      else keyState = p(C.yellow, 'needs key');
      const note = info.freeNote ? ' ' + p(C.dim, sanitizeText(info.freeNote)) : '';
      const off = providerDisabled(name);
      out.push(`  ${pre}${sel ? p(C.bold + C.cyan, title) : (off ? p(C.dim, title) : title)} ${p(C.dim, sanitizeText(info.name || name).padEnd(20))} ${keyState}${note}`);
    });
    out.push('');
    out.push(p(C.dim, '  Enter the key right after selecting a provider.'));
    return out.slice(0, bodyRows);
  }

  _bodyCustomSlot(cols, bodyRows) {
    const step = this.customSlotStep || 0;
    const labels = ['Provider name', 'Base URL', 'Model (optional)'];
    const out = [
      '',
      p(C.bold, '  Custom slot'),
      '',
      `  step     : ${p(C.cyan, `${step + 1}/3 - ${labels[step]}`)}`,
      `  name     : ${p(C.dim, sanitizeText(this.customSlotData && this.customSlotData.name ? this.customSlotData.name : ''))}`,
      `  base URL : ${p(C.dim, sanitizeText(this.customSlotData && this.customSlotData.baseUrl ? this.customSlotData.baseUrl : ''))}`,
      `  model    : ${p(C.dim, sanitizeText(this.customSlotData && this.customSlotData.model ? this.customSlotData.model : ''))}`,
      '',
      `  ${p(C.green, '>')} ${this.customSlotBuffer ? p(C.green, sanitizeText(this.customSlotBuffer)) : p(C.dim, 'type here')}${p(C.cyan, '_')}`,
      '',
      p(C.dim, '  Enter continue/save  |  Backspace delete  |  Esc cancel'),
    ];
    return out.slice(0, bodyRows);
  }

  _bodyKey(cols, bodyRows) {
    const cfg = this.cfg();
    const n = this.keyBuffer.length;
    const masked = n
      ? `${'*'.repeat(Math.min(n, 32))}${n > 32 ? '...' : ''} ${p(C.dim, `(${n} chars)`)}`
      : p(C.dim, '(not set)');
    const out = [
      '',
      p(C.bold, '  ' + sanitizeText(this.keyHeader || 'Input API Key')),
      '',
      `  provider : ${p(C.cyan, sanitizeText(cfg.provider))}`,
      `  base url : ${p(C.dim, sanitizeText(cfg.baseUrl))}`,
      `  model    : ${p(C.dim, sanitizeText(cfg.model))}`,
      '',
      `  ${p(C.green, '>')} ${this.keyBuffer ? p(C.green, masked) : p(C.dim, 'paste key here')}${p(C.cyan, '_')}`,
      '',
      p(C.dim, '  Keys are stored per provider in ' + require('./config').CONFIG_FILE),
      p(C.dim, '  Ctrl+V paste  |  Enter save  |  Esc cancel'),
    ];
    return out.slice(0, bodyRows);
  }

  _bodyModel(cols, bodyRows) {
    const out = ['', p(C.bold, '  Select model')];
    out.push(p(C.dim, `  provider: ${sanitizeText(this.cfg().provider)}` + (this.modelFilter ? `  filter: "${sanitizeText(this.modelFilter)}"` : '')));
    out.push('');
    if (this.modelLoading) {
      out.push('  ' + p(C.yellow, '⟳ loading models from provider...'));
      return out.slice(0, bodyRows);
    }
    if (this.modelError) {
      out.push('  ' + p(C.red, '! ' + sanitizeText(this.modelError)));
      out.push(p(C.dim, '  Esc to go back.'));
      return out.slice(0, bodyRows);
    }
    if (!this.modelFiltered.length) {
      out.push('  ' + p(C.yellow, 'no matching models.'));
      return out.slice(0, bodyRows);
    }
    const listRows = Math.max(3, bodyRows - out.length - 2);
    const win = windowedList(this.modelFiltered, this.modelIdx, listRows);
    win.items.forEach((m, i) => {
      const abs = win.start + i;
      const sel = abs === this.modelIdx;
      const pre = sel ? p(C.cyan, ' ► ') : '   ';
      const mark = m === this.cfg().model ? p(C.green, ' (active)') : '';
      const label = sanitizeText(m);
      out.push(`  ${pre}${sel ? p(C.bold, label) : label}${mark}`);
    });
    out.push('');
    out.push(p(C.dim, `  ${this.modelIdx + 1}/${this.modelFiltered.length} models`));
    return out.slice(0, bodyRows);
  }

  _bodyQuick(cols, bodyRows) {
    const cfg = this.cfg();
    const out = ['', p(C.bold, '  Quick switch model (all providers)')];
    out.push(p(C.dim, `  active: ${sanitizeText(cfg.provider)} · ${sanitizeText(cfg.model)}` + (this.quickFilter ? `   filter: "${sanitizeText(this.quickFilter)}"` : '')));
    out.push('');
    if (this.quickLoading) {
      out.push('  ' + p(C.yellow, '⟳ loading models from all configured providers...'));
      return out.slice(0, bodyRows);
    }
    if (this.quickError) {
      out.push('  ' + p(C.red, '! ' + sanitizeText(this.quickError)));
      out.push(p(C.dim, '  Esc to go back.'));
      return out.slice(0, bodyRows);
    }
    if (!this.quickFiltered.length) {
      out.push('  ' + p(C.yellow, 'no matching models.'));
      return out.slice(0, bodyRows);
    }
    const listRows = Math.max(3, bodyRows - out.length - 2);
    const win = windowedList(this.quickFiltered, this.quickIdx, listRows);
    let lastProvider = null;
    win.items.forEach((it, i) => {
      const abs = win.start + i;
      const sel = abs === this.quickIdx;
      if (it.provider !== lastProvider) {
        lastProvider = it.provider;
        out.push('  ' + p(C.gray, '┌ ' + sanitizeText((providerInfo(it.provider) || {}).name || it.provider)));
      }
      const pre = sel ? p(C.cyan, ' ► ') : '   ';
      const active = it.provider === cfg.provider && it.model === cfg.model;
      const mark = active ? p(C.green, ' (active)') : '';
      const label = sanitizeText(it.model);
      out.push(`  ${pre}${sel ? p(C.bold, label) : label}${mark}`);
    });
    out.push('');
    out.push(p(C.dim, `  ${this.quickIdx + 1}/${this.quickFiltered.length} models · ${providerList().length} providers`));
    return out.slice(0, bodyRows);
  }

}

function runTUI({ shell, agent, version, firstRun, onQuit, updateNotice }) {
  const tui = new TUI({ shell, agent, version, firstRun, updateNotice });
  tui._onQuit = onQuit;
  tui.start();
  return tui;
}

module.exports = {
  runTUI,
  TUI,
  parseKeys,
  hasPendingEscape,
  dispWidth,
  charWidths,
  truncateDisp,
  stripAnsi,
  sanitizeText,
  sanitizePasteText,
  wrap,
};
