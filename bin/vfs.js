/**
 * @fileoverview Virtual file system for staged edits
 *
 * @module vfs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const DEFAULT_CWD = '/';

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.cache',
  '.idea',
  '.vscode',
  '__pycache__',
  '.venv',
  'venv',
  '.niyusha',
]);

// Batas grep_search: lewati file terlalu besar / biner, batasi jumlah hasil.
// Output juga dibatasi per baris + total karakter supaya tidak membanjiri
// konteks (satu file minified bisa punya baris ratusan KB).
const GREP_MAX_FILE = 512 * 1024;
const GREP_MAX_RESULTS = 300;
const GREP_MAX_LINE = 240;
const GREP_MAX_CHARS = 5000;
const FILES_CACHE_TTL = 750;
// Batas snapshot undo efek shell: file lebih besar dari ini dilewati, dan
// total byte per snapshot dibatasi supaya workspace besar (GIS/dataset) tidak
// menyalin GB berulang-ulang. Bisa di-override lewat config.
const UNDO_MAX_FILE_BYTES = 64 * 1024 * 1024;
const UNDO_MAX_TOTAL_BYTES = 1000 * 1024 * 1024;
const GREP_SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
  '.pdf', '.zip', '.gz', '.tgz', '.tar', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.sqlite', '.db',
]);

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern) {
  // Escape literal regex chars DULU (kecuali * dan ?), baru ubah wildcard.
  // Urutan lama (wildcard dulu) ikut meng-escape bracket hasil konversi
  // sehingga pola seperti "bin/*.js" tidak pernah cocok.
  const rx = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0002')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0002/g, '(?:.*/)?')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${rx}$`, 'i');
}

function normalize(target, cwd = DEFAULT_CWD) {
  const t = String(target == null ? '' : target);
  const base = t.startsWith('/') ? '' : cwd;
  const parts = `${base}/${t}`.split('/');
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return '/' + stack.join('/');
}

function resolveWorkspace(input) {
  const dir = input ? path.resolve(input) : process.cwd();
  if (!fs.existsSync(dir)) throw new Error(`Workspace tidak ditemukan: ${dir}`);
  if (!fs.statSync(dir).isDirectory()) throw new Error(`Workspace bukan direktori: ${dir}`);
  return dir;
}

class VirtualFS {
  constructor(sessionId = 'default', root = process.cwd(), opts = {}) {
    this.sessionId = sessionId;
    this.root = path.resolve(root);
    this.overlay = new Map();
    this.outsideAllow = [];
    this.undoFile = opts && opts.undoFile ? opts.undoFile : null;
    this.snapshots = this._loadUndo();
    this.redoStack = [];
  }

