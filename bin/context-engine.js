'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { archiveFile, archiveHistory } = require('./compaction');

const ATOM_TYPES = [
  'IDENTITY',
  'FACT',
  'RELATION',
  'DECISION',
  'INSTRUCTION',
  'STATE',
  'HISTORY',
  'UNCERTAINTY',
  'NEGATIVE_FACT',
  'CODE_CONTEXT',
  'CODE_DECISION',
  'FILE',
  'FUNCTION',
  'CLASS',
  'DEPENDENCY',
  'EDIT_STATE',
  'CHECKPOINT',
  'GOAL',
  'FAILURE',
  'RESOLVED',
  'EVIDENCE',
  'TASK',
  'TOUCHED_FILE',
  'ERROR',
  'TEST_RESULT',
  'FINDING', 'OBSERVATION', 'HYPOTHESIS', 'EXPERIMENT',
  'CONSTRAINT', 'QUESTION', 'SOURCE',
];

const TYPE_ORDER = [
  'IDENTITY',
  'INSTRUCTION',
  'NEGATIVE_FACT',
  'DECISION',
  'CODE_DECISION',
  'GOAL',
  'FAILURE',
  'RESOLVED',
  'EVIDENCE',
  'TOUCHED_FILE',
  'TASK',
  'FILE',
  'FUNCTION',
  'CLASS',
  'DEPENDENCY',
  'EDIT_STATE',
  'CHECKPOINT',
  'CODE_CONTEXT',
  'ERROR',
  'TEST_RESULT',
  'STATE',
  'FACT',
  'RELATION',
  'UNCERTAINTY',
  'HISTORY',
  'FINDING', 'OBSERVATION', 'HYPOTHESIS', 'EXPERIMENT',
  'CONSTRAINT', 'QUESTION', 'SOURCE',
];

const TYPE_HEADING = {
  IDENTITY: 'Identitas / tujuan',
  INSTRUCTION: 'Instruksi wajib',
  NEGATIVE_FACT: 'Larangan',
  DECISION: 'Keputusan',
  CODE_DECISION: 'Keputusan kode',
  GOAL: 'Goal',
  FAILURE: 'Failure / blocker',
  RESOLVED: 'Resolved issue',
  EVIDENCE: 'Evidence',
  TOUCHED_FILE: 'Touched file',
  TASK: 'Task / todo',
  FILE: 'File',
  FUNCTION: 'Fungsi',
  CLASS: 'Class',
  DEPENDENCY: 'Dependensi',
  EDIT_STATE: 'Status edit',
  CHECKPOINT: 'Checkpoint',
  CODE_CONTEXT: 'File / kode',
  ERROR: 'Error / blocker',
  TEST_RESULT: 'Test / verifikasi',
  STATE: 'Status',
  FACT: 'Fakta',
  RELATION: 'Relasi',
  UNCERTAINTY: 'Belum pasti',
  HISTORY: 'Riwayat',
  FINDING: 'Temuan',
  OBSERVATION: 'Observasi',
  HYPOTHESIS: 'Hipotesis',
  EXPERIMENT: 'Eksperimen / percobaan',
  CONSTRAINT: 'Batasan / kondisi',
  QUESTION: 'Pertanyaan terbuka',
  SOURCE: 'Sumber / asal informasi',
};

const HEADING_TYPE = Object.fromEntries(Object.entries(TYPE_HEADING).map(([type, heading]) => [heading, type]));

const TEMPORAL_TYPES = new Set(['GOAL', 'DECISION', 'CODE_DECISION', 'FAILURE', 'RESOLVED', 'STATE', 'TASK', 'INSTRUCTION', 'ERROR', 'TEST_RESULT']);

const TEMPORAL_STATUSES = new Set(['ACTIVE', 'HISTORICAL', 'SUPERSEDED']);
const CONFIDENCE_REVIEW_THRESHOLD = 0.35;
const CONFIDENCE_LOW_THRESHOLD = 0.35;

const TYPE_IMPORTANCE = {
  IDENTITY: 0.95,
  INSTRUCTION: 1,
  NEGATIVE_FACT: 1,
  DECISION: 0.95,
  CODE_DECISION: 0.92,
  GOAL: 1,
  FAILURE: 0.9,
  RESOLVED: 0.8,
  EVIDENCE: 0.75,
  TOUCHED_FILE: 0.85,
  TASK: 0.85,
  FILE: 0.9,
  FUNCTION: 0.88,
  CLASS: 0.86,
  DEPENDENCY: 0.84,
  EDIT_STATE: 0.82,
  CHECKPOINT: 0.8,
  CODE_CONTEXT: 0.9,
  ERROR: 0.85,
  TEST_RESULT: 0.8,
  STATE: 0.75,
  FACT: 0.7,
  RELATION: 0.65,
  UNCERTAINTY: 0.6,
  // History explains why the current state exists; it is not disposable.
  HISTORY: 0.62,
  FINDING: 0.84,
  OBSERVATION: 0.72,
  HYPOTHESIS: 0.58,
  EXPERIMENT: 0.82,
  CONSTRAINT: 0.9,
  QUESTION: 0.68,
  SOURCE: 0.76,
};

const INVARIANT_TYPES = new Set([
  'IDENTITY',
  'INSTRUCTION',
  'NEGATIVE_FACT',
  'DECISION',
  'CODE_DECISION',
  'GOAL',
  'FAILURE',
  'RESOLVED',
  'EVIDENCE',
  'TOUCHED_FILE',
  'TASK',
  'FILE',
  'DEPENDENCY',
  'ERROR',
  'FINDING', 'EXPERIMENT', 'CONSTRAINT', 'SOURCE',
]);

const METADATA = [
  ['tujuan', /\b(tujuan|goal|tugas inti)\b/i],
  ['keputusan', /\b(keputusan|decision)\b/i],
  ['file', /\b(file|path|berkas)\b/i],
  ['error', /\b(error|gagal|blocker|masalah)\b/i],
  ['test', /\b(test|tes|verifikasi)\b/i],
  ['langkah berikutnya', /\b(next step|langkah berikutnya|selanjutnya)\b/i],
];

const PATH_RE = /(?:[A-Za-z]:[\\/]|\/|\.{0,2}[\\/])?[\w.-]+(?:[\\/][\w.-]+)*\.(?:js|ts|tsx|jsx|json|md|py|css|html|yml|yaml|toml|sh|ps1|java|kt|go|rs|c|cpp|h|sql)\b/gi;

const STOPWORDS = new Set(
  (
    'yang dan di ke dari untuk dengan pada ini itu adalah ialah merupakan akan sudah telah juga atau ' +
    'tidak bukan ada bisa dapat harus wajib perlu saya kamu kita kami mereka dia ia nya lah kah pun ' +
    'the a an and or of to in on for with is are was were be been being this that these those it its ' +
    'as at by from has have had do does did can could should would will shall may might must not no ' +
    'i you he she we they me him her us them my your our their'
  ).split(/\s+/)
);

const SYNONYMS = {
  berkas: 'file',
  pengujian: 'test',
  tes: 'test',
  verifikasi: 'test',
  tujuan: 'goal',
  keputusan: 'decision',
  galat: 'error',
  gagal: 'error',
  masalah: 'error',
  blocker: 'error',
  sebelumnya: 'history',
  dulu: 'history',
  lama: 'history',
  ganti: 'replace',
  diganti: 'replace',
  beralih: 'replace',
  pindah: 'replace',
  fungsi: 'function',
  modul: 'module',
  pustaka: 'library',
  dependensi: 'dependency',
};

const INTENT_RULES = [
  ['GOAL', /\b(tujuan|goal|tugas inti)\b/i],
  ['IDENTITY', /\b(proyek|project|nama|organisasi|workspace|repository|identitas)\b/i],
  ['CODE_CONTEXT', /\b(file|path|berkas|kode|code|function|fungsi|class|modul|module)\b/i],
  ['ERROR', /\b(error|gagal|fail|bug|masalah|blocker|exception|stack)\b/i],
  ['TEST_RESULT', /\b(test|tes|verifikasi|lulus|pass|hijau|coverage)\b/i],
  ['DECISION', /\b(keputusan|decision|pilih|gunakan|pakai|ganti|beralih|replace)\b/i],
  ['HISTORY', /\b(sebelum|sebelumnya|dulu|lama|history|riwayat|historis)\b/i],
  ['FINDING', /\b(temuan|ditemukan|finding|discovery)\b/i],
  ['EXPERIMENT', /\b(percobaan|eksperimen|experiment|trial|uji coba)\b/i],
  ['CONSTRAINT', /\b(batasan|kendala|constraint|syarat|requirement)\b/i],
  ['QUESTION', /\b(pertanyaan|question|belum terjawab|open question)\b/i],
];

const INTENT_RELATED_TYPES = {
  CODE_CONTEXT: new Set(['CODE_CONTEXT', 'FILE', 'FUNCTION', 'CLASS', 'DEPENDENCY', 'TOUCHED_FILE', 'EDIT_STATE', 'CHECKPOINT']),
  ERROR: new Set(['ERROR', 'FAILURE']),
  TEST_RESULT: new Set(['TEST_RESULT', 'EVIDENCE']),
  DECISION: new Set(['DECISION', 'CODE_DECISION']),
  HISTORY: new Set(['HISTORY', 'RELATION', 'EXPERIMENT', 'RESOLVED', 'FAILURE']),
  FINDING: new Set(['FINDING', 'EVIDENCE', 'OBSERVATION']),
  EXPERIMENT: new Set(['EXPERIMENT', 'TEST_RESULT', 'EVIDENCE', 'FAILURE', 'RESOLVED']),
  CONSTRAINT: new Set(['CONSTRAINT', 'INSTRUCTION', 'NEGATIVE_FACT']),
  QUESTION: new Set(['QUESTION', 'UNCERTAINTY']),
};

const INTENT_CONTENT_RULES = {
  GOAL: /\b(tujuan|goal|tugas inti)\b/i,
  IDENTITY: /\b(proyek|project|nama|organisasi|workspace|repository|identitas)\b/i,
  CODE_CONTEXT: /\b(file|berkas|path|kode|code|function|fungsi|class|modul|module|import|require|dependency|dependensi)\b/i,
  ERROR: /\b(error|gagal|fail|bug|masalah|blocker|exception|stack)\b/i,
  TEST_RESULT: /\b(test|tes|verifikasi|lulus|pass|hijau|coverage|gagal|fail)\b/i,
  DECISION: /\b(keputusan|decision|dipilih|disetujui|gunakan|pakai|ganti|beralih|adapter|superseded|diganti)\b/i,
  HISTORY: /\b(dulu|sebelumnya|lama|historis|historical|deprecated|legacy|replaced|superseded|diganti|beralih)\b/i,
};

