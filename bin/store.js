/**
 * @fileoverview Persistent storage for notes, logs, and autosave
 *
 * @module store
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STORE_DIR = path.join(os.homedir(), '.niyusha');
const GLOBAL_FILE = path.join(STORE_DIR, 'state.json');

function safeRead(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function safeWrite(file, data) {
  try {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

function wsFile(root) {
  const key = String(root || '/').replace(/[\\/]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'root';
  return path.join(STORE_DIR, `ws_${key}.json`);
}

function wsKey(root) {
  return String(root || '/').replace(/[\\/]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'root';
}

function undoFileFor(root) {
  return path.join(STORE_DIR, 'undo', `undo_${wsKey(root)}.json`);
}

function noteFileFor(root) {
  return path.join(STORE_DIR, 'scratch', `note_${wsKey(root)}.txt`);
}

const noteCache = new Map();
const NOTE_CACHE_MS = 1000;

function readNote(root) {
  const file = noteFileFor(root);
  const hit = noteCache.get(file);
  const now = Date.now();
  if (hit && now - hit.at < NOTE_CACHE_MS) return hit.text;
  try {
    const text = fs.readFileSync(file, 'utf8');
    noteCache.set(file, { at: now, text });
    return text;
  } catch {
    noteCache.set(file, { at: now, text: '' });
    return '';
  }
}

function saveNote(root, text) {
  try {
    const file = noteFileFor(root);
    if (!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = String(text == null ? '' : text);
    fs.writeFileSync(file, body);
    noteCache.set(file, { at: Date.now(), text: body });
    return true;
  } catch {
    return false;
  }
}

function clearNote(root) {
  return saveNote(root, '');
}

function lastCopyFile() {
  return path.join(STORE_DIR, 'lastcopy.txt');
}

function saveLastCopy(text) {
  try {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(lastCopyFile(), String(text == null ? '' : text));
    return true;
  } catch {
    return false;
  }
}

function autosaveFile(root) {
  return path.join(STORE_DIR, `autosave_${wsKey(root)}.json`);
}

function saveAutosave(root, data) {
  try {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(autosaveFile(root), JSON.stringify({ ts: new Date().toISOString(), ...data }));
    return true;
  } catch {
    return false;
  }
}

function readAutosave(root) {
  try {
    return JSON.parse(fs.readFileSync(autosaveFile(root), 'utf8'));
  } catch {
    return null;
  }
}

function clearAutosave(root) {
  try {
    fs.rmSync(autosaveFile(root), { force: true });
  } catch {}
}

const LOG_FILE = path.join(STORE_DIR, 'logs.jsonl');
function appendLog(text) {
  try {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), msg: String(text == null ? '' : text).slice(0, 2000) });
    fs.appendFileSync(LOG_FILE, line + '\n');
    // batasi panjang ring log
    const buf = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    if (buf.length > 600) fs.writeFileSync(LOG_FILE, buf.slice(-500).join('\n'));
    return true;
  } catch {
    return false;
  }
}

function readLogs(n = 25) {
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-n).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { msg: l };
      }
    });
  } catch {
    return [];
  }
}

class Store {
  constructor(root) {
    this.root = root;
    const global = safeRead(GLOBAL_FILE);
    this.global = global && typeof global === 'object' ? global : {};
    if (!Array.isArray(this.global.history)) this.global.history = [];
    if (!Array.isArray(this.global.skills)) this.global.skills = [];
    if (!Array.isArray(this.global.rules)) this.global.rules = [];
    const local = safeRead(wsFile(root));
    this.local = local && typeof local === 'object' ? local : {};
    if (!Array.isArray(this.local.history)) this.local.history = [];
    if (!Array.isArray(this.local.todos)) this.local.todos = [];
    if (!Array.isArray(this.local.sessions)) this.local.sessions = [];
  }

  saveGlobal() {
    safeWrite(GLOBAL_FILE, this.global);
  }

  saveLocal() {
    safeWrite(wsFile(this.root), this.local);
  }

  history(scope = 'ws') {
    return scope === 'global' ? this.global.history : this.local.history;
  }

  addHistory(entry, scope = 'ws') {
    const h = this.history(scope);
    if (h[h.length - 1] === entry) return;
    h.push(entry);
    if (h.length > 200) h.splice(0, h.length - 200);
    scope === 'global' ? this.saveGlobal() : this.saveLocal();
  }

  todos() {
    return this.local.todos;
  }

  setTodos(todos) {
    this.local.todos = todos;
    this.saveLocal();
  }

  addTodo(text) {
    this.local.todos.push({ text: String(text), status: 'pending', done: false });
    this.saveLocal();
  }

  toggleTodo(idx) {
    const t = this.local.todos[idx];
    if (!t) return false;
    t.done = !t.done;
    t.status = t.done ? 'completed' : 'pending';
    this.saveLocal();
    return true;
  }

  removeTodo(idx) {
    if (idx < 0 || idx >= this.local.todos.length) return false;
    this.local.todos.splice(idx, 1);
    this.saveLocal();
    return true;
  }

  skills() {
    return this.global.skills;
  }

  saveSkill(name, body) {
    const n = String(name).trim();
    if (!n) return false;
    let s = this.global.skills.find((x) => x.name === n);
    if (!s) {
      s = { name: n, body: String(body).trim(), updated: new Date().toISOString() };
      this.global.skills.push(s);
    } else {
      s.body = String(body).trim();
      s.updated = new Date().toISOString();
    }
    this.saveGlobal();
    return true;
  }

  removeSkill(name) {
    const before = this.global.skills.length;
    this.global.skills = this.global.skills.filter((x) => x.name !== String(name).trim());
    if (this.global.skills.length !== before) {
      this.saveGlobal();
      return true;
    }
    return false;
  }

  rules() {
    return this.global.rules;
  }

  addRule(text) {
    const t = String(text).trim();
    if (!t) return false;
    this.global.rules.push({ text: t, ts: new Date().toISOString() });
    this.saveGlobal();
    return true;
  }

  removeRule(idx) {
    if (idx < 0 || idx >= this.global.rules.length) return false;
    this.global.rules.splice(idx, 1);
    this.saveGlobal();
    return true;
  }

  saveSession(id, data) {
    const list = this.local.sessions;
    const idx = list.findIndex((s) => s.id === id);
    if (idx >= 0) list[idx] = { id, ...data };
    else list.push({ id, ...data });
    if (list.length > 20) list.splice(0, list.length - 20);
    this.saveLocal();
  }

  listSessions() {
    return this.local.sessions;
  }

  loadSession(id) {
    return this.local.sessions.find((s) => s.id === id) || null;
  }

  removeSession(id) {
    const before = this.local.sessions.length;
    this.local.sessions = this.local.sessions.filter((s) => s.id !== id);
    if (this.local.sessions.length !== before) {
      this.saveLocal();
      return true;
    }
    return false;
  }

  // Tulis sesi (id tertentu, atau semua bila ids null) ke file JSON portabel.
  exportSessions(file, ids = null) {
    const sets = ids ? this.local.sessions.filter((s) => ids.includes(s.id)) : this.local.sessions.slice();
    const payload = { kind: 'niyusha-sessions', version: 1, exportedAt: new Date().toISOString(), workspace: this.root, sessions: sets };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    return sets.length;
  }

  // Baca sesi dari file JSON portabel; beri id baru bila bentrok. Kembalikan jumlah.
  importSessions(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const incoming = Array.isArray(raw) ? raw : Array.isArray(raw.sessions) ? raw.sessions : raw && typeof raw === 'object' ? [raw] : [];
    let n = 0;
    for (const rec of incoming) {
      if (!rec || typeof rec !== 'object' || !Array.isArray(rec.msgs)) continue;
      const wanted = typeof rec.id === 'string' ? rec.id.trim() : '';
      const id = wanted && !this.loadSession(wanted) ? wanted : 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      this.saveSession(id, { ...rec, id });
      n++;
    }
    return n;
  }

  backgrounds() {
    return Array.isArray(this.local.backgrounds) ? this.local.backgrounds : [];
  }

  saveBackground(rec) {
    if (!Array.isArray(this.local.backgrounds)) this.local.backgrounds = [];
    this.local.backgrounds.push({ ts: new Date().toISOString(), ...rec });
    if (this.local.backgrounds.length > 12) this.local.backgrounds.splice(0, this.local.backgrounds.length - 12);
    this.saveLocal();
  }

  removeBackground(pid) {
    this.local.backgrounds = this.backgrounds().filter((b) => Number(b.pid) !== Number(pid));
    this.saveLocal();
    return true;
  }
}

module.exports = { Store, STORE_DIR, GLOBAL_FILE, wsKey, undoFileFor, noteFileFor, readNote, saveNote, clearNote, lastCopyFile, saveLastCopy, saveAutosave, readAutosave, clearAutosave, autosaveFile, appendLog, readLogs };
