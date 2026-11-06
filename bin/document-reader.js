'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_PDF_BYTES = 100 * 1024 * 1024;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlText(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function zipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_ARCHIVE_BYTES) {
    throw new Error('Berkas Office kosong atau melewati batas 100 MiB.');
  }
  const min = Math.max(0, buffer.length - 0xffff - 22);
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < min || eocd + 22 > buffer.length) throw new Error('Arsip Office tidak valid (ZIP end record tidak ditemukan).');
  const total = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (total === 0xffff || centralSize === 0xffffffff || offset === 0xffffffff) {
    throw new Error('Arsip Office ZIP64 belum didukung.');
  }
  if (offset + centralSize > eocd) throw new Error('Arsip Office tidak valid (central directory di luar batas).');

  const entries = new Map();
  for (let i = 0; i < total; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Arsip Office tidak valid (central directory rusak).');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const checksum = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > buffer.length) throw new Error('Arsip Office tidak valid (nama entri terpotong).');
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`Entri Office terlalu besar: ${name}`);
    entries.set(name, { flags, method, checksum, compressedSize, uncompressedSize, localOffset });
    offset = entryEnd;
  }

  return {
    read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      if (entry.flags & 1) throw new Error(`Entri Office terenkripsi tidak didukung: ${name}`);
      if (entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
        throw new Error(`Entri Office tidak valid: ${name}`);
      }
      const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
      const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
      const start = entry.localOffset + 30 + nameLength + extraLength;
      const end = start + entry.compressedSize;
      if (end > buffer.length) throw new Error(`Entri Office terpotong: ${name}`);
      const compressed = buffer.subarray(start, end);
      let output;
      if (entry.method === 0) output = compressed;
      else if (entry.method === 8) output = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
      else throw new Error(`Metode kompresi ZIP ${entry.method} tidak didukung: ${name}`);
      if (output.length !== entry.uncompressedSize) throw new Error(`Ukuran entri Office tidak cocok: ${name}`);
      if (crc32(output) !== entry.checksum) throw new Error(`Checksum entri Office tidak cocok: ${name}`);
      return output.toString('utf8');
    },
  };
}

function tagsText(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  return [...String(xml || '').matchAll(re)].map((m) => xmlText(m[1].replace(/<[^>]+>/g, ''))).join('');
}

function extractDocx(buffer) {
  const zip = zipEntries(buffer);
  const xml = zip.read('word/document.xml');
  if (xml == null) throw new Error('DOCX tidak memiliki word/document.xml.');
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((m) => m[1]
      .replace(/<w:tab\b[^>]*\/?\s*>/g, '\t')
      .replace(/<w:br\b[^>]*\/?\s*>/g, '\n'))
    .map((p) => tagsText(p, 'w:t'))
    .filter((p) => p.length);
  return paragraphs.join('\n');
}

function extractXlsx(buffer) {
  const zip = zipEntries(buffer);
  const sharedXml = zip.read('xl/sharedStrings.xml');
  const sharedStrings = sharedXml
    ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => tagsText(m[1], 't'))
    : [];
  const workbook = zip.read('xl/workbook.xml');
  const rels = zip.read('xl/_rels/workbook.xml.rels');
  const targets = new Map();
  if (rels) {
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = (match[1].match(/\bId="([^"]+)"/) || [])[1];
      const target = (match[1].match(/\bTarget="([^"]+)"/) || [])[1];
      if (!id || !target) continue;
      const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('xl', target));
      if (!resolved.startsWith('xl/')) throw new Error('Path sheet di berkas XLSX tidak valid.');
      targets.set(id, resolved);
    }
  }

  const sheets = [];
  if (workbook) {
    for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const attrs = match[1];
      const name = xmlText((attrs.match(/\bname="([^"]*)"/) || [])[1] || `Sheet${sheets.length + 1}`);
      const relId = (attrs.match(/\br:id="([^"]+)"/) || [])[1];
      const target = relId && targets.get(relId);
      if (target) sheets.push({ name, target });
    }
  }
  if (!sheets.length) {
    for (let i = 1; zip.read(`xl/worksheets/sheet${i}.xml`) != null; i++) {
      sheets.push({ name: `Sheet${i}`, target: `xl/worksheets/sheet${i}.xml` });
    }
  }
  if (!sheets.length) throw new Error('XLSX tidak memiliki worksheet yang dapat dibaca.');

  return sheets.map(({ name, target }) => {
    const xml = zip.read(target);
    if (xml == null) throw new Error(`Worksheet tidak ditemukan: ${name}`);
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1];
        const ref = (attrs.match(/\br="([^"]+)"/) || [])[1] || '?';
        const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
        const value = (cellMatch[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        let text = value == null ? '' : xmlText(value);
        if (type === 's' && text !== '') text = sharedStrings[Number(text)] ?? `[shared string ${text} tidak ditemukan]`;
        else if (type === 'inlineStr') text = tagsText((cellMatch[2].match(/<is\b[^>]*>([\s\S]*?)<\/is>/) || [])[1], 't');
        else if (type === 'b') text = text === '1' ? 'TRUE' : text === '0' ? 'FALSE' : text;
        if (text === '') {
          const formula = (cellMatch[2].match(/<f\b[^>]*>([\s\S]*?)<\/f>/) || [])[1];
          if (formula) text = `=${xmlText(formula)} [nilai hasil tidak tersimpan]`;
        }
        if (text !== '') cells.push(`${ref}: ${text}`);
      }
      if (cells.length) rows.push(cells.join(' | '));
    }
    return `SHEET: ${name}${rows.length ? `\n${rows.join('\n')}` : '\n[kosong]'}`;
  }).join('\n\n');
}