  _loadUndo() {
    let arr = [];
    if (this.undoFile) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.undoFile, 'utf8'));
        if (Array.isArray(parsed)) arr = parsed.slice(0, 20);
      } catch {
        arr = [];
      }
    }
    this.snapshots = arr;
    this._pruneSnapshots();
    this._cleanupOrphanUndoDirs();
    this._gcUndoObjects();
    return this.snapshots;
  }

  _persistUndo() {
    if (!this.undoFile) return false;
    try {
      if (this.snapshots && this.snapshots.length > 20) {
        // Entri tertua dibuang beserta dir backup-nya (kalau snapshot workspace).
        const removed = this.snapshots.splice(0, this.snapshots.length - 20);
        for (const r of removed) this._dropSnapshotDir(r);
      }
      fs.mkdirSync(path.dirname(this.undoFile), { recursive: true });
      fs.writeFileSync(this.undoFile, JSON.stringify(this.snapshots || []));
      this._gcUndoObjects();
      return true;
    } catch {}
    return false;
  }

  // Snapshot workspace disimpan sebagai copy file nyata di
  // <undoDir>/ws/<workspace-key>/ (bukan JSON). Dipisah per workspace supaya
  // cleanup satu workspace tidak pernah menghapus snapshot workspace lain.
  undoDirBase() {
    if (!this.undoFile) return null;
    const key = path.basename(this.undoFile, '.json').replace(/^undo_/, '') || 'root';
    return path.join(path.dirname(this.undoFile), 'ws', key);
  }

  _dropSnapshotDir(snap) {
    if (snap && snap.kind === 'workspace' && snap.dir) {
      try {
        fs.rmSync(snap.dir, { recursive: true, force: true });
      } catch {}
    }
  }

  _pruneSnapshots() {
    if (!Array.isArray(this.snapshots)) this.snapshots = [];
    // Maks 5 snapshot workspace — yang tertua dibuang beserta dir backupnya.
    const ws = this.snapshots.filter((s) => s && s.kind === 'workspace');
    if (ws.length > 5) {
      const drop = ws.slice(0, ws.length - 5);
      for (const d of drop) this._dropSnapshotDir(d);
      this.snapshots = this.snapshots.filter((s) => !drop.includes(s));
    }
  }

  // Kumpulkan SEMUA snapshot workspace yang dirujuk manifest mana pun
  // (undo_*.json), bukan hanya workspace aktif. Tanpa ini, membuka workspace
  // lain akan menghapus snapshot workspace sebelumnya.
  _referencedUndoDirs(undoRoot) {
    const kept = new Set();
    let files = [];
    try {
      files = fs.readdirSync(undoRoot);
    } catch {
      return kept;
    }
    for (const f of files) {
      if (!/^undo_.+\.json$/i.test(f)) continue;
      try {
        const arr = JSON.parse(fs.readFileSync(path.join(undoRoot, f), 'utf8'));
        if (!Array.isArray(arr)) continue;
        for (const s of arr) {
          if (s && s.kind === 'workspace' && s.dir) kept.add(path.resolve(s.dir));
        }
      } catch {}
    }
    return kept;
  }

  // Hapus dir backup yang tidak direferensikan undo stack mana pun (sisa crash).
  // Layout baru: ws/<key>/<snapshot>/ (punya penanda .ws); layout lama:
  // ws/<snapshot>/ langsung di bawah ws/.
  _cleanupOrphanUndoDirs() {
    if (!this.undoFile) return;
    const undoRoot = path.dirname(this.undoFile);
    const wsRoot = path.join(undoRoot, 'ws');
    const kept = this._referencedUndoDirs(undoRoot);
    let entries = [];
    try {
      entries = fs.readdirSync(wsRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(wsRoot, e.name);
      if (fs.existsSync(path.join(dir, '.ws'))) {
        // Container per-workspace: prune snapshot di dalamnya saja.
        let subs = [];
        try {
          subs = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const s of subs) {
          if (!s.isDirectory()) continue;
          if (s.name === 'objects') continue;
          const snapDir = path.join(dir, s.name);
          if (kept.has(path.resolve(snapDir))) continue;
          try {
            fs.rmSync(snapDir, { recursive: true, force: true });
          } catch {}
        }
        continue;
      }
      // Layout lama: dir ini adalah snapshot; hapus hanya bila tak dirujuk.
      if (kept.has(path.resolve(dir))) continue;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }

  setRoot(root) {
    this.root = path.resolve(root);
    this.overlay.clear();
    this.invalidateFileCache();
  }

  // Tentukan scope sebuah path: di dalam workspace (staging) atau di luar (nyata).
  // mengembalikan { scope:'inside', vfs, real } atau { scope:'outside', real }
  resolveTarget(raw, cwd = DEFAULT_CWD) {
    const s = String(raw == null ? '' : raw).replace(/\\/g, '/').trim();
    const isHost = /^[a-zA-Z]:\//.test(s) || s.startsWith('//') || s.startsWith('\\\\');
    if (isHost) {
      const real = path.resolve(s);
      const root = this.root;
      if (real === root || real.startsWith(root + path.sep)) return { scope: 'inside', vfs: this._virtual(real), real };
      return { scope: 'outside', real };
    }
    const vfs = normalize(s, cwd);
    const real = this._realSafe(vfs);
    if (vfs === '/') return { scope: 'inside', vfs, real };
    // Heuristik: path abs host yang benar-benar ada tetapi di luar root
    // dianggap path nyata luar (agar berguna di POSIX/WSL juga), bukan VFS.
    if (s.startsWith('/')) {
      const abs = path.resolve(s);
      const root = this.root;
      // Path yang sudah diizinkan (sesi) → luar, walau file belum ada (mis. tulis file baru).
      if (this.isOutsideAllowed(abs)) return { scope: 'outside', real: abs };
      const inRoot = abs === root || abs.startsWith(root + path.sep);
      if (inRoot) return { scope: 'inside', vfs: this._virtual(abs), real: abs };
      // Path absolul host yang ada dan di luar root → nyata luar.
      if (fs.existsSync(abs)) return { scope: 'outside', real: abs };
    }
    return { scope: 'inside', vfs, real };
  }

  _realSafe(v) {
    try {
      return this._real(v);
    } catch {
      return null;
    }
  }

  isOutsideAllowed(real) {
    const r = path.resolve(real);
    return this.outsideAllow.some((p) => r === p || r.startsWith(p + path.sep));
  }

  allowOutside(real) {
    const r = path.resolve(real);
    if (!this.outsideAllow.includes(r)) this.outsideAllow.push(r);
  }

  _real(p) {
    const v = normalize(p);
    const real = path.resolve(this.root, '.' + v);
    if (real !== this.root && !real.startsWith(this.root + path.sep)) {
      throw new Error(`${v}: akses di luar workspace tidak diizinkan`);
    }
    return real;
  }

  _virtual(real) {
    const rel = path.relative(this.root, real);
    if (!rel) return '/';
    return '/' + rel.split(path.sep).join('/');
  }

  _realExists(v) {
    try {
      return fs.existsSync(this._real(v));
    } catch {
      return false;
    }
  }

  _realRead(v) {
    try {
      if (fs.statSync(this._real(v)).isDirectory()) return null;
    } catch {
      return null;
    }
    return fs.readFileSync(this._real(v), 'utf8');
  }

  _realIsFile(v) {
    try {
      return fs.statSync(this._real(v)).isFile();
    } catch {
      return false;
    }
  }

  _deletedAncestor(v) {
    let cur = v;
    while (cur && cur !== '/') {
      const e = this.overlay.get(cur);
      if (e && e.type === 'delete') return true;
      cur = cur.slice(0, cur.lastIndexOf('/')) || '/';
    }
    return false;
  }

  exists(p) {
    const v = normalize(p);
    const e = this.overlay.get(v);
    if (e) return e.type !== 'delete';
    if (this._deletedAncestor(v)) return false;
    return this._realExists(v);
  }

  // Status perubahan untuk path ini: 'write' | 'delete' | 'mkdir' | null.
  // Dipakai tool agar bisa membedakan isi overlay (staged) dari file nyata.
  stagedState(p) {
    const v = normalize(p);
    const e = this.overlay.get(v);
    if (e) return e.type;
    return this._deletedAncestor(v) ? 'delete' : null;
  }

  isStaged(p) {
    return this.stagedState(p) !== null;
  }

  read(p) {
    const v = normalize(p);
    const e = this.overlay.get(v);
    if (e) {
      if (e.type === 'delete') throw new Error(`${v}: No such file or directory`);
      if (e.type === 'mkdir') throw new Error(`${v}: Is a directory`);
      return e.content;
    }
    if (this._deletedAncestor(v)) throw new Error(`${v}: No such file or directory`);
    const real = this._real(v);
    const st = fs.statSync(real);
    if (st.isDirectory()) throw new Error(`${v}: Is a directory`);
    return fs.readFileSync(real, 'utf8');
  }

  write(p, content) {
    const v = normalize(p);
    if (v === '/') throw new Error('path tidak valid: tidak boleh menulis ke root workspace');
    if (!this.overlay.has(v)) {
      let st = null;
      try {
        st = fs.statSync(this._real(v));
      } catch {}
      if (st && st.isDirectory()) throw new Error(`${v}: Is a directory`);
    }
    const existed = this.exists(v);
    this.overlay.set(v, { type: 'write', content: String(content) });
    return existed
      ? `staged update ${v} (${String(content).length} chars)`
      : `staged create ${v} (${String(content).length} chars)`;
  }

  editFile(p, oldStr, newStr, opts = {}) {
    const v = normalize(p);
    let content;
    try {
      content = this.read(v);
    } catch {
      throw new Error(`${v}: No such file or directory`);
    }
    const res = applyEdit(content, oldStr, newStr, opts.replace_all === true);
    if (res.status === 'notfound') {
      throw new Error(
        `old_str tidak ditemukan persis di ${v}. old_str harus identik (copy dari read_file).\n` +
          similarLines(content, oldStr) +
          '\nCek: akhir baris (CRLF vs LF), indentasi (tab vs spasi), dan spasi di ujung baris. Salin ulang lewat read_file.'
      );
    }
    if (res.status === 'ambiguous') {
      const locs = res.locations.map((n) => `Line ${n}`).join(', ');
      throw new Error(
        `old_str ditemukan ${res.count}x di ${v} — ambigu, tidak diganti. Tambahkan konteks (beberapa baris) agar unik, atau panggil ulang dengan replace_all: true.\nKemunculan: ${locs}`
      );
    }
    this.overlay.set(v, { type: 'write', content: res.content });
    return `staged edit ${v}${res.count > 1 ? ` (${res.count} tempat)` : ''}${res.viaEol ? ' [eol]' : ''}${res.viaTrim ? ' [trim]' : ''}`;
  }

  rename(oldP, newP) {
    const o = normalize(oldP);
    const n = normalize(newP);
    const content = this.read(o);
    this.overlay.set(o, { type: 'delete' });
    this.overlay.set(n, { type: 'write', content });
    return `staged rename ${o} -> ${n}`;
  }

  mkdir(p) {
    const v = normalize(p);
    if (this.exists(v)) return `${v}: already exists`;
    this.overlay.set(v, { type: 'mkdir' });
    return `staged directory ${v}`;
  }

  remove(p) {
    const v = normalize(p);
    if (!this.exists(v)) throw new Error(`${v}: No such file or directory`);
    if (v === '/') throw new Error('tidak boleh menghapus root workspace');
    const hadWrite = this.overlay.get(v);
    if (hadWrite && (hadWrite.type === 'write' || hadWrite.type === 'mkdir') && !this._realExists(v)) {
      this.overlay.delete(v);
    } else {
      this.overlay.set(v, { type: 'delete' });
    }
    for (const key of [...this.overlay.keys()]) {
      if (key.startsWith(v + '/')) this.overlay.delete(key);
    }
    return `staged remove ${v}`;
  }

  _mergedFiles() {
    // Cache: overlay kecil, jadi tanda-tangan murah. Hemat walk berulang
    // (grep/glob/tree beberapa kali dalam satu sesi).
    const sig = this.root + '#' + [...this.overlay.entries()].map(([k, e]) => k + ':' + ((e && e.type) || '')).sort().join('|');
    // TTL: file nyata bisa berubah di luar overlay (run_command / editor lain).
    // Tanpa batas waktu, daftar file basi sampai overlay berubah.
    if (this._filesCache && this._filesCache.sig === sig && Date.now() - this._filesCache.ts < FILES_CACHE_TTL) {
      return this._filesCache.list;
    }

    const set = new Set();
    const pushWalk = (startReal) => {
      const walk = (dir) => {
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (e.isSymbolicLink()) continue;
          const child = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (IGNORE_DIRS.has(e.name)) continue;
            walk(child);
          } else if (e.isFile()) {
            set.add(this._virtual(child));
          }
        }
      };
      walk(startReal);
    };
    pushWalk(this.root);
    for (const [v, e] of this.overlay) {
      if (e.type === 'write') set.add(v);
      if (e.type === 'delete') set.delete(v);
    }
    const out = [];
    for (const v of set) {
      if (this._deletedAncestor(v)) continue;
      out.push(v);
    }
    const sorted = out.sort();
    this._filesCache = { sig, ts: Date.now(), list: sorted };
    return sorted;
  }

  // Panggil setelah perubahan file nyata di luar overlay (mis. run_command).
  invalidateFileCache() {
    this._filesCache = null;
  }

  listDir(dir) {
    const v = normalize(dir);
    if (this._deletedAncestor(v)) throw new Error(`${v}: No such directory`);
    const seen = new Map();
    const real = this._real(v);
    if (fs.existsSync(real) && fs.statSync(real).isDirectory()) {
      let entries = [];
      try {
        entries = fs.readdirSync(real, { withFileTypes: true });
      } catch {}
      for (const e of entries) {
        const child = path.join(real, e.name);
        let size = 0;
        try {
          size = e.isDirectory() ? 0 : fs.statSync(child).size;
        } catch {}
        seen.set(e.name, { name: e.name, dir: e.isDirectory(), size, staged: false });
      }
    }
    const prefix = v === '/' ? '/' : v + '/';
    for (const [key, e] of this.overlay) {
      if (!key.startsWith(prefix)) continue;
      if (this._deletedAncestor(key)) continue;
      const rest = key.slice(prefix.length);
      if (!rest) continue;
      const idx = rest.indexOf('/');
      const name = idx === -1 ? rest : rest.slice(0, idx);
      if (e.type === 'delete') {
        if (idx === -1) seen.delete(name);
        continue;
      }
      if (idx === -1) {
        seen.set(name, e.type === 'mkdir'
          ? { name, dir: true, size: 0, staged: true }
          : { name, dir: false, size: e.content.length, staged: true });
      } else {
        const cur = seen.get(name);
        if (cur) cur.staged = true;
        else seen.set(name, { name, dir: true, size: 0, staged: true });
      }
    }
    return [...seen.values()].sort((a, b) =>
      a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1
    );
  }

  // Resolusi filter path grep ke scope nyata (prefix direktori / daftar file).
  // Menerima path VFS ("/src"), relatif ("./src"), path host Windows
  // ("D:\\...\\src"), atau pola glob ("src/*.js") — bukan substring lagi.
  _grepScope(pathFilter, files) {
    const raw = String(pathFilter == null ? '' : pathFilter).trim().replace(/\\/g, '/');
    if (!raw || raw === '/' || raw === '.' || raw === './') return { prefix: '' };
    let v;
    if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('//')) {
      const real = path.resolve(raw);
      if (real !== this.root && !real.startsWith(this.root + path.sep)) {
        return { error: `path di luar workspace: ${raw}` };
      }
      v = this._virtual(real);
    } else {
      // Path absolut host (POSIX) yang berada di dalam root → path VFS.
      const abs = path.resolve(raw);
      const inRoot = abs === this.root || abs.startsWith(this.root + path.sep);
      v = raw.startsWith('/') && inRoot ? this._virtual(abs) : normalize(raw, DEFAULT_CWD);
    }
    if (/[*?]/.test(v)) {
      const re = globToRegExp(v);
      const matched = files.filter((f) => re.test(f));
      if (!matched.length) return { error: `tidak ada file cocok dengan path "${raw}"` };
      return { files: new Set(matched) };
    }
    v = v.replace(/\/+$/, '') || '/';
    if (v === '/') return { prefix: '' };
    if (files.includes(v)) return { files: new Set([v]) };
    if (files.some((f) => f.startsWith(v + '/'))) return { prefix: v + '/' };
    // Fallback: nama file/folder tanpa path lengkap ("ai.js", "utils").
    const rel = v.replace(/^\//, '').toLowerCase();
    const seg = files.filter((f) => {
      const lf = f.toLowerCase();
      return lf.endsWith('/' + rel) || lf.includes('/' + rel + '/');
    });
    if (seg.length) return { files: new Set(seg) };
    const hint = files.filter((f) => f.toLowerCase().includes(rel)).slice(0, 3);
    return {
      error: `path "${raw}" tidak ditemukan di workspace${hint.length ? `. Mungkin maksud: ${hint.join(', ')}` : ''}`,
    };
  }

  grep(pattern, pathFilter, opts = {}) {
    const files = this._mergedFiles();
    const scope = this._grepScope(pathFilter, files);
    if (scope.error) return [`ERROR: ${scope.error}`];
    const raw = pattern == null ? '' : String(pattern);
    if (!raw.trim()) return ['ERROR: pola grep kosong — isi "pattern" dengan regex/teks yang dicari.'];
    const flags = opts.caseSensitive === true ? '' : 'i';
    let re;
    let literalNote = '';
    try {
      re = new RegExp(raw, flags);
    } catch {
      // Pola literal yang mengandung metachar (mis. "foo(") tidak boleh
      // menggagalkan pencarian — cari sebagai teks literal + beri catatan.
      re = new RegExp(escapeRegExp(raw), flags);
      literalNote = `[catatan: "${raw}" bukan regex valid — dicari sebagai teks literal]`;
    }
    const multiLine = /\\[nr]/.test(raw) || /[\r\n]/.test(raw);
    const out = [];
    const notes = [];
    let chars = 0;
    let skipped = 0;
    let truncated = false;
    if (literalNote) notes.push(literalNote);

    const clip = (s) => {
      const t = String(s).replace(/\r$/, '');
      if (t.length <= GREP_MAX_LINE) return t;
      return t.slice(0, GREP_MAX_LINE) + `…[+${t.length - GREP_MAX_LINE} char]`;
    };
    const pushLine = (line) => {
      if (out.length >= GREP_MAX_RESULTS) return false;
      if (chars + line.length + 1 > GREP_MAX_CHARS) {
        truncated = true;
        return false;
      }
      out.push(line);
      chars += line.length + 1;
      return true;
    };

    for (const v of files) {
      if (scope.files && !scope.files.has(v)) continue;
      if (scope.prefix && !v.startsWith(scope.prefix)) continue;
      if (GREP_SKIP_EXT.has(path.posix.extname(v).toLowerCase())) {
        skipped++;
        continue;
      }
      let content;
      const staged = this.overlay.has(v);
      try {
        const real = this._real(v);
        if (fs.existsSync(real)) {
          const st = fs.statSync(real);
          if (!st.isFile() || st.size > GREP_MAX_FILE) {
            skipped++;
            continue;
          }
        }
        content = this.read(v);
        if (content.includes('\u0000')) {
          skipped++;
          continue;
        }
      } catch {
        continue;
      }
      if (content.length > GREP_MAX_FILE) {
        skipped++;
        continue;
      }

      if (multiLine) {
        // Mode pola multi-baris: jalankan regex pada seluruh isi file, bukan
        // per baris (sebelumnya pola berisi \n tidak pernah bisa cocok).
        // CRLF dinormalkan agar pola "a\nb" juga cocok di file Windows.
        const hay = content.includes('\r\n') ? content.replace(/\r\n/g, '\n') : content;
        const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        let m;
        while ((m = g.exec(hay)) !== null) {
          const text = m[0] || '';
          const lineNo = hay.slice(0, m.index).split('\n').length;
          const extra = text.includes('\n') ? ` …(+${text.split('\n').length - 1} baris)` : '';
          if (!pushLine(`${v}:${lineNo}: ${clip(text.split('\n')[0])}${extra}${staged ? ' [staged]' : ''}`)) break;
          if (m.index === g.lastIndex) g.lastIndex++;
        }
      } else {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].replace(/\r$/, '');
          if (!re.test(line)) continue;
          if (!pushLine(`${v}:${i + 1}: ${clip(line)}${staged ? ' [staged]' : ''}`)) break;
        }
      }
      if (out.length >= GREP_MAX_RESULTS) {
        truncated = true;
        break;
      }
      if (truncated) break;
    }

    if (truncated && out.length) {
      out.push(`… (dipotong — perjelas pola/path; maks ${GREP_MAX_RESULTS} hasil / ${GREP_MAX_CHARS} karakter)`);
    }
    if (skipped) notes.push(`[catatan: ${skipped} file dilewati (biner/ekstensi biner/>512KB)]`);
    if (!out.length) out.push('(tidak ada hasil)');
    return out.concat(notes);
  }

  glob(pattern) {
    const p = String(pattern == null ? '' : pattern).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!p) return [];
    const files = this._mergedFiles();
    // Tanpa '/' → cocokkan nama file di semua direktori ("*.js").
    // Dengan '/' → cocokkan path lengkap relatif root ("bin/*.js").
    if (!p.includes('/')) {
      const re = globToRegExp(p);
      return files.filter((f) => re.test(f.slice(f.lastIndexOf('/') + 1)));
    }
    const re = globToRegExp('/' + p);
    return files.filter((f) => re.test(f));
  }

  tree(dir) {
    const v = normalize(dir || '/');
    const files = this._mergedFiles().filter((k) => v === '/' || k.startsWith(v === '/' ? '/' : v + '/'));
    if (files.length === 0) return '(empty)';
    return files
      .map((k) => {
        const depth = Math.max(0, k.split('/').length - 2);
        return `${'  '.repeat(depth)}${k}`;
      })
      .join('\n');
  }

  pendingChanges() {
    const out = [];
    for (const [v, e] of this.overlay) {
      if (e.type === 'mkdir') {
        if (!this._realExists(v)) out.push({ path: v, op: 'mkdir', before: null, after: null });
        continue;
      }
      const realFile = this._realIsFile(v);
      if (e.type === 'write') {
        out.push({
          path: v,
          op: realFile ? 'update' : 'create',
          before: realFile ? this._realRead(v) : null,
          after: e.content,
        });
      } else if (e.type === 'delete') {
        if (realFile) out.push({ path: v, op: 'delete', before: this._realRead(v), after: null });
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  hasPending() {
    return this.pendingChanges().length > 0;
  }

  pushSnapshot(label) {
    const changes = this.pendingChanges();
    if (!changes.length) return null;
    this.redoStack = [];
    const files = new Map();
    for (const c of changes) {
      files.set(c.path, { op: c.op, before: c.before, after: c.after });
    }
    const snap = { label: label || 'sebelum apply', changes, files: Object.fromEntries(files), ts: Date.now() };
    this.snapshots = this.snapshots || [];
    this.snapshots.push(snap);
    this._persistUndo();
    return snap;
  }

  popSnapshot() {
    if (!this.snapshots || !this.snapshots.length) return null;
    return this.snapshots[this.snapshots.length - 1];
  }

  restoreSnapshot(snap) {
    if (!snap) return 0;
    if (snap.kind === 'workspace') {
      const n = this.restoreWorkspace(snap);
      this._removeSnapFromStack(snap);
      return n;
    }
    let n = 0;
    for (const [v, file] of Object.entries(snap.files || {})) {
      const real = this._real(v);
      if (file.op === 'mkdir') {
        // Direktori yang dibuat saat apply → hapus lagi bila masih kosong.
        try {
          fs.rmdirSync(real);
          n++;
        } catch {}
        continue;
      }
      if (file.op === 'delete') {
        if (file.before !== null) {
          fs.mkdirSync(path.dirname(real), { recursive: true });
          fs.writeFileSync(real, file.before);
          n++;
        }
      } else if (file.before !== null) {
        fs.mkdirSync(path.dirname(real), { recursive: true });
        fs.writeFileSync(real, file.before);
        n++;
      } else if (file.after !== null) {
        fs.rmSync(real, { recursive: true, force: true });
        n++;
      }
    }
    this._removeSnapFromStack(snap);
    this.invalidateFileCache();
    return n;
  }

  _removeSnapFromStack(snap) {
    if (this.snapshots) {
      const idx = this.snapshots.lastIndexOf(snap);
      if (idx >= 0) this.snapshots.splice(idx, 1);
      this._persistUndo();
    }
  }

  // ── REDO (terapkan ulang snapshot file yang sudah di-undo) ─────────────
  // /undo menulis kembali state 'before'; /redo menulis lagi state 'after'.
  // Hanya snapshot file (kind !== 'workspace'); snapshot workspace = efek
  // shell, backup dir-nya sudah dibuang saat undo → tidak bisa redo.
  // Stack redo hanya di memori dan dikosongkan oleh perubahan/snapshot baru.
  pushRedo(snap) {
    if (!snap || snap.kind === 'workspace') return;
    (this.redoStack = this.redoStack || []).push(snap);
  }

  redoSnapshot() {
    const snap = (this.redoStack || []).pop();
    if (!snap) return null;
    let n = 0;
    for (const [v, file] of Object.entries(snap.files || {})) {
      const real = this._real(v);
      if (file.op === 'delete') {
        fs.rmSync(real, { recursive: true, force: true });
        n++;
      } else if (file.op === 'mkdir') {
        try {
          fs.mkdirSync(real, { recursive: true });
          n++;
        } catch {}
      } else if (file.after != null) {
        try {
          fs.mkdirSync(path.dirname(real), { recursive: true });
          fs.writeFileSync(real, file.after);
          n++;
        } catch {}
      }
    }
    if (n) {
      this.snapshots = this.snapshots || [];
      this.snapshots.push(snap);
      this._persistUndo();
    }
    this.invalidateFileCache();
    return { snap, n };
  }

  // ── Snapshot WORKSPACE (undo efek shell) ─────────────────────────────
  // Copy file nyata (bukan overlay) workspace ke <undoDir>/ws/<id>/ beserta
  // manifest path. /undo memulihkan kondisi persis sebelum perintah shell.

  _realWorkspaceFiles() {
    const maxFiles = 20000;
    const out = [];
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const child = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (IGNORE_DIRS.has(e.name)) continue;
          walk(child);
        } else if (e.isFile()) {
          out.push(this._virtual(child));
          if (out.length > maxFiles) return;
        }
      }
    };
    try {
      walk(this.root);
    } catch {
      return [];
    }
    return out.sort();
  }

  _undoObjectsDir() {
    const base = this.undoDirBase();
    return base ? path.join(base, 'objects') : null;
  }

  // Hash file secara sinkron dengan buffer 1 MB — hindari membaca file besar
  // sekaligus ke memori.
  _hashFileSync(file) {
    const hash = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let fd = null;
    try {
      fd = fs.openSync(file, 'r');
      let n;
      while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
      return hash.digest('hex');
    } catch {
      return null;
    } finally {
      if (fd != null) {
        try {
          fs.closeSync(fd);
        } catch {}
      }
    }
  }

  // Hapus object yang tidak lagi dirujuk manifest mana pun. Sumber kebenaran =
  // file undo di disk (bukan memori), supaya snapshot lama yang belum
  // dipangkas tidak kehilangan object-nya.
  _gcUndoObjects() {
    const objectsDir = this._undoObjectsDir();
    if (!objectsDir) return;
    let names = [];
    try {
      names = fs.readdirSync(objectsDir);
    } catch {
      return;
    }
    const kept = new Set();
    if (this.undoFile) {
      try {
        const arr = JSON.parse(fs.readFileSync(this.undoFile, 'utf8'));
        if (!Array.isArray(arr)) return;
        for (const s of arr) {
          if (!s || !s.entries) continue;
          for (const e of Object.values(s.entries)) if (e && e.h) kept.add(e.h);
        }
      } catch {
        return; // manifest rusak/tidak ada → jangan hapus apa pun
      }
    }
    for (const name of names) {
      if (kept.has(name)) continue;
      try {
        fs.rmSync(path.join(objectsDir, name), { force: true, recursive: true });
      } catch {}
    }
  }

  snapshotWorkspace(label, opts = {}) {
    const base = this.undoDirBase();
    if (!base) return null;
    const files = this._realWorkspaceFiles();
    const maxFile = Number(opts.maxFileBytes);
    const maxTotal = Number(opts.maxTotalBytes);
    const fileLimit = Number.isFinite(maxFile) && maxFile >= 0 ? maxFile : UNDO_MAX_FILE_BYTES;
    const totalLimit = Number.isFinite(maxTotal) && maxTotal >= 0 ? maxTotal : UNDO_MAX_TOTAL_BYTES;
    const id = 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const dir = path.join(base, id);
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Penanda container per-workspace untuk orphan cleanup.
      fs.writeFileSync(path.join(base, '.ws'), '');
    } catch {
      return null;
    }
    const objectsDir = path.join(base, 'objects');
    let prevEntries = {};
    for (let i = (this.snapshots || []).length - 1; i >= 0; i--) {
      const s = this.snapshots[i];
      if (s && s.kind === 'workspace' && s.entries) {
        prevEntries = s.entries;
        break;
      }
    }
    const objectPath = (h) => path.join(objectsDir, h);
    let bytes = 0;
    let partial = false;
    const skipped = [];
    const entries = {};
    for (const v of files) {
      const real = this._realSafe(v);
      if (!real) continue;
      let st;
      try {
        st = fs.statSync(real);
      } catch {
        continue;
      }
      const prev = prevEntries[v];
      let hash = null;
      // mtime+size sama → object lama masih valid, tidak perlu baca/copy.
      if (prev && prev.s === st.size && prev.m === st.mtimeMs && prev.h && fs.existsSync(objectPath(prev.h))) {
        hash = prev.h;
      } else {
        if (fileLimit > 0 && st.size > fileLimit) {
          partial = true;
          if (skipped.length < 100) skipped.push(v);
          continue;
        }
        hash = this._hashFileSync(real);
        if (!hash) {
          partial = true;
          if (skipped.length < 100) skipped.push(v);
          continue;
        }
        const obj = objectPath(hash);
        if (!fs.existsSync(obj)) {
          if (totalLimit > 0 && bytes + st.size > totalLimit) {
            partial = true;
            if (skipped.length < 100) skipped.push(v);
            continue;
          }
          const tmp = obj + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
          try {
            fs.mkdirSync(objectsDir, { recursive: true });
            fs.copyFileSync(real, tmp);
            try {
              fs.renameSync(tmp, obj);
              bytes += st.size;
            } catch {
              try {
                fs.unlinkSync(tmp);
              } catch {}
              if (!fs.existsSync(obj)) throw new Error('object write failed');
            }
          } catch {
            partial = true;
            if (skipped.length < 100) skipped.push(v);
            continue;
          }
        }
      }
      entries[v] = { h: hash, s: st.size, m: st.mtimeMs };
    }
    const snap = {
      kind: 'workspace',
      label: label || 'before shell command',
      files: Object.keys(entries).sort(),
      entries,
      objectDir: objectsDir,
      dir,
      ts: Date.now(),
      bytes,
      partial,
      skipped,
      created: [],
      initialFiles: files,
    };
    this.redoStack = [];
    this.snapshots = this.snapshots || [];
    this.snapshots.push(snap);
    try {
      this._pruneSnapshots();
      if (!this._persistUndo()) throw new Error('undo manifest could not be persisted');
    } catch (error) {
      this._removeSnapFromStack(snap);
      this._dropSnapshotDir(snap);
      throw error;
    }
    return snap;
  }

  finalizeWorkspaceSnapshot(snap) {
    if (!snap || snap.kind !== 'workspace') return false;
    const before = new Set(Array.isArray(snap.initialFiles) ? snap.initialFiles : snap.files || []);
    snap.created = this._realWorkspaceFiles().filter((file) => !before.has(file));
    if (!this._persistUndo()) {
      throw new Error('undo manifest could not be updated after shell command');
    }
    return true;
  }

  restoreWorkspace(snap) {
    let n = 0;
    const manifest = new Set(Array.isArray(snap.files) ? snap.files : []);
    const objectsDir = snap.objectDir || (snap.dir ? path.join(path.dirname(snap.dir), 'objects') : null);
    // 1) Pulihkan tiap file dari object store (dedupe) atau backup per-snapshot
    // (layout lama). File yang dilewati saat snapshot tidak punya backup.
    for (const v of manifest) {
      let buf = null;
      const e = snap.entries && snap.entries[v];
      if (e && e.h && objectsDir) {
        try {
          buf = fs.readFileSync(path.join(objectsDir, e.h));
        } catch {}
      }
      if (!buf && snap.dir) {
        try {
          buf = fs.readFileSync(path.join(snap.dir, v.replace(/^\//, '')));
        } catch {}
      }
      if (!buf) continue;
      const real = this._realSafe(v);
      if (!real) continue;
      try {
        fs.mkdirSync(path.dirname(real), { recursive: true });
        fs.writeFileSync(real, buf);
        n++;
      } catch {}
    }
    // 2) Hapus HANYA file yang tercatat dibuat oleh perintah (manifest.created).
    // File tak dikenal yang muncul dari proses/alat lain TIDAK disentuh —
    // restore tidak boleh menghapus data di luar pengetahuannya.
    const created = Array.isArray(snap.created) ? snap.created : [];
    for (const v of created) {
      if (manifest.has(v)) continue;
      const real = this._realSafe(v);
      if (!real) continue;
      try {
        fs.rmSync(real, { force: true });
        n++;
      } catch {}
    }
    this._dropSnapshotDir(snap);
    this.invalidateFileCache();
    return n;
  }

  // Pulihkan perubahan staged dari sesi yang disimpan (untuk /load).
  restorePending(list) {
    const arr = Array.isArray(list) ? list : [];
    for (const c of arr) {
      const v = normalize(c && c.path);
      if (!v || v === '/') continue;
      const op = (c && c.op) || 'update';
      if (op === 'delete') this.overlay.set(v, { type: 'delete' });
      else if (op === 'mkdir') this.overlay.set(v, { type: 'mkdir' });
      else if (c.after != null) this.overlay.set(v, { type: 'write', content: String(c.after) });
    }
    return arr.length;
  }

  applyPending(paths) {
    const want = paths ? new Set(paths) : null;
    const changes = this.pendingChanges().filter((c) => !want || want.has(c.path));
    if (!changes.length) return 0;
    this.pushSnapshot(want ? 'apply sebagian' : 'apply semua');
    for (const c of changes) {
      const real = this._real(c.path);
      if (c.op === 'mkdir') fs.mkdirSync(real, { recursive: true });
      else if (c.op === 'delete') fs.rmSync(real, { recursive: true, force: true });
      else {
        fs.mkdirSync(path.dirname(real), { recursive: true });
        fs.writeFileSync(real, c.after);
      }
      this.overlay.delete(c.path);
    }
    this.invalidateFileCache();
    return changes.length;
  }

  discardPending(paths) {
    if (!paths) {
      const n = this.overlay.size;
      this.overlay.clear();
      return n;
    }
    let n = 0;
    for (const p of paths) {
      if (this.overlay.delete(p)) n++;
    }
    return n;
  }

  runCode(code) {
    const logs = [];
    const sandbox = {
      console: {
        log: (...a) => logs.push(a.map(String).join(' ')),
        error: (...a) => logs.push(a.map(String).join(' ')),
      },
      Math,
      JSON,
      Date,
      parseInt,
      parseFloat,
      isNaN,
      Array,
      Object,
      String,
      Number,
    };
    vm.createContext(sandbox);
    let result;
    try {
      result = vm.runInContext(String(code) + '\n', sandbox, { timeout: 3000 });
    } catch (e) {
      throw new Error(`Exec Error: ${e.message}`);
    }
    const out = logs.join('\n');
    return [out, result !== undefined ? `RETURN: ${result}` : ''].filter(Boolean).join('\n') || 'Kode dieksekusi tanpa output';
  }
}

// Hitung jumlah kemunculan substring (tanpa regex, aman & cepat).
function countOccurrences(hay, needle) {
  const h = String(hay);
  const n = String(needle == null ? '' : needle);
  if (!n) return 0;
  let count = 0;
  let i = h.indexOf(n);
  while (i !== -1) {
    count++;
    i = h.indexOf(n, i + n.length);
  }
  return count;
}

// Nomor baris tiap kemunculan substring (maks `limit`).
function occurrenceLineNumbers(content, needle, limit = 10) {
  const h = String(content);
  const n = String(needle == null ? '' : needle);
  const lines = [];
  if (!n) return lines;
  let i = h.indexOf(n);
  while (i !== -1 && lines.length < limit) {
    lines.push(h.slice(0, i).split('\n').length);
    i = h.indexOf(n, i + n.length);
  }
  return lines;
}

// Cari baris yang mirip dengan baris pertama old_str (untuk pesan error).
function similarLines(content, oldStr) {
  const first = String(oldStr == null ? '' : oldStr)
    .split('\n')[0]
    .trim()
    .slice(0, 40);
  if (!first) return '(tidak ada baris mirip)';
  const similar = String(content)
    .split('\n')
    .map((line, i) => ({ line, idx: i + 1 }))
    .filter((o) => o.line.includes(first))
    .slice(0, 5)
    .map((o) => `Line ${o.idx}: ${o.line.slice(0, 120)}`)
    .join('\n');
  return similar ? `Baris mirip:\n${similar}` : '(tidak ada baris mirip)';
}

// Inti pencocokan edit, terpusat untuk cabang dalam & luar workspace.
// Coba exact dulu; bila gagal & old_str multi-baris, coba selaraskan akhir
// baris (CRLF<->LF) agar file Windows tidak menolak old_str ber-LF.
// Mengembalikan status, bukan melempar — pemanggil yang memformat pesan.
function applyEdit(content, oldStr, newStr, replaceAll = false) {
  const c = String(content);
  const needleRaw = String(oldStr == null ? '' : oldStr);
  const replRaw = String(newStr == null ? '' : newStr);
  if (!needleRaw) return { status: 'notfound', count: 0 };

  let needle = needleRaw;
  let repl = replRaw;
  let viaEol = false;
  let count = countOccurrences(c, needle);

  if (count === 0 && /\r?\n/.test(needleRaw)) {
    const eol = c.includes('\r\n') ? '\r\n' : '\n';
    const altNeedle = needleRaw.replace(/\r?\n/g, eol);
    const altCount = countOccurrences(c, altNeedle);
    if (altCount > 0) {
      needle = altNeedle;
      repl = replRaw.replace(/\r?\n/g, eol);
      count = altCount;
      viaEol = true;
    }
  }

  let viaTrim = false;
  if (count === 0) {
    // Fallback: model sering menyalin old_str dengan spasi/indentasi drift
    // di AKHIR baris → exact match gagal padahal secara semantik benar.
    // Coba varian tanpa trailing-ws per baris; HANYA dipakai bila cocok
    // TEPAT SATU kali (tidak pernah mengaburkan pencocokan lain).
    const trimEndLines = (s) => String(s).split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
    const variants = [];
    const t = trimEndLines(needleRaw);
    if (t !== needleRaw) variants.push(t);
    const tm = t.trim();
    if (tm && tm !== needleRaw && tm !== t) variants.push(tm);
    for (const v of variants) {
      const vc = countOccurrences(c, v);
      if (vc === 1) {
        needle = v;
        repl = replRaw;
        count = 1;
        viaTrim = true;
        break;
      }
    }
  }

  if (count === 0) return { status: 'notfound', count: 0 };
  if (count > 1 && !replaceAll) return { status: 'ambiguous', count, locations: occurrenceLineNumbers(c, needle) };
  const next = replaceAll ? c.split(needle).join(repl) : c.replace(needle, repl);
  return { status: 'ok', content: next, count, viaEol, viaTrim };
}

module.exports = { VirtualFS, normalize, resolveWorkspace, countOccurrences, applyEdit, similarLines, DEFAULT_CWD };