function safeTimestamp(value, fallback = Date.now()) {
  if (value === null || value === undefined || value === '') return new Date(fallback).toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function detectLanguageHint(value) {
  const text = String(value || '');
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  if (/\b(the|and|with|from|this|that|should|because|currently)\b/i.test(text)) return 'en';
  if (/\b(yang|dengan|untuk|karena|sekarang|sudah|belum|adalah|jangan)\b/i.test(text)) return 'id';
  return 'und';
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safePart(value, fallback) {
  const part = String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  return part || fallback;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9./_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemWord(word) {
  const w = String(word || '');
  if (w.length <= 4) return w;
  return w.replace(/(kannya|annya|nya|kan|lah|kah|pun|an|es|s)$/i, '') || w;
}

function tokenize(value) {
  const out = [];
  for (const part of normalizeText(value).split(/\s+/)) {
    const raw = String(part || '').replace(/^[./_-]+|[./_-]+$/g, '');
    if (!raw || STOPWORDS.has(raw)) continue;
    const isPath = /[./]/.test(raw);
    const stemmed = isPath ? raw : stemWord(raw);
    const token = SYNONYMS[stemmed] || SYNONYMS[raw] || stemmed;
    if (!token || STOPWORDS.has(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

function extractPaths(value) {
  const text = String(value || '');
  const extensions = 'js|ts|tsx|jsx|json|md|py|css|html|yml|yaml|toml|sh|ps1|java|kt|go|rs|c|cpp|h|sql';
  const found = new Set();
  for (const match of text.matchAll(new RegExp(`["']([^"']+\\.(?:${extensions}))["']`, 'gi'))) {
    found.add(match[1]);
  }
  for (const match of text.match(PATH_RE) || []) found.add(match);
  return [...new Set([...found].map((p) => p.toLowerCase()))];
}

function classifyText(text, role) {
  const s = String(text || '');
  if (/\b(jangan|tidak boleh|dilarang|hindari|avoid|must not)\b/i.test(s)) return 'NEGATIVE_FACT';
  if (/\b(tujuan|goal|tugas inti)\b/i.test(s)) return 'GOAL';
  if (/\b(identitas|nama proyek|nama project|workspace|repository)\b/i.test(s)) return 'IDENTITY';
  if (/\b(keputusan|decision|dipilih|disetujui|setuju|ganti|beralih|replace|migrate)\b/i.test(s)) return 'DECISION';
  if (/\b(wajib|harus|gunakan|pakai|buat|perbaiki|jalankan|tambahkan|ubah|hapus|pastikan|lanjutkan|implement|fix|run|add|remove|ensure)\b/i.test(s) && role === 'user') return 'INSTRUCTION';
  if (role === 'user' && /\b(langkah berikutnya|next step|selanjutnya|berikutnya)\b/i.test(s)) return 'INSTRUCTION';
  if (/\b(gunakan|pakai)\b/i.test(s)) return 'DECISION';
  if (PATH_RE.test(s) || /\b(file|berkas|fungsi|function|class|modul|module|import|require|dependency|dependensi)\b/i.test(s)) {
    PATH_RE.lastIndex = 0;
    return 'CODE_CONTEXT';
  }
  PATH_RE.lastIndex = 0;
  if (/\b(error|gagal|fail|blocker|masalah|bug|exception|stack ?trace)\b/i.test(s)) return 'ERROR';
  if (/\b(test|tes|verifikasi|lulus|pass|hijau|coverage)\b/i.test(s)) return 'TEST_RESULT';
  if (/\b(status|selesai|pending|staged|aktif|berjalan|done|completed)\b/i.test(s)) return 'STATE';
  if (/\b(hipotesis|dugaan|asumsi|hypothesis|assume|suspect)\b/i.test(s)) return 'HYPOTHESIS';
  if (/\b(percobaan|eksperimen|experiment|trial|prototype|uji coba)\b/i.test(s)) return 'EXPERIMENT';
  if (/\b(batasan|kendala|constraint|requirement|syarat|hanya boleh)\b/i.test(s)) return 'CONSTRAINT';
  if (/\b(temuan|ditemukan|finding|discovery|hasil pemeriksaan)\b/i.test(s)) return 'FINDING';
  if (/\b(observasi|teramati|terlihat|observation|noticed)\b/i.test(s)) return 'OBSERVATION';
  if (/\b(sumber|source|berdasarkan|according to|rujukan|referensi)\b/i.test(s)) return 'SOURCE';
  if (/\b(mungkin|belum pasti|tbd|unknown|tidak yakin|perhaps|maybe)\b/i.test(s)) return 'UNCERTAINTY';
  if (/\?\s*$/.test(s) || /\b(pertanyaan|question|belum terjawab|open question)\b/i.test(s)) return 'QUESTION';
  if (/\b(adalah|ialah|merupakan|berisi|memiliki|menggunakan|uses|contains|has)\b/i.test(s)) return 'FACT';
  if (/\b(proyek|project|nama|organisasi|workspace|repository)\b/i.test(s)) return 'IDENTITY';
  if (/\b(memanggil|calls|bergantung|depends|terhubung|relates|integrated)\b/i.test(s)) return 'RELATION';
  // Kalimat netral (mis. "Saya sedang memeriksa hasilnya hari ini") bukan
  // instruksi. Instruksi hanya dikenali dari penanda imperatif eksplisit.
  return 'HISTORY';
}

function isMetadata(text) {
  return METADATA.some(([name, re]) => name !== 'file' && re.test(text));
}

function touchedFileSet(value) {
  const list = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  return new Set(list.map((item) => String(item || '').toLowerCase()).filter(Boolean));
}

function splitSentences(value) {
  return String(value || '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitLongText(value, maxChars = 480) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end);
      if (boundary > start + Math.floor(maxChars / 2)) end = boundary;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
    while (text[start] === ' ') start++;
  }
  return chunks;
}

const RELATION_ENTITY_RE = /[./\\:@$-]/;
const RELATION_GENERIC_ENTITIES = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'been', 'being', 'by', 'can', 'could',
  'dengan', 'dia', 'dari', 'do', 'does', 'did', 'for', 'from', 'hanya', 'has',
  'have', 'had', 'he', 'her', 'him', 'i', 'ia', 'ini', 'is', 'it', 'its',
  'ke', 'kami', 'kamu', 'kita', 'lah', 'may', 'me', 'mereka', 'must', 'nya',
  'no', 'not', 'of', 'on', 'only', 'or', 'our', 'please', 'pun', 'saat',
  'shall', 'she', 'should', 'system', 'that', 'the', 'their', 'them', 'they',
  'this', 'those', 'to', 'untuk', 'us', 'was', 'we', 'were', 'will', 'with',
  'yang', 'you', 'your',
]);

const RELATION_NON_ASSERTIVE_RE = /^\s*(?:maybe|mungkin|perhaps|possibly|barangkali|tidak yakin)\b/i;
const RELATION_INSTRUCTION_RE = /^\s*(?:jalankan|run|gunakan|pakai|tambahkan|buat|cek|periksa|uji|test(?=\s|$)|please)\b/i;

const RELATION_RULES = [
  ['CALLS', /\b([\w./-]{2,})\s+(?:memanggil|manggil|calls?|invokes?)\s+([\w./-]{2,})/gi],
  ['CALLS', /\b([\w./-]{2,})\s+(?:is|was|are|were|dipanggil)\s+(?:called by|invoked by|dipanggil oleh)\s+(?:a|an|the|sebuah|suatu)?\s*(?:new|old|baru|lama)?\s*([\w./-]{2,})/gi, true],
  ['CALLS', /\b([\w./-]{2,})\s+(?:dipanggil oleh|dipanggil|called by|invoked by)\s+([\w./-]{2,})/gi, true],
  ['DEPENDS_ON', /\b([\w./-]{2,})\s+(?:bergantung pada|bergantung|tergantung pada|depends?[_ ]on|requires?|mengimpor|imports?)\s+([\w./-]{2,})/gi],
  ['DEPENDS_ON', /\b([\w./-]{2,})\s+(?:is|was|are|were|diimpor)\s+(?:required by|imported by|diimpor oleh)\s+(?:a|an|the|sebuah|suatu)?\s*([\w./-]{2,})/gi, true],
  ['DEPENDS_ON', /\b([\w./-]{2,})\s+(?:diimpor oleh|required by|imported by)\s+([\w./-]{2,})/gi, true],
  ['USES', /\b([\w./-]{2,})\s+(?:menggunakan|memakai|uses?)\s+([\w./-]{2,})/gi],
  ['USES', /\b([\w./-]{2,})\s+(?:is|was|are|were|dipakai|digunakan)\s+(?:used by|dipakai oleh|digunakan oleh)\s+(?:a|an|the|sebuah|suatu)?\s*(?:new|old|baru|lama)?\s*([\w./-]{2,})/gi, true],
  ['USES', /\b([\w./-]{2,})\s+(?:dipakai oleh|digunakan oleh|used by)\s+([\w./-]{2,})/gi, true],
  ['REPLACED_BY', /\b([\w./-]{2,})\s+(?:is|was|are|were|telah|sudah)\s+(?:digantikan oleh|diganti oleh|replaced by|superseded by)\s+(?:a|an|the|sebuah|suatu)?\s*(?:new|old|baru|lama)?\s*([\w./-]{2,})/gi],
  ['REPLACED_BY', /\b([\w./-]{2,})\s+(?:digantikan oleh|diganti oleh|replaced by|superseded by)\s+([\w./-]{2,})/gi],
  ['REPLACED_BY', /\b([\w./-]{2,})\s+(?:menggantikan|mengganti|replaces?)\s+([\w./-]{2,})/gi, true],
  ['PART_OF', /\b([\w./-]{2,})\s+(?:bagian dari|termasuk|part of|belongs to)\s+([\w./-]{2,})/gi],
  ['CAUSES', /\b([\w./-]{2,})\s+(?:menyebabkan|menimbulkan|causes?)\s+([\w./-]{2,})/gi],
  ['FIXES', /\b([\w./-]{2,})\s+(?:memperbaiki|memulihkan|fixes?)\s+([\w./-]{2,})/gi],
  ['TESTS', /\b([\w./-]{2,})\s+(?:menguji|mencakup|tests?|covers?)\s+([\w./-]{2,})/gi],
  ['CONNECTED_TO', /\b([\w./-]{2,})\s+(?:terhubung (?:dengan|ke)|terintegrasi dengan|connected to|integrated with)\s+([\w./-]{2,})/gi],
];

const CO_OCCURRENCE_LIMIT = 6;
const CO_OCCURRENCE_WEIGHT = 0.25;

const TEMPORAL_REPLACE_RE =
  /(?:dulu|sebelumnya|formerly|used to)[^.!?\n]*\b([A-Z][A-Za-z0-9_.-]*)\b[^.!?\n]*[.!?]?\s*(?:sekarang|saat ini|now|currently)[^.!?\n]*\b(?:ke|to|pakai|menggunakan|uses?)\s+([A-Z][A-Za-z0-9_.-]*)/i;

const RESERVED_ENTITIES = new Set([
  'dulu', 'sebelumnya', 'sekarang', 'saat', 'file', 'berkas', 'error', 'test', 'tes', 'langkah',
  'tujuan', 'keputusan', 'jangan', 'saya', 'kamu', 'kita', 'kami', 'ini', 'itu', 'status', 'catatan',
]);

function isRelationEntity(value) {
  const raw = String(value || '').trim().replace(/^`|`$/g, '');
  const key = canonicalEntity(raw);
  if (!key || STOPWORDS.has(key) || RELATION_GENERIC_ENTITIES.has(key)) return false;
  if (RELATION_ENTITY_RE.test(raw)) return true;
  if (/^[A-Z][A-Za-z0-9]*$/.test(raw)) return true;
  return raw.length >= 3 && !/^(?:please|only|saat|hanya|system|sistem)$/i.test(raw);
}

function canonicalEntity(value) {
  return normalizeText(value)
    .replace(/^[./_-]+|[./_-]+$/g, '')
    .trim();
}

function entityKeys(value) {
  const full = canonicalEntity(value);
  if (!full) return [];
  const keys = [full];
  if (/[/\\]/.test(full)) {
    const parts = full.split(/[/\\]/).filter((part) => part && part !== '.');
    const base = parts[parts.length - 1];
    if (base && base !== full) keys.push(base);
  }
  return [...new Set(keys)];
}

function sharesEntityKey(a, b) {
  const left = entityKeys(a);
  if (!left.length) return false;
  const right = new Set(entityKeys(b));
  return left.some((key) => right.has(key));
}

function extractRelations(value) {
  const text = String(value || '');
  if (RELATION_NON_ASSERTIVE_RE.test(text) || RELATION_INSTRUCTION_RE.test(text)) return [];
  const out = [];
  const seen = new Set();
  const push = (type, source, target) => {
    const from = String(source || '').trim();
    const to = String(target || '').trim();
    if (!from || !to) return;
    if (!isRelationEntity(from) || !isRelationEntity(to)) return;
    const fromKey = canonicalEntity(from);
    const toKey = canonicalEntity(to);
    if (!fromKey || !toKey || fromKey === toKey) return;
    if (STOPWORDS.has(fromKey) || STOPWORDS.has(toKey)) return;
    const key = `${type}|${fromKey}|${toKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, source: fromKey, target: toKey });
  };
  for (const [type, re, swap] of RELATION_RULES) {
    for (const match of text.matchAll(re)) {
      if (swap) push(type, match[2], match[1]);
      else push(type, match[1], match[2]);
    }
  }
  const temporal = text.match(TEMPORAL_REPLACE_RE);
  if (temporal) push('REPLACED_BY', temporal[1], temporal[2]);
  return out;
}

function temporalStatusFor(text) {
  const s = String(text || '');
  if (/\b(digantikan|diganti|replaced by|superseded|tidak dipakai lagi|already replaced)\b/i.test(s)) return 'SUPERSEDED';
  if (/\b(dulu|sebelumnya|formerly|used to|historis|historical)\b/i.test(s)) return 'HISTORICAL';
  return 'ACTIVE';
}

function uniqueList(list) {
  const out = [];
  for (const item of list || []) {
    const value = String(item || '').trim();
    if (!value) continue;
    if (!out.some((x) => x.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out;
}

function extractCodeInfo(text) {
  const s = String(text || '');
  const files = extractPaths(s);
  const functions = [...s.matchAll(/\b(?:function|fungsi|def|method|metode)\s+([A-Za-z_$][\w$]*)/gi)].map((m) => m[1]);
  const classes = [...s.matchAll(/\b(?:class|kelas)\s+([A-Za-z_$][\w$]*)/gi)].map((m) => m[1]);
  const dependencies = [
    ...s.matchAll(/\b(?:dependency|dependensi|import|require|package|pustaka|library)\s*[:=]?\s*([A-Za-z0-9@/_.-]{2,})/gi),
  ].map((m) => String(m[1]).replace(/[.,;:]+$/, ''));
  return {
    files: uniqueList(files.map((x) => x.toLowerCase())),
    functions: uniqueList(functions),
    classes: uniqueList(classes),
    dependencies: uniqueList(dependencies),
  };
}

function extractEntity(text, type) {
  const s = String(text || '');
  const info = extractCodeInfo(s);
  if (info.files.length) return info.files[0];
  if (info.functions.length) return info.functions[0];
  if (info.classes.length) return info.classes[0];
  if (info.dependencies.length) return info.dependencies[0];
  for (const match of s.matchAll(/\b([A-Z][A-Za-z0-9_.-]{1,30})\b/g)) {
    if (!RESERVED_ENTITIES.has(match[1].toLowerCase())) return match[1];
  }
  return null;
}

function codeKindFor(info) {
  if (info.functions.length) return 'FUNCTION';
  if (info.classes.length) return 'CLASS';
  if (info.dependencies.length) return 'DEPENDENCY';
  if (info.files.length) return 'FILE';
  return null;
}

function atomFromText(text, {
  type, role = 'assistant', index = 0, total = 1, source = 'conversation',
  touchedFiles = null, createdAt = null, messageId = null, language = null,
  extractionConfidence = 0.8, claimConfidence = null,
} = {}) {
  const content = String(text || '').replace(/\s+/g, ' ').trim();
  if (content.length < 8) return null;
  const atomType = type || classifyText(content, role);
  const base = TYPE_IMPORTANCE[atomType] == null ? 0.5 : TYPE_IMPORTANCE[atomType];
  const recency = total > 1 ? index / (total - 1) : 1;
  const importance = Math.min(1, base + recency * 0.1);
  const normalized = normalizeText(content);
  const info = extractCodeInfo(content);
  const codeKind = codeKindFor(info);
  const relations = extractRelations(content);
  const paths = extractPaths(content);
  const touched = touchedFileSet(touchedFiles);
  return {
    atom_id: `atom_${hashText(`${atomType}|${normalized}|${content}`).slice(0, 16)}`,
    type: atomType,
    code_kind: codeKind,
    entity: canonicalEntity(extractEntity(content, atomType)) || null,
    content,
    normalized_text: normalized,
    relations,
    importance,
    effective_importance: importance,
    centrality: 0,
    // Extraction confidence is parser certainty, not certainty that the claim is true.
    confidence: Math.max(0, Math.min(1, Number(extractionConfidence) || 0)),
    extraction_confidence: Math.max(0, Math.min(1, Number(extractionConfidence) || 0)),
    claim_confidence: claimConfidence == null ? null : Math.max(0, Math.min(1, Number(claimConfidence) || 0)),
    relevance: 0,
    sequence: index,
    message_id: messageId == null ? null : String(messageId),
    speaker: role,
    language: language || detectLanguageHint(content),
    created_at: safeTimestamp(createdAt),
    observed_at: safeTimestamp(createdAt),
    valid_from: null,
    valid_until: null,
    superseded_by: null,
    temporal_status: temporalStatusFor(content),
    source,
    storage_tier: 'COMPRESSED',
    invariant:
      INVARIANT_TYPES.has(atomType) ||
      isMetadata(content) ||
      paths.some((p) => touched.has(p)) ||
      (role === 'user' && paths.length > 0) ||
      relations.some((r) => r.type === 'REPLACED_BY'),
    loss_tolerance: Math.max(0, Math.min(1, 1 - importance)),
  };
}

function atomizeMessage(message, { index = 0, total = 1, source = 'conversation', touchedFiles = null } = {}) {
  if (!message || typeof message.content !== 'string') return [];
  const role = message.role || 'assistant';
  const out = [];
  const seen = new Set();
  const messageTime = message.createdAt || message.created_at || message.timestamp || message.time || null;
  const messageId = message.id || message.message_id || message.uuid || null;
  for (const sentence of splitSentences(message.content)) {
    const type = classifyText(sentence, role);
    for (const chunk of splitLongText(sentence)) {
      const atom = atomFromText(chunk, {
        type, role, index, total, source, touchedFiles,
        createdAt: messageTime, messageId,
        language: message.language || message.lang || null,
        extractionConfidence: 0.8,
      });
      if (!atom || seen.has(`${atom.type}|${atom.normalized_text}`)) continue;
      seen.add(`${atom.type}|${atom.normalized_text}`);
      out.push(atom);
    }
  }
  for (const rel of extractRelations(message.content)) {
    const atom = atomFromText(`${rel.source} ${rel.type} ${rel.target}`, {
      type: 'RELATION', role, index, total, source, touchedFiles,
      createdAt: messageTime, messageId,
      language: message.language || message.lang || null,
      extractionConfidence: 0.72,
    });
    if (!atom || seen.has(`${atom.type}|${atom.normalized_text}`)) continue;
    atom.entity = canonicalEntity(rel.source) || null;
    atom.relations = [{
      type: rel.type,
      source: canonicalEntity(rel.source) || rel.source,
      target: canonicalEntity(rel.target) || rel.target,
    }];
    atom.temporal_status = 'ACTIVE';
    atom.invariant = true;
    seen.add(`${atom.type}|${atom.normalized_text}`);
    out.push(atom);
  }
  return out;
}

function atomizeState(state, { baseIndex = 0 } = {}) {
  const s = state || {};
  const out = [];
  const touchedFiles = touchedFileSet(s.touchedFiles);
  let seq = baseIndex;
  const push = (text, type, invariant = true) => {
    const content = String(text || '').replace(/\s+/g, ' ').trim();
    if (content.length < 3) return;
    for (const chunk of splitLongText(content)) {
      const atom = atomFromText(chunk, { type, role: 'assistant', index: seq++, total: 1, source: 'state', touchedFiles, createdAt: Date.now() });
      if (atom) {
        atom.invariant = invariant;
        out.push(atom);
      }
    }
  };
  if (s.goal && String(s.goal).trim()) push(s.goal, 'GOAL', true);
  for (const goal of (Array.isArray(s.goalLedger) ? s.goalLedger : [])) {
    if (goal && goal.text) push(`[${goal.status || 'active'}] ${goal.text}`, 'GOAL', true);
  }
  for (const decision of (Array.isArray(s.decisions) ? s.decisions : [])) {
    if (decision && decision.text) push(`[${decision.status || 'active'}] [${decision.scope || 'unscoped'}] ${decision.text}`, 'DECISION', true);
  }
  for (const f of (Array.isArray(s.failures) ? s.failures : [])) push(f, 'FAILURE', true);
  for (const r of (Array.isArray(s.resolved) ? s.resolved : [])) {
    const text = r && typeof r === 'object' ? (r.text || r.note || '') : r;
    push(text, 'RESOLVED', true);
  }
  for (const e of (Array.isArray(s.evidence) ? s.evidence : [])) push(e, 'EVIDENCE', false);
  for (const f of (Array.isArray(s.touchedFiles) ? s.touchedFiles : (s.touchedFiles instanceof Set ? [...s.touchedFiles] : []))) push(f, 'TOUCHED_FILE', true);
  for (const t of (Array.isArray(s.todos) ? s.todos : [])) {
    const text = t && typeof t === 'object' ? (t.text || '') : t;
    const status = t && typeof t === 'object' ? (t.status || (t.done ? 'completed' : 'pending')) : 'pending';
    if (text) push(`[${status}] ${text}`, 'TASK', true);
  }
  for (const n of (Array.isArray(s.contextNotes) ? s.contextNotes : [])) {
    const text = n && typeof n === 'object' ? n.text : n;
    push(text, 'STATE', false);
  }
  const addRecords = (key, type, fields = ['text', 'description']) => {
    for (const item of (Array.isArray(s[key]) ? s[key] : [])) {
      const value = item && typeof item === 'object'
        ? fields.map((field) => item[field]).find(Boolean)
        : item;
      push(value, type, ['FINDING', 'EXPERIMENT', 'CONSTRAINT', 'SOURCE'].includes(type));
    }
  };
  addRecords('findings', 'FINDING');
  addRecords('observations', 'OBSERVATION');
  addRecords('experiments', 'EXPERIMENT');
  addRecords('hypotheses', 'HYPOTHESIS');
  addRecords('constraints', 'CONSTRAINT');
  addRecords('openQuestions', 'QUESTION', ['text', 'question']);
  addRecords('sources', 'SOURCE', ['text', 'uri', 'name']);
  return out;
}

function progressFingerprint(atom) {
  const content = String(atom && atom.content || '');
  const progress = content.match(
    /^\s*(?:progress|update|status|pemeriksaan rutin|check[- ]?in)\s*(?:(?:#|no\.?)?\s*\d+|tahap\s+\d+)\s*[:.-]\s*(.*)$/i
  );
  const detail = content.match(/^\s*detail teknis non-kritis\s+\d+\s*[:.-]?\s*(.*)$/i);
  if (!progress && !detail) return null;
  const progressText = progress && progress[1].trim()
    ? progress[1]
    : progress
      ? progress[0].replace(/\b\d+\b/g, '')
      : `detail teknis non-kritis ${detail[1] || ''}`;
  const normalized = normalizeText(progressText)
    .replace(/\b(detail teknis non-kritis)\s+\d+\b/g, '$1');
  return normalized ? `${atom.type}|${normalized}` : null;
}

function collapseRepeatedProgressAtoms(atoms) {
  const kept = [];
  const repeated = new Map();
  for (const atom of atoms || []) {
    const key = progressFingerprint(atom);
    if (!key) {
      kept.push(atom);
      continue;
    }
    const previous = repeated.get(key);
    if (!previous || Number(atom.sequence || 0) >= Number(previous.atom.sequence || 0)) {
      repeated.set(key, { atom, count: (previous ? previous.count : 0) + 1 });
    } else {
      previous.count++;
    }
  }
  for (const { atom, count } of repeated.values()) {
    if (count > 1) {
      atom.invariant = false;
      atom.effective_importance = Math.min(Number(atom.effective_importance) || 0, 0.1);
    }
    kept.push(atom);
  }
  return kept.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
}

// Ringkasan URich sudah berisi atom terpilih. Jika mesin kehilangan memori
// persisten, ringkasan masih bisa dipulihkan tanpa menganggapnya sebagai
// percakapan baru: baca kembali [#sequence], [at:timestamp], heading tipe,
// dan status temporal yang tertulis di ringkasan.
function atomizeSummary(summary, { source = 'conversation', touchedFiles = null, baseIndex = 0 } = {}) {
  const out = [];
  let headingType = 'HISTORY';
  let fallbackIndex = baseIndex;
  for (const raw of String(summary || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(?:DIS-URICH CONTEXT|DCM)\b/i.test(line)) continue;
    if (!line.startsWith('- ') && /:$/.test(line)) {
      const heading = line.slice(0, -1).trim();
      headingType = HEADING_TYPE[heading] || 'HISTORY';
      continue;
    }
    if (!line.startsWith('- ')) continue;
    let body = line.slice(2).trim();
    let seq = null;
    const seqMatch = body.match(/^\[#(\d+)\]\s*/);
    if (seqMatch) {
      seq = Number(seqMatch[1]);
      body = body.slice(seqMatch[0].length);
    }
    let time = null;
    const timeMatch = body.match(/\s*\[(?:at|t):([^\]]+)\]\s*$/);
    if (timeMatch) {
      time = timeMatch[1];
      body = body.slice(0, timeMatch.index).trim();
    }
    let status = null;
    const statusMatch = body.match(/\s*\[(ACTIVE|HISTORICAL|SUPERSEDED)\]\s*$/);
    if (statusMatch) {
      status = statusMatch[1];
      body = body.slice(0, statusMatch.index).trim();
    }
    body = body.replace(/\\s+[!?+-]$/, '').trim();
    if (!body) continue;
    const index = Number.isFinite(seq) ? seq : fallbackIndex++;
    const parsedTime = time && !/^\\d{1,2}:\\d{2}$/.test(time) ? time : null;
    const atom = atomFromText(body, {
      type: headingType,
      role: 'assistant',
      index,
      total: Math.max(baseIndex + 1, index + 1),
      source,
      touchedFiles,
      createdAt: parsedTime,
      extractionConfidence: 0.9,
    });
    if (!atom) continue;
    if (status) atom.temporal_status = status;
    out.push(atom);
  }
  // Fallback: ringkasan plain (tanpa baris "- ") tetap di-ingest sebagai satu atom
  // HISTORY, agar konteks lama tidak hilang (paritas dengan IDE).
  if (!out.length && String(summary || '').trim()) {
    const atom = atomFromText(String(summary).trim(), {
      type: 'HISTORY',
      role: 'assistant',
      index: baseIndex,
      total: Math.max(baseIndex + 1, 1),
      source,
      touchedFiles,
      createdAt: null,
      extractionConfidence: 0.9,
    });
    if (atom) out.push(atom);
  }
  return out;
}

function normalizeRelationSchema(atoms) {
  for (const atom of atoms || []) {
    if (!atom || !Array.isArray(atom.relations)) continue;
    atom.relations = atom.relations.map((rel) => ({
      type: (rel && rel.type) || 'RELATED',
      source: (rel && rel.source) || atom.entity || null,
      target: (rel && rel.target) || null,
    }));
  }
  return atoms;
}

function atomizeHistory(history, {
  summary = null,
  source = 'conversation',
  state = null,
  previousAtoms = null,
  ingestSummary = null,
} = {}) {
  const list = Array.isArray(history) ? history : [];
  const previous = Array.isArray(previousAtoms) ? previousAtoms.filter(Boolean) : [];
  const touchedFiles = touchedFileSet(state && state.touchedFiles);
  // Sequence harus monoton lintas siklus kompaksi. Tanpa offset, pesan recent
  // akan mendapat #0..#n dan tampak lebih tua daripada atom hasil kompaksi
  // sebelumnya yang sebenarnya lebih awal.
  const baseIndex = previous.length
    ? previous.reduce((max, atom) => Math.max(max, Number(atom.sequence) || 0), -1) + 1
    : 0;
  const atoms = [];
  // Atom lama dimasukkan lebih dulu agar dedupe mempertahankan waktu/urutan
  // asli saat pesan recent yang sama ikut diproses ulang.
  if (previous.length) atoms.push(...previous);
  for (let i = 0; i < list.length; i++) {
    atoms.push(...atomizeMessage(list[i], { index: baseIndex + i, total: baseIndex + list.length, source, touchedFiles }));
  }
  const shouldIngestSummary = ingestSummary == null ? previous.length === 0 : !!ingestSummary;
  if (shouldIngestSummary && summary && String(summary).trim()) {
    atoms.push(...atomizeSummary(summary, { source, touchedFiles, baseIndex: baseIndex + list.length }));
  }
  if (state) atoms.push(...atomizeState(state, { baseIndex: baseIndex + list.length }));
  return resolveTemporalConflicts(collapseRepeatedProgressAtoms(dedupeAtoms(normalizeRelationSchema(atoms))));
}

function decisionTokenSet(atom) {
  return new Set(tokenize(atom.content));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter++;
  return inter / (a.size + b.size - inter);
}

function clampConfidence(value, fallback = 0.7) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function idList(value) {
  const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return uniqueList(list.map((item) => String(item == null ? '' : item).trim()).filter(Boolean));
}

function semanticKeyFor(atom) {
  const explicit = normalizeText(atom && (atom.semantic_key || atom.semanticKey || atom.predicate));
  if (explicit) return explicit;
  const fallback = atom && (atom.normalized_text || normalizeText(atom.content));
  return `${atom && atom.type ? atom.type : 'HISTORY'}|${(atom && atom.entity) || ''}|${fallback || ''}`;
}

function normalizeIncomingAtom(raw, {
  archiveRef = null,
  sourceMessageIds = null,
  model = null,
  source = 'ai',
} = {}) {
  if (!raw || typeof raw !== 'object') return { error: 'atom bukan object' };
  const content = String(raw.content || raw.text || '').replace(/\s+/g, ' ').trim();
  if (content.length < 3) return { error: 'content kosong' };
  const type = String(raw.type || raw.category || '').toUpperCase();
  if (!ATOM_TYPES.includes(type)) return { error: `tipe tidak dikenal: ${type || '-'}` };
  const confidence = clampConfidence(raw.confidence == null ? raw.extraction_confidence : raw.confidence, 0.7);
  const normalized = normalizeText(content);
  const entity = canonicalEntity(raw.entity || raw.subject || '') || canonicalEntity(extractEntity(content, type)) || null;
  const info = extractCodeInfo(content);
  const relations = (Array.isArray(raw.relations) ? raw.relations : extractRelations(content))
    .map((rel) => ({
      type: String((rel && rel.type) || 'RELATED').toUpperCase(),
      source: canonicalEntity((rel && (rel.source || rel.from)) || entity) || (rel && rel.source) || entity || null,
      target: (rel && (rel.target || rel.to)) == null ? null : String(rel.target || rel.to),
    }))
    .filter((rel) => rel.target);
  const messageIds = uniqueList([
    ...(Array.isArray(sourceMessageIds) ? sourceMessageIds.map(String) : (sourceMessageIds ? [String(sourceMessageIds)] : [])),
    ...idList(raw.source_message_ids || raw.sourceMessageIds || raw.message_ids),
  ]);
  const semanticKey = semanticKeyFor({ ...raw, type, entity, normalized_text: normalized, content });
  const providedId = raw.atom_id || raw.atomId || raw.id || null;
  const base = TYPE_IMPORTANCE[type] == null ? 0.5 : TYPE_IMPORTANCE[type];
  let importance = raw.importance == null ? base : clampConfidence(raw.importance, base);
  const lowConfidence = confidence < CONFIDENCE_REVIEW_THRESHOLD;
  if (lowConfidence) importance = Math.max(0.05, importance * 0.6);
  const createdAt = raw.created_at || raw.createdAt || null;
  const status = String(raw.temporal_status || raw.temporalStatus || '').toUpperCase();
  const atom = {
    atom_id: `atom_${hashText(`${type}|${semanticKey}|${normalized}|${archiveRef ? (archiveRef.id || archiveRef) : ''}`).slice(0, 16)}`,
    model_atom_id: providedId == null ? null : String(providedId),
    type,
    code_kind: raw.code_kind ? String(raw.code_kind).toUpperCase() : codeKindFor(info),
    entity,
    content,
    normalized_text: normalized,
    semantic_key: semanticKey,
    relations,
    importance,
    effective_importance: importance,
    centrality: 0,
    confidence,
    extraction_confidence: confidence,
    claim_confidence: raw.claim_confidence == null ? null : clampConfidence(raw.claim_confidence, null),
    low_confidence: lowConfidence,
    needs_review: confidence < CONFIDENCE_LOW_THRESHOLD,
    relevance: 0,
    sequence: null,
    message_id: messageIds[0] || null,
    source_message_ids: messageIds,
    archive_ref: raw.archive_ref || archiveRef || null,
    speaker: raw.role || raw.speaker || null,
    language: raw.language || detectLanguageHint(content),
    created_at: safeTimestamp(createdAt),
    observed_at: safeTimestamp(createdAt),
    valid_from: raw.valid_from || null,
    valid_until: raw.valid_until || null,
    superseded_by: null,
    supersedes: idList(raw.supersedes || raw.superseded_ids),
    conflicts_with: idList(raw.conflicts_with || raw.conflict_with),
    potential_conflict: false,
    temporal_status: TEMPORAL_STATUSES.has(status) ? status : temporalStatusFor(content),
    source,
    origin: source,
    storage_tier: 'COMPRESSED',
    invariant: raw.invariant === true ||
      INVARIANT_TYPES.has(type) ||
      isMetadata(content) ||
      relations.some((rel) => rel.type === 'REPLACED_BY'),
    loss_tolerance: Math.max(0, Math.min(1, 1 - importance)),
    preserved_at: new Date().toISOString(),
    model: model == null ? null : String(model),
  };
  return { atom };
}

function mergeAiAtoms(existingAtoms, incomingAtoms, options = {}) {
  const existing = (Array.isArray(existingAtoms) ? existingAtoms : []).filter(Boolean).map((atom) => ({ ...atom }));
  const byId = new Map(existing.map((atom) => [atom.atom_id, atom]));
  const semantic = new Map();
  for (const atom of existing) semantic.set(semanticKeyFor(atom), atom);
  let nextSequence = existing.reduce((max, atom) => Math.max(max, Number(atom.sequence) || 0), -1) + 1;
  const newAtoms = [];
  const errors = [];
  const duplicates = [];
  const rejected = [];
  for (const raw of (Array.isArray(incomingAtoms) ? incomingAtoms : [])) {
    const normalized = normalizeIncomingAtom(raw, options);
    if (!normalized.atom) {
      errors.push(normalized.error);
      rejected.push(raw);
      continue;
    }
    const atom = normalized.atom;
    const prior = semantic.get(atom.semantic_key);
    const supersedes = idList(atom.supersedes || atom.superseded_ids);
    const conflicts = idList(atom.conflicts_with || atom.conflict_with);
    const priorConflicts = idList(prior && prior.conflicts_with);
    if (prior && prior.normalized_text === atom.normalized_text && !supersedes.length && !conflicts.length && !priorConflicts.length) {
      prior.confidence = Math.max(Number(prior.confidence) || 0, atom.confidence);
      prior.claim_confidence = prior.claim_confidence == null ? atom.claim_confidence : prior.claim_confidence;
      prior.source_message_ids = uniqueList([...(prior.source_message_ids || []), ...atom.source_message_ids]);
      prior.archive_ref = prior.archive_ref || atom.archive_ref;
      prior.updated_at = atom.preserved_at;
      duplicates.push(atom);
      continue;
    }
    if (prior) {
      atom.potential_conflict = true;
      prior.potential_conflict = true;
      atom.conflicts_with = uniqueList([...(atom.conflicts_with || []), ...(priorConflicts.length ? priorConflicts : [prior.atom_id])]);
      prior.conflicts_with = uniqueList([...(prior.conflicts_with || []), ...(atom.conflicts_with || [])]);
    }


    atom.sequence = nextSequence++;
    newAtoms.push(atom);
    byId.set(atom.atom_id, atom);
    semantic.set(atom.semantic_key, atom);
  }
  const superseded = [];
  const conflicts = [];
  for (const atom of newAtoms) {
    const explicitSupersedes = atom.low_confidence ? [] : atom.supersedes;
    for (const targetId of explicitSupersedes) {
      const target = byId.get(targetId);
      if (!target || target.atom_id === atom.atom_id) continue;
      target.temporal_status = 'SUPERSEDED';
      target.superseded_by = atom.atom_id;
      target.effective_importance = Math.min(Number(target.effective_importance) || 0, 0.2);
      superseded.push(target.atom_id);
    }
    for (const targetId of atom.conflicts_with) {
      const target = byId.get(targetId);
      if (!target || target.atom_id === atom.atom_id) continue;
      target.conflicts_with = uniqueList([...(target.conflicts_with || []), atom.atom_id]);
      target.potential_conflict = true;
      atom.potential_conflict = true;
      conflicts.push(`${atom.atom_id}<->${target.atom_id}`);
    }
  }
  return {
    atoms: [...existing, ...newAtoms],
    added: newAtoms,
    duplicates,
    rejected,
    errors,
    superseded: uniqueList(superseded),
    conflicts: uniqueList(conflicts),
  };
}

function resolveTemporalConflicts(atoms) {
  const list = (atoms || []).slice().sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const decisions = list.filter((a) => a && (a.type === 'DECISION' || a.type === 'CODE_DECISION' || a.type === 'INSTRUCTION'));
  for (let i = 0; i < decisions.length; i++) {
    const older = decisions[i];
    if (!older || older.superseded_by) continue;
    const olderTokens = decisionTokenSet(older);
    for (let j = i + 1; j < decisions.length; j++) {
      const newer = decisions[j];
      if (!newer || newer.temporal_status === 'HISTORICAL') continue;
      const sameEntity = older.entity && newer.entity && sharesEntityKey(older.entity, newer.entity);
      const similar = jaccard(olderTokens, decisionTokenSet(newer)) >= 0.5;
      const olderOld = older.temporal_status === 'HISTORICAL' || older.temporal_status === 'SUPERSEDED';
      const explicitUpdate = /\b(now|currently|sekarang|saat ini|mulai sekarang|mengubah|diubah|ganti|diganti|replace|replaced|supersed|diputuskan|memutuskan|beralih|migrasi|migrate|instead|bukan lagi)\b/i.test(String(newer.content || ''));
      const explicitDecision = /\b(keputusan|decision|dipilih|disetujui|ditetapkan)\b/i.test(String(older.content || '')) &&
        /\b(keputusan|decision|dipilih|disetujui|ditetapkan)\b/i.test(String(newer.content || ''));
      if (!sameEntity && !similar) continue;
      // Similar wording is not proof of contradiction: require an explicit
      // update signal atau dua pernyataan keputusan eksplisit yang bersaing.
      if (!olderOld && !explicitUpdate && !(explicitDecision && similar)) continue;
      if (newer.temporal_status !== 'ACTIVE' && !olderOld) continue;
      older.temporal_status = 'SUPERSEDED';
      older.superseded_by = newer.atom_id;
      older.effective_importance = Math.min(Number(older.effective_importance) || 0, 0.2);
    }
  }
  for (const rel of list.filter((a) => a && a.type === 'RELATION' && (a.relations || []).some((r) => r.type === 'REPLACED_BY'))) {
    const target = rel.relations.find((r) => r.type === 'REPLACED_BY').target;
    const source = rel.entity;
    if (!source) continue;
    for (const atom of list) {
      if (!atom || atom === rel) continue;
      if (atom.entity && sharesEntityKey(atom.entity, source)) {
        atom.temporal_status = 'SUPERSEDED';
        atom.superseded_by = target;
        atom.effective_importance = Math.min(Number(atom.effective_importance) || 0, 0.2);
      }
    }
  }
  return list;
}

function buildRelationGraph(atoms) {
  const list = atoms || [];
  const byEntity = new Map();
  const byId = new Map();
  for (const atom of list) {
    if (!atom) continue;
    byId.set(atom.atom_id, atom);
    for (const key of entityKeys(atom.entity)) {
      if (!byEntity.has(key)) byEntity.set(key, []);
      byEntity.get(key).push(atom);
    }
  }
  const edges = [];
  const degree = new Map();
  const edgeKeys = new Set();
  const semanticRelationKeys = new Set();
  const bump = (value, weight) => {
    const key = canonicalEntity(value);
    if (!key) return;
    degree.set(key, (degree.get(key) || 0) + weight);
  };
  const addEdge = (edge, weight) => {
    edges.push(edge);
    bump(edge.fromEntity, weight);
    if (edge.to) bump(edge.toEntity, weight);
  };

  for (const atom of list) {
    for (const rel of atom.relations || []) {
      const fromEntity = rel.source || atom.entity || null;
      const semanticKey = `${rel.type}|${canonicalEntity(fromEntity)}|${canonicalEntity(rel.target)}`;
      if (semanticRelationKeys.has(semanticKey)) continue;
      semanticRelationKeys.add(semanticKey);
      const targets = [];
      for (const key of entityKeys(rel.target)) {
        for (const candidate of byEntity.get(key) || []) {
          if (candidate !== atom) targets.push(candidate);
        }
      }
      const unique = [...new Map(targets.map((candidate) => [candidate.atom_id, candidate])).values()]
        .slice(0, CO_OCCURRENCE_LIMIT);
      if (!unique.length) {
        edges.push({
          from: atom.atom_id,
          fromEntity,
          type: rel.type,
          toEntity: rel.target,
          to: null,
          weight: 1,
          kind: 'explicit',
        });
        continue;
      }
      for (const target of unique) {
        const pairKey = `${atom.atom_id}|${target.atom_id}|${rel.type}`;
        if (edgeKeys.has(pairKey)) continue;
        edgeKeys.add(pairKey);
        addEdge({
          from: atom.atom_id,
          fromEntity,
          type: rel.type,
          toEntity: target.entity || rel.target,
          to: target.atom_id,
          weight: 1,
          kind: 'explicit',
        }, 1);
      }
    }
  }

  for (const group of byEntity.values()) {
    if (group.length < 2) continue;
    const ranked = group
      .slice()
      .sort((a, b) => (Number(b.effective_importance) || 0) - (Number(a.effective_importance) || 0)
        || (Number(b.sequence) || 0) - (Number(a.sequence) || 0))
      .slice(0, CO_OCCURRENCE_LIMIT);
    const anchor = ranked[0];
    for (const target of ranked.slice(1)) {
      if (!anchor || !target || anchor === target) continue;
      const from = anchor.atom_id < target.atom_id ? anchor : target;
      const to = anchor.atom_id < target.atom_id ? target : anchor;
      const pairKey = `${from.atom_id}|${to.atom_id}|SHARES_ENTITY`;
      if (edgeKeys.has(pairKey)) continue;
      edgeKeys.add(pairKey);
      addEdge({
        from: from.atom_id,
        fromEntity: from.entity || null,
        type: 'SHARES_ENTITY',
        toEntity: to.entity || null,
        to: to.atom_id,
        weight: CO_OCCURRENCE_WEIGHT,
        kind: 'cooccurrence',
      }, CO_OCCURRENCE_WEIGHT);
    }
  }

  const max = Math.max(1, ...degree.values());
  for (const atom of list) {
    const key = canonicalEntity(atom.entity);
    atom.centrality = key ? Math.min(1, (degree.get(key) || 0) / max) : 0;
  }
  return { edges, byEntity, byId, degree };
}

function buildTaskState(atoms) {
  const state = {
    files: [],
    functions: [],
    classes: [],
    dependencies: [],
    errors: [],
    tests: [],
    decisions: [],
    tasks: [],
    nextSteps: [],
    findings: [],
    observations: [],
    experiments: [],
    hypotheses: [],
    constraints: [],
    questions: [],
    sources: [],
    relations: [],
  };
  for (const atom of atoms || []) {
    if (!atom) continue;
    const info = extractCodeInfo(atom.content);
    state.files.push(...info.files);
    state.functions.push(...info.functions);
    state.classes.push(...info.classes);
    state.dependencies.push(...info.dependencies);
    if (atom.type === 'ERROR' || atom.type === 'FAILURE') state.errors.push(atom.content);
    if (atom.type === 'TEST_RESULT') state.tests.push(atom.content);
    if (atom.type === 'DECISION' || atom.type === 'CODE_DECISION') state.decisions.push(atom.content);
    if (atom.type === 'TASK') state.tasks.push(atom.content);
    if (atom.type === 'FINDING') state.findings.push(atom.content);
    if (atom.type === 'OBSERVATION') state.observations.push(atom.content);
    if (atom.type === 'EXPERIMENT') state.experiments.push(atom.content);
    if (atom.type === 'HYPOTHESIS') state.hypotheses.push(atom.content);
    if (atom.type === 'CONSTRAINT') state.constraints.push(atom.content);
    if (atom.type === 'QUESTION' || atom.type === 'UNCERTAINTY') state.questions.push(atom.content);
    if (atom.type === 'SOURCE') state.sources.push(atom.content);
    for (const relation of atom.relations || []) {
      state.relations.push({
        source: relation.source || atom.entity || null,
        type: relation.type,
        target: relation.target || null,
        atom_id: atom.atom_id,
      });
    }
    if (/\b(next step|langkah berikutnya|selanjutnya)\b/i.test(atom.content)) state.nextSteps.push(atom.content);
  }
  return {
    files: uniqueList(state.files),
    functions: uniqueList(state.functions),
    classes: uniqueList(state.classes),
    dependencies: uniqueList(state.dependencies),
    errors: uniqueList(state.errors),
    tests: uniqueList(state.tests),
    decisions: uniqueList(state.decisions),
    tasks: uniqueList(state.tasks),
    nextSteps: uniqueList(state.nextSteps),
    findings: uniqueList(state.findings),
    observations: uniqueList(state.observations),
    experiments: uniqueList(state.experiments),
    hypotheses: uniqueList(state.hypotheses),
    constraints: uniqueList(state.constraints),
    questions: uniqueList(state.questions),
    sources: uniqueList(state.sources),
    relations: state.relations,
  };
}

function dedupeAtoms(atoms) {
  const map = new Map();
  for (const atom of atoms) {
    if (!atom) continue;
    const context = [
      atom.entity,
      atom.source,
      ...(Array.isArray(atom.source_message_ids) ? atom.source_message_ids : []),
      ...extractPaths(atom.content || ''),
    ].filter(Boolean).join('|');
    const key = `${atom.type}|${atom.normalized_text}|${context}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, atom);
      continue;
    }
    const prevSeq = Number(prev.sequence) || 0;
    const nextSeq = Number(atom.sequence) || 0;
    // Konten identik dipertahankan pada kemunculan paling awal agar fakta lama
    // yang ikut diproses ulang tidak "berpindah" ke urutan terbaru.
    if (nextSeq < prevSeq) map.set(key, atom);
    else if (nextSeq === prevSeq && atom.importance > prev.importance) map.set(key, atom);
  }
  return [...map.values()];
}

function selectAtoms(atoms, maxChars, { respectInvariant = true, respectTypePriority = true } = {}) {
  const budget = Math.max(200, Number(maxChars) || 1400);
  const rank = (atom) =>
    (Number(atom.effective_importance) || 0) +
    (Number(atom.centrality) || 0) * 0.15 +
    (atom.temporal_status === 'ACTIVE' ? 0.05 : atom.temporal_status === 'SUPERSEDED' ? -0.3 : 0);
  const typePriority = (atom) => {
    const index = TYPE_ORDER.indexOf(atom.type);
    return index === -1 ? TYPE_ORDER.length : index;
  };
  const sorted = dedupeAtoms(atoms).slice().sort((a, b) => {
    if (respectInvariant && !!b.invariant !== !!a.invariant) return b.invariant ? 1 : -1;
    const diff = rank(b) - rank(a);
    if (diff) return diff;
    if (respectTypePriority) {
      const typeDiff = typePriority(a) - typePriority(b);
      if (typeDiff) return typeDiff;
    }
    return String(a.normalized_text || a.content).localeCompare(String(b.normalized_text || b.content));
  });
  const selected = [];
  let chars = 'DCM (#n=seq; t=HH:MM; !=urgent ?=q -=neg +=pos)'.length;
  const selectedTypes = new Set();
  for (const atom of sorted) {
    const type = TYPE_ORDER.includes(atom.type) ? atom.type : 'HISTORY';
    const status = atom.temporal_status && atom.temporal_status !== 'ACTIVE' ? ` [${atom.temporal_status}]` : '';
    const seq = Number.isFinite(Number(atom.sequence)) ? `[#${atom.sequence}] ` : '';
    const time = TEMPORAL_TYPES.has(atom.type) && atom.created_at ? ` [t:${new Date(atom.created_at).toTimeString().slice(0,5)}]` : '';
    const tone = TEMPORAL_TYPES.has(atom.type) ? (/\?/.test(String(atom.content||'')) ? '?' : (/\b(gagal|error|fail|blocker|masalah)\b/i.test(String(atom.content||'')) ? '-' : (/\b(berhasil|lulus|sukses|ok|pass)\b/i.test(String(atom.content||'')) ? '+' : (/!/.test(String(atom.content||'')) ? '!' : '')))) : '';
    const toneSuffix = tone ? ` ${tone}` : '';
    const headingCost = selectedTypes.has(type) ? 0 : TYPE_HEADING[type].length + 2;
    const cost = headingCost + seq.length + atom.content.length + status.length + time.length + toneSuffix.length + 3;
    if (chars + cost > budget) {
      // Kebijakan overflow: atom invariant tidak boleh hilang hanya karena
      // kontennya lebih besar dari sisa anggaran. reconstructAtoms() yang
      // akan memotong konten agar hasil akhir tetap <= maxChars.
      if (respectInvariant && atom.invariant) selected.push(atom);
      continue;
    }
    selected.push(atom);
    chars += cost;
    selectedTypes.add(type);
  }
  return selected;
}

function ensureMetadata(summary, history, maxChars = Infinity) {
  const source = (Array.isArray(history) ? history : []).map((m) => (m && m.content ? String(m.content) : '')).join('\n');
  let out = String(summary || '');
  const append = (line) => {
    const addition = `${out ? '\n' : ''}- ${line}`;
    if (out.length + addition.length > maxChars) return false;
    out += addition;
    return true;
  };
  for (const [name, re] of METADATA) {
    if (!re.test(source) || re.test(out)) continue;
    const line = splitSentences(source).find((s) => re.test(s));
    if (line && !append(`${name}: ${line.slice(0, 150)}`)) break;
  }
  const paths = extractPaths(source);
  if (paths.length) {
    const missing = paths.filter((p) => !out.toLowerCase().includes(p));
    if (missing.length) append(`file/path penting: ${missing.slice(0, 6).join(', ')}`);
  }
  return out.trim();
}

function reconstructAtoms(atoms, { history = null, maxChars = Infinity } = {}) {
  const list = (atoms || []).map((entry) => (entry && entry.atom && typeof entry.atom === 'object' ? entry.atom : entry)).filter(Boolean);
  const rawLimit = Number(maxChars);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : Infinity;
  const header = 'DCM (#n=seq; t=HH:MM; !=urgent ?=q -=neg +=pos)';
  const groups = new Map();
  for (const atom of list) {
    if (!atom) continue;
    const type = TYPE_ORDER.includes(atom.type) ? atom.type : 'HISTORY';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(atom);
  }
  for (const items of groups.values()) items.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const toneMarker = (atom) => {
    if (!TEMPORAL_TYPES.has(atom.type)) return '';
    const c = String(atom.content || '');
    if (/!/.test(c)) return '!';
    if (/\?/.test(c)) return '?';
    if (/\b(gagal|error|fail|blocker|masalah)\b/i.test(c)) return '-';
    if (/\b(berhasil|lulus|sukses|ok|pass)\b/i.test(c)) return '+';
    return '';
  };
  const lineFor = (atom, content = atom.content) => {
    const status = atom.temporal_status && atom.temporal_status !== 'ACTIVE' ? ` [${atom.temporal_status}]` : '';
    const seq = Number.isFinite(Number(atom.sequence)) ? `[#${atom.sequence}] ` : '';
    const time = TEMPORAL_TYPES.has(atom.type) && atom.created_at ? ` [t:${new Date(atom.created_at).toTimeString().slice(0,5)}]` : '';
    const tone = toneMarker(atom);
    return `- ${seq}${content}${status}${time}${tone ? ` ${tone}` : ''}`;
  };
  const included = new Map();
  const headingUsed = new Set();
  let used = header.length;
  const tryInclude = (atom, allowTruncate) => {
    if (included.has(atom)) return true;
    const type = TYPE_ORDER.includes(atom.type) ? atom.type : 'HISTORY';
    const headingCost = headingUsed.has(type) ? 0 : 1 + `${TYPE_HEADING[type]}:`.length;
    const fullCost = 1 + headingCost + lineFor(atom).length;
    if (used + fullCost <= limit) {
      included.set(atom, atom.content);
      used += fullCost;
      headingUsed.add(type);
      return true;
    }
    if (!allowTruncate) return false;
    const prefixCost = 1 + headingCost + lineFor(atom, '').length;
    const available = limit - used - prefixCost;
    const marker = '…[dipotong]';
    if (available < 32 + marker.length) return false;
    let content = String(atom.content || '');
    if (content.length > available) content = `${content.slice(0, Math.max(0, available - marker.length)).trim()}${marker}`;
    const cost = 1 + headingCost + lineFor(atom, content).length;
    if (used + cost > limit) return false;
    included.set(atom, content);
    used += cost;
    headingUsed.add(type);
    return true;
  };
  // Invariant mendapat klaim anggaran pertama; konten boleh dipotong agar
  // hasil akhir tetap menghormati batas karakter.
  for (const type of TYPE_ORDER) {
    for (const atom of groups.get(type) || []) if (atom.invariant) tryInclude(atom, true);
  }
  for (const type of TYPE_ORDER) {
    for (const atom of groups.get(type) || []) if (!atom.invariant) tryInclude(atom, false);
  }
  const lines = [header];
  for (const type of TYPE_ORDER) {
    const items = (groups.get(type) || []).filter((atom) => included.has(atom));
    if (!items.length) continue;
    lines.push(`${TYPE_HEADING[type]}:`);
    for (const atom of items) lines.push(lineFor(atom, included.get(atom)));
  }
  let out = lines.join('\n').trim();
  if (history) out = ensureMetadata(out, history, limit);
  if (Number.isFinite(limit) && out.length > limit) {
    const marker = '\n…[dipotong]';
    out = `${out.slice(0, Math.max(0, limit - marker.length)).trimEnd()}${marker}`;
  }
  return out;
}

function contextRoot(config = {}) {
  return path.resolve(String(config.contextEngineDir || path.join(os.homedir(), '.niyusha', 'context')));
}

function memoryFile({ config = {}, workspace = process.cwd(), sessionId = 'default' } = {}) {
  const workspaceKey = hashText(path.resolve(String(workspace))).slice(0, 24);
  return path.join(contextRoot(config), workspaceKey, `${safePart(sessionId, 'session')}.json`);
}

function writeAtomic(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function readArchiveRecords({ config = {}, workspace = process.cwd(), sessionId = 'default' } = {}) {
  const file = archiveFile({ config, workspace, sessionId });
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function scoreAtoms(atoms, query, { limit = 8 } = {}) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const intents = INTENT_RULES.filter(([, re]) => re.test(String(query || ''))).map(([type]) => type);
  const scored = [];
  for (const atom of atoms || []) {
    const aTokens = tokenize(`${atom.content} ${atom.normalized_text || ''}`);
    if (!aTokens.length) continue;
    let hits = 0;
    for (const token of qTokens) if (aTokens.includes(token)) hits++;
    if (!hits) continue;
    const overlap = hits / qTokens.length;
    const entityText = [atom.entity, ...(atom.relations || []).flatMap((r) => [r.source, r.target])]
      .filter(Boolean).join(' ');
    const entityTokens = tokenize(entityText);
    const entityHits = qTokens.filter((token) => entityTokens.includes(token)).length;
    const entityBoost = entityHits ? Math.min(0.3, entityHits / qTokens.length * 0.3) : 0;
    const intentBoost = intents.includes(atom.type) ? 0.4 : 0;
    const wantsHistory = intents.includes('HISTORY');
    const createdAt = atom.created_at || atom.observed_at || null;
    const ageDays = createdAt ? Math.max(0, (Date.now() - new Date(createdAt).getTime()) / 86400000) : 0;
    const protectedAtom = atom.invariant === true || (atom.type === 'GOAL' && atom.temporal_status === 'ACTIVE') || Number(atom.importance || 0) >= 0.9;
    const ageDecay = protectedAtom ? 0 : -Math.min(0.12, ageDays / 365);
    const temporalBoost =
      atom.temporal_status === 'SUPERSEDED' ? -0.35 : atom.temporal_status === 'HISTORICAL' ? -0.05 : 0.1;
    const score =
      overlap +
      entityBoost +
      Number(atom.importance || 0) * 0.5 +
      intentBoost +
      (Number(atom.centrality) || 0) * 0.15 +
      (wantsHistory ? temporalBoost * 2 : temporalBoost) +
      ageDecay;
    scored.push({ atom, score, intents });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit));
}

function intentSatisfied(type, atoms, present) {
  if (present.has(type)) return true;
  const related = INTENT_RELATED_TYPES[type];
  if (related && atoms.some((atom) => related.has(atom.type))) return true;
  const contentRule = INTENT_CONTENT_RULES[type];
  if (contentRule && atoms.some((atom) => contentRule.test(String(atom.content || '')))) return true;
  if (type === 'CODE_CONTEXT' && atoms.some((atom) => extractPaths(atom.content).length > 0)) return true;
  return false;
}

function missingIntents(atoms, query) {
  const intents = INTENT_RULES.filter(([, re]) => re.test(String(query || ''))).map(([type]) => type);
  if (!intents.length) return [];
  const list = (atoms || []).filter(Boolean);
  const present = new Set(list.map((atom) => atom.type));
  return intents.filter((type) => !intentSatisfied(type, list, present));
}

function expandRelations(atoms, picked, graph, limit) {
  const pickedEntries = (picked || []).filter((entry) => entry && entry.atom);
  const pickedIds = new Set(pickedEntries.map((entry) => entry.atom.atom_id));
  const pickedEntities = new Set();
  const addEntity = (value) => { for (const key of entityKeys(value)) pickedEntities.add(key); };

  for (const { atom } of pickedEntries) {
    if (atom.entity) addEntity(atom.entity);
    for (const relation of atom.relations || []) {
      addEntity(relation.target);
      addEntity(relation.source);
    }
  }

  const related = [];
  for (const atom of atoms || []) {
    if (!atom || pickedIds.has(atom.atom_id)) continue;
    const relatedByRelation = (atom.relations || []).some((r) =>
      [...entityKeys(r.target), ...entityKeys(r.source)].some((key) => pickedEntities.has(key))
    );
    const relatedByEntity = atom.entity && entityKeys(atom.entity).some((key) => pickedEntities.has(key));
    const relatedByEdge = (graph.edges || []).some((edge) =>
      (pickedIds.has(edge.from) && edge.to === atom.atom_id) ||
      (pickedIds.has(edge.to) && edge.from === atom.atom_id)
    );
    if (relatedByRelation || relatedByEntity || relatedByEdge) related.push(atom);
  }

  const temporal = related.filter((atom) =>
    ['HISTORICAL', 'SUPERSEDED'].includes(atom.temporal_status) ||
    (atom.relations || []).some((r) => r.type === 'REPLACED_BY')
  );
  const optional = related.filter((atom) => !temporal.includes(atom));
  const rank = (a, b) =>
    (Number(b.effective_importance) || 0) - (Number(a.effective_importance) || 0) ||
    (Number(b.sequence) || 0) - (Number(a.sequence) || 0);
  temporal.sort(rank);
  optional.sort(rank);

  const base = pickedEntries.map((entry) => entry.atom);
  const softLimit = Math.max(Number(limit) || 8, base.length);
  const optionalRoom = Math.max(0, softLimit - base.length - temporal.length);
  const merged = [...base, ...temporal, ...optional.slice(0, optionalRoom)];
  return dedupeAtoms(merged).map((atom) =>
    pickedEntries.find((entry) => entry.atom.atom_id === atom.atom_id) ||
    { atom, score: 1, intents: [], related: true }
  );
}

/**
 * DIS-URICH Context Engine
 *
 * Semantic atomization, two-tier memory management, and retrieval engine.
 * Compresses conversation context while preserving knowledge and relationships.
 *
 * @class ContextEngine
 * @param {Object} options - Configuration options
 * @param {Object} [options.config={}] - Configuration object
 * @param {string} [options.workspace=process.cwd()] - Workspace path
 * @param {string} [options.sessionId='default'] - Session identifier
 */
class ContextEngine {
  constructor({ config = {}, workspace = process.cwd(), sessionId = 'default' } = {}) {
    this.config = config || {};
    this.workspace = path.resolve(String(workspace || process.cwd()));
    this.sessionId = safePart(sessionId, 'session');
    this.file = memoryFile({ config: this.config, workspace: this.workspace, sessionId: this.sessionId });
    this.data = null;
    this._archiveCache = null;
  }

  _empty() {
    return {
      version: 2,
      schema: 'DIS-URICH/2',
      workspace: this.workspace,
      session_id: this.sessionId,
      updated_at: null,
      atoms: [],
      task_state: null,
      stats: {
        compressions: 0,
        retrievals: 0,
        fallbacks: 0,
        last_query: null,
        last_retrieval: null,
        last_checkpoint: null,
        last_atom_count: 0,
      },
    };
  }

  /**
   * Load data from storage (lazy initialization)
   * @returns {Object} Engine data with atoms and stats
   */
  load() {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const base = this._empty();
      this.data = {
        ...base,
        ...raw,
        atoms: Array.isArray(raw.atoms) ? raw.atoms : [],
        stats: { ...base.stats, ...(raw.stats || {}) },
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = this._empty();
    }
    return this.data;
  }

  /**
   * Save data to storage
   * @returns {Object} Saved data
   */
  save() {
    const data = this.load();
    data.updated_at = new Date().toISOString();
    writeAtomic(this.file, JSON.stringify(data, null, 2));
    return data;
  }

  /**
   * Atomize conversation history into semantic atoms
   * @param {Array} history - Conversation history
   * @param {Object} [options] - Atomization options
   * @param {string} [options.summary=null] - Summary text
   * @param {string} [options.source='conversation'] - Source type
   * @returns {Array} Array of semantic atoms
   */
  atomize(history, { summary = null, source = 'conversation' } = {}) {
    return atomizeHistory(history, { summary, source });
  }

  getAtoms() {
    const data = this.load();
    return Array.isArray(data.atoms) ? data.atoms : [];
  }

  ingestAtoms(rawAtoms, {
    history = [],
    summary = null,
    state = null,
    maxChars = null,
    query = null,
    archiveRef = null,
    sourceMessageIds = null,
    model = null,
  } = {}) {
    const data = this.load();
    const existing = Array.isArray(data.atoms) ? data.atoms : [];
    const baseIndex = existing.reduce((max, atom) => Math.max(max, Number(atom.sequence) || 0), -1) + 1;
    const stateAtoms = state ? atomizeState(state, { baseIndex }) : [];
    const seed = [...existing];
    for (const atom of stateAtoms) {
      if (!seed.some((item) => item.atom_id === atom.atom_id)) seed.push(atom);
    }
    const merged = mergeAiAtoms(seed, rawAtoms, {
      archiveRef,
      sourceMessageIds,
      model,
      source: 'ai',
    });
    if (Array.isArray(rawAtoms) && rawAtoms.length && !merged.added.length && !merged.duplicates.length) {
      throw new Error(`semua atom AI ditolak: ${merged.errors.slice(0, 3).join('; ') || 'tidak ada atom valid'}`);
    }
    buildRelationGraph(merged.atoms);
    const taskState = buildTaskState(merged.atoms);
    const budget = maxChars == null ? Number(this.config.contextEngineMemoryChars) || 1400 : maxChars;
    const budgetSelected = selectAtoms(merged.atoms, budget);
    let atoms = budgetSelected;
    if (query) {
      const relevant = scoreAtoms(merged.atoms, query, { limit: Math.max(3, Math.ceil(budget / 40)) });
      const relevantIds = new Set(relevant.map((entry) => entry.atom.atom_id));
      const candidates = merged.atoms.filter((atom) => relevantIds.has(atom.atom_id) || atom.invariant);
      atoms = selectAtoms(candidates, budget);
    }
    const text = reconstructAtoms(atoms, { history, maxChars: budget });
    const selectedByType = {};
    const selectedByTemporalStatus = {};
    let selectedContentChars = 0;
    let invariantSelected = 0;
    for (const atom of atoms) {
      const type = TYPE_ORDER.includes(atom.type) ? atom.type : 'HISTORY';
      const status = atom.temporal_status || 'ACTIVE';
      if (!selectedByType[type]) selectedByType[type] = { count: 0, contentChars: 0 };
      selectedByType[type].count++;
      selectedByType[type].contentChars += atom.content.length;
      selectedByTemporalStatus[status] = (selectedByTemporalStatus[status] || 0) + 1;
      selectedContentChars += atom.content.length;
      if (atom.invariant) invariantSelected++;
    }
    data.atoms = atoms;
    data.task_state = taskState;
    data.archive_refs = uniqueList([...(data.archive_refs || []), archiveRef && archiveRef.id ? `${archiveRef.id}|${archiveRef.file || ''}` : '']);
    const review = new Map();
    for (const atom of merged.atoms) {
      if (!(atom.low_confidence || atom.needs_review || atom.potential_conflict)) continue;
      review.set(atom.atom_id, {
        atom_id: atom.atom_id,
        type: atom.type,
        content: atom.content.slice(0, 240),
        confidence: atom.confidence,
        temporal_status: atom.temporal_status,
        archive_ref: atom.archive_ref || null,
        source_message_ids: atom.source_message_ids || [],
        supersedes: atom.supersedes || [],
        conflicts_with: atom.conflicts_with || [],
      });
    }
    data.review_queue = [...review.values()].slice(-100);
    data.stats.compressions += 1;
    data.stats.ai_compressions = (Number(data.stats.ai_compressions) || 0) + 1;
    data.stats.last_atom_count = atoms.length;
    this.save();
    return {
      atoms,
      totalAtoms: merged.atoms.length,
      summary: text,
      taskState,
      added: merged.added.length,
      duplicates: merged.duplicates.length,
      superseded: merged.superseded,
      conflicts: merged.conflicts,
      rejected: merged.rejected.length,
      errors: merged.errors,
      stats: {
        compressions: data.stats.compressions,
        ai: true,
        atoms: atoms.length,
        totalAtoms: merged.atoms.length,
        chars: text.length,
        requestedBudgetChars: budget,
        summaryWithinBudget: text.length <= budget,
        budgetSelectedAtoms: budgetSelected.length,
        queryFilteredAtoms: budgetSelected.length - atoms.length,
        omittedAtoms: merged.atoms.length - atoms.length,
        invariantCandidates: merged.atoms.filter((atom) => atom.invariant).length,
        invariantSelected,
        selectedContentChars,
        formattingChars: Math.max(0, text.length - selectedContentChars),
        selectedByType,
        selectedByTemporalStatus,
        addedAtoms: merged.added.length,
        duplicateAtoms: merged.duplicates.length,
        rejectedAtoms: merged.rejected.length,
        supersededAtoms: merged.superseded.length,
        conflictAtoms: merged.conflicts.length,
      },
    };
  }

  /**
   * Compress conversation history into semantic atoms
   *
   * @param {Object} options - Compression options
   * @param {Array} [options.history=[]] - Conversation history
   * @param {string} [options.summary=null] - Summary text
   * @param {Object} [options.state=null] - State object
   * @param {number} [options.maxChars=null] - Maximum characters for compressed memory
   * @param {string} [options.query=null] - Query for selective reconstruction
   * @returns {Object} Compressed result with atoms and stats
   */
  compress({ history = [], summary = null, state = null, maxChars = null, query = null } = {}) {
    const data = this.load();
    const previousAtoms = Array.isArray(data.atoms) ? data.atoms : [];
    const all = atomizeHistory(history, {
      summary,
      state,
      previousAtoms,
      ingestSummary: previousAtoms.length === 0,
    });
    const budget = maxChars == null ? Number(this.config.contextEngineMemoryChars) || 1400 : maxChars;
    buildRelationGraph(all);
    const taskState = buildTaskState(all);
    const budgetSelected = selectAtoms(all, budget);
    let atoms = budgetSelected;
    if (query) {
      const relevant = scoreAtoms(all, query, { limit: Math.max(3, Math.ceil(budget / 40)) });
      const relevantIds = new Set(relevant.map((r) => r.atom.atom_id));
      const queryCandidates = all.filter((atom) => relevantIds.has(atom.atom_id) || atom.invariant);
      atoms = selectAtoms(queryCandidates, budget);
    }
    const text = reconstructAtoms(atoms, { history, maxChars: budget });
    const selectedByType = {};
    const selectedByTemporalStatus = {};
    let selectedContentChars = 0;
    let invariantSelected = 0;
    for (const atom of atoms) {
      const type = TYPE_ORDER.includes(atom.type) ? atom.type : 'HISTORY';
      const status = atom.temporal_status || 'ACTIVE';
      const seq = Number.isFinite(Number(atom.sequence)) ? `[#${atom.sequence}] ` : '';
      const TEMPORAL_TYPES = new Set(['GOAL','DECISION','CODE_DECISION','FAILURE','RESOLVED','STATE','TASK','INSTRUCTION','ERROR','TEST_RESULT']);
      const time = TEMPORAL_TYPES.has(atom.type) && atom.created_at ? ` [t:${new Date(atom.created_at).toTimeString().slice(0,5)}]` : '';
      const tone = TEMPORAL_TYPES.has(atom.type) ? (/\?/.test(String(atom.content||'')) ? '?' : (/\b(gagal|error|fail|blocker|masalah)\b/i.test(String(atom.content||'')) ? '-' : (/\b(berhasil|lulus|sukses|ok|pass)\b/i.test(String(atom.content||'')) ? '+' : (/!/.test(String(atom.content||'')) ? '!' : '')))) : '';
      const toneSuffix = tone ? ` ${tone}` : '';
      const renderedChars = seq.length + atom.content.length +
        (status === 'ACTIVE' ? 0 : ` [${status}]`.length) + time.length + toneSuffix.length;
      if (!selectedByType[type]) selectedByType[type] = { count: 0, contentChars: 0 };
      selectedByType[type].count++;
      selectedByType[type].contentChars += renderedChars;
      selectedByTemporalStatus[status] = (selectedByTemporalStatus[status] || 0) + 1;
      selectedContentChars += renderedChars;
      if (atom.invariant) invariantSelected++;
    }
    data.atoms = atoms;
    data.task_state = taskState;
    data.stats.compressions += 1;
    data.stats.last_atom_count = atoms.length;
    this.save();
    return {
      atoms,
      totalAtoms: all.length,
      summary: text,
      taskState,
      stats: {
        compressions: data.stats.compressions,
        atoms: atoms.length,
        totalAtoms: all.length,
        chars: text.length,
        requestedBudgetChars: budget,
        summaryWithinBudget: text.length <= budget,
        budgetSelectedAtoms: budgetSelected.length,
        queryFilteredAtoms: budgetSelected.length - atoms.length,
        omittedAtoms: all.length - atoms.length,
        invariantCandidates: all.filter((atom) => atom.invariant).length,
        invariantSelected,
        selectedContentChars,
        formattingChars: Math.max(0, text.length - selectedContentChars),
        selectedByType,
        selectedByTemporalStatus,
      },
    };
  }

  _archiveFile() {
    return archiveFile({ config: this.config, workspace: this.workspace, sessionId: this.sessionId });
  }

  _cachedArchiveAtoms() {
    const file = this._archiveFile();
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { mtime = 0; }
    if (this._archiveCache && this._archiveCache.mtime === mtime) {
      return this._archiveCache.atoms;
    }
    const atoms = [];
    for (const record of readArchiveRecords({ config: this.config, workspace: this.workspace, sessionId: this.sessionId })) {
      atoms.push(...atomizeHistory(record.messages || [], { summary: record.summary, source: 'archive', state: record.state || null }));
    }
    this._archiveCache = { mtime, atoms };
    return atoms;
  }

  /**
   * Retrieve relevant context atoms for a query
   *
   * @param {string} query - Search query
   * @param {Object} [options] - Retrieval options
   * @param {Array} [options.history=null] - Conversation history for context
   * @param {number} [options.limit=8] - Maximum atoms to retrieve
   * @param {boolean} [options.useArchive=true] - Whether to use archive fallback
   * @returns {Object} Retrieval result with atoms, context, and stats
   */
  retrieve(query, { history = null, limit = 8, useArchive = true } = {}) {
    const data = this.load();
    let candidates = data.atoms;
    let picked = scoreAtoms(candidates, query, { limit });
    let selected = expandRelations(candidates, picked, buildRelationGraph(candidates), limit);
    let fallback = false;
    let reason = null;
    if (useArchive) {
      const archived = this._cachedArchiveAtoms();
      const currentKeys = new Set(candidates.map((atom) => `${atom.type}|${atom.normalized_text}`));
      const archiveOnly = archived.filter((atom) => !currentKeys.has(`${atom.type}|${atom.normalized_text}`));
      candidates = [...candidates, ...archiveOnly];
      picked = scoreAtoms(candidates, query, { limit });
      selected = expandRelations(candidates, picked, buildRelationGraph(candidates), limit);
      fallback = selected.some((entry) => entry.atom && entry.atom.source === 'archive');
      if (fallback) {
        reason = !data.atoms.length ? 'memory kosong/tidak cocok' : 'relevansi diperluas dengan kandidat arsip';
      }
    }
    const missing = missingIntents(selected.map((p) => p.atom), query);
    const retrievedAtoms = [];
    for (const entry of selected || []) {
      let raw = entry;
      if (raw && raw.atom && typeof raw.atom === 'object') raw = raw.atom;
      if (raw) retrievedAtoms.push(raw);
    }
    const context = reconstructAtoms(retrievedAtoms);
    const sufficient = retrievedAtoms.length > 0 && missing.length === 0;
    data.stats.retrievals += 1;
    if (fallback) data.stats.fallbacks += 1;
    data.stats.last_query = String(query || '');
    data.stats.last_retrieval = {
      at: new Date().toISOString(),
      atoms: retrievedAtoms.length,
      fallback,
      reason,
      missing,
      sufficient,
    };
    this.save();
    return { atoms: retrievedAtoms, context, fallback, reason, missing, sufficient, stats: { ...data.stats } };
  }

  /**
   * Create a checkpoint of current state
   * @param {Object} [options] - Checkpoint options
   * @param {Array} [options.history=[]] - Conversation history
   * @param {string} [options.summary=null] - Summary text
   * @param {Object} [options.state=null] - State object
   * @param {string} [options.mode='urich'] - Compaction mode
   * @returns {Object} Checkpoint data
   */
  checkpoint({ history = [], summary = null, state = null, mode = 'urich' } = {}) {
    const record = archiveHistory({
      config: this.config,
      workspace: this.workspace,
      sessionId: this.sessionId,
      history,
      summary,
      state,
      mode,
    });
    this._archiveCache = null;
    const data = this.load();
    data.task_state = buildTaskState(atomizeHistory(history, { summary, state }));
    data.stats.last_checkpoint = { id: record.checkpoint_id, file: record.file, at: record.created_at, task_state: data.task_state };
    this.save();
    return record;
  }

  /**
   * Get engine statistics
   * @returns {Object} Stats including atom counts and compression info
   */
  getStats() {
    const data = this.load();
    return {
      file: this.file,
      workspace: this.workspace,
      session_id: this.sessionId,
      atoms: data.atoms.length,
      taskState: data.task_state,
      ...data.stats,
    };
  }

  /**
   * Get current task state
   * @returns {Object|null} Task state or null if not available
   */
  getTaskState() {
    const data = this.load();
    if (!data.task_state) data.task_state = buildTaskState(data.atoms);
    return data.task_state;
  }
}

module.exports = {
  ContextEngine,
  ATOM_TYPES,
  TYPE_ORDER,
  atomizeHistory,
  atomizeMessage,
  atomizeState,
  buildRelationGraph,
  canonicalEntity,
  classifyText,
  detectLanguageHint,
  formatTimestamp,
  safeTimestamp,
  dedupeAtoms,
  entityKeys,
  extractPaths,
  memoryFile,
  normalizeText,
  readArchiveRecords,
  reconstructAtoms,
  scoreAtoms,
  selectAtoms,
  tokenize,
};