function pdfDependencyGuidance(platform) {
  const command = platform === 'win32'
    ? 'winget install --id oschwartz10612.Poppler'
    : platform === 'darwin'
      ? 'brew install poppler'
      : 'sudo apt-get install poppler-utils';
  return `DEPENDENCY_MISSING: pdftotext (Poppler) tidak ditemukan. Niyusha tetap berjalan tanpa instalasi ini. Jika ingin mengaktifkan pembacaan PDF, minta izin pengguna sebelum menjalankan: ${command}. Setelah disetujui, verifikasi dengan "pdftotext -v" lalu ulangi pembacaan.`;
}

function extractPdf(filePath, timeout = 30000) {
  return new Promise((resolve) => {
    fs.stat(filePath, (statError, stat) => {
      if (statError) return resolve({ error: statError.message });
      if (!stat.isFile() || stat.size > MAX_PDF_BYTES) return resolve({ error: 'PDF bukan file biasa atau melebihi batas 100 MiB.' });
      execFile('pdftotext', ['-layout', filePath, '-'], {
        timeout,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          if (error.code === 'ENOENT') return resolve({ error: pdfDependencyGuidance(process.platform) });
          return resolve({ error: `pdftotext gagal: ${String(stderr || error.message).trim().slice(0, 1000)}` });
        }
        const text = String(stdout || '').replace(/\f/g, '\n').trim();
        resolve({ text, scanned: !text });
      });
    });
  });
}

function readDocument(filePath, maxChars = 12000) {
  const ext = path.extname(filePath).toLowerCase();
  const limit = Math.max(100, Math.min(60000, Number(maxChars) || 12000));
  if (ext === '.pdf') {
    return extractPdf(filePath).then((result) => {
      if (result.error) return `ERROR: ${result.error}`;
      if (result.scanned) return 'DOCUMENT_READ PDF\nTidak ditemukan teks yang dapat diekstrak. PDF mungkin hasil scan/gambar; OCR PDF belum tersedia pada pembaca ini.';
      return formatResult('PDF', filePath, result.text, limit);
    });
  }
  if (!['.docx', '.xlsx'].includes(ext)) {
    return Promise.resolve(`ERROR: format ${ext || '(tanpa ekstensi)'} belum didukung. Mendukung PDF berbasis teks, DOCX, dan XLSX; format lama .doc/.xls belum didukung.`);
  }
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) throw new Error('Berkas bukan file biasa atau melebihi batas 100 MiB.');
    const buffer = fs.readFileSync(filePath);
    const text = ext === '.docx' ? extractDocx(buffer) : extractXlsx(buffer);
    const label = ext === '.docx' ? 'DOCX' : 'XLSX';
    const note = ext === '.xlsx' ? '\nCatatan: angka tanggal Excel ditampilkan sebagai nilai mentah; formula memakai nilai cache bila tersedia.' : '';
    return Promise.resolve(formatResult(label, filePath, text, limit) + note);
  } catch (error) {
    return Promise.resolve(`ERROR: gagal membaca ${filePath}: ${error.message}`);
  }
}

function formatResult(format, filePath, text, limit) {
  const content = String(text || '').trim();
  const body = content.slice(0, limit);
  const truncated = content.length > limit ? `\n[...dipotong ${content.length - limit} karakter; naikkan max_chars hingga 60000 untuk membaca lebih banyak]` : '';
  return `DOCUMENT_READ ${format}: ${filePath}\n${body || '[tidak ada teks]'}${truncated}`;
}

module.exports = { extractDocx, extractXlsx, pdfDependencyGuidance, readDocument, zipEntries };
