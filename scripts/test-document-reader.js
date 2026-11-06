'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Agent } = require('../bin/ai');
const { VirtualFS } = require('../bin/vfs');
const skills = require('../bin/skills');
const { extractDocx, extractXlsx, pdfDependencyGuidance, readDocument } = require('../bin/document-reader');
const ideRoot = path.join(__dirname, '..', '..', 'ide-engine', 'tui');
const hasIdeEngine = fs.existsSync(path.join(ideRoot, 'bin', 'ai.js'));
const ideBundle = hasIdeEngine ? {
  Agent: require(path.join(ideRoot, 'bin', 'ai')).Agent,
  VirtualFS: require(path.join(ideRoot, 'bin', 'vfs')).VirtualFS,
  skills: require(path.join(ideRoot, 'bin', 'skills')),
  documentReader: require(path.join(ideRoot, 'bin', 'document-reader')),
} : null;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const source = Buffer.from(text);
    const compressed = zlib.deflateRawSync(source);
    const checksum = crc32(source);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(source.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, compressed);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(source.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

const docx = zip({
  'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Halo &amp; Niyusha</w:t></w:r></w:p><w:p><w:r><w:t>Paragraf kedua</w:t></w:r></w:p></w:body></w:document>',
});
const xlsx = zip({
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Data &amp; Uji" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Nama</t></si><si><r><t>Nilai </t></r><r><t>total</t></r></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Rina</t></is></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>',
});

async function main() {
  let pass = 0;
  const ok = (name, condition) => {
    assert.ok(condition, name);
    pass++;
    console.log(`PASS ${name}`);
  };
  const docxText = extractDocx(docx);
  ok('DOCX extracts paragraphs and decodes XML entities', docxText === 'Halo & Niyusha\nParagraf kedua');
  const xlsxText = extractXlsx(xlsx);
  ok('XLSX resolves worksheet names and shared strings', xlsxText.includes('SHEET: Data & Uji') && xlsxText.includes('A1: Nama') && xlsxText.includes('B1: Nilai total'));
  ok('XLSX reads inline strings and cell references', xlsxText.includes('A2: Rina') && xlsxText.includes('B2: 42'));
  if (ideBundle) {
    ok('IDE bundle extracts the same DOCX and XLSX content', ideBundle.documentReader.extractDocx(docx) === docxText && ideBundle.documentReader.extractXlsx(xlsx) === xlsxText);
  }
  ok('old binary Office formats report unsupported', (await readDocument('legacy.xls')).includes('.doc/.xls belum didukung'));
  ok('missing Poppler guidance preserves zero-dependency install and requests permission', pdfDependencyGuidance('win32').includes('Niyusha tetap berjalan tanpa instalasi') && pdfDependencyGuidance('win32').includes('minta izin pengguna'));
  ok('document-reading skill is available and matched for Indonesian requests', !!skills.findById('document-reading') && skills.match('tolong baca dokumen PDF ini').some((item) => item.id === 'document-reading'));
  ok('skill explains untrusted document content and optional PDF dependency', skills.content('document-reading').includes('data tidak tepercaya') && skills.content('document-reading').includes('pdftotext') && skills.content('document-reading').includes('opsional'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-doc-reader-'));
  try {
    fs.writeFileSync(path.join(dir, 'laporan.docx'), docx);
    fs.writeFileSync(path.join(dir, 'angka.xlsx'), xlsx);
    const vfs = new VirtualFS('document-reader-test', dir);
    const agent = new Agent({ vfs, cwd: '/', config: {} });
    const basePrompt = agent.systemPrompt();
    ok('base prompt carries only the compact skill index, not document rules', basePrompt.includes('document-reading —') && !basePrompt.includes('PDF scan/gambar tidak menghasilkan teks'));
    const tool = agent.allTools.find((entry) => entry.function.name === 'read_document');
    ok('read_document tool is registered with a small path-based schema', !!tool && tool.function.parameters.required.includes('path'));
    const result = await agent.executeTool('read_document', { path: '/laporan.docx' });
    ok('read_document tool extracts local DOCX for the agent', result.includes('DOCUMENT_READ DOCX') && result.includes('Halo & Niyusha'));
    vfs.write('/angka.xlsx', 'staged replacement');
    const staged = await agent.executeTool('read_document', { path: '/angka.xlsx' });
    ok('read_document refuses staged binary document to avoid reading stale content', staged.includes('memiliki perubahan write'));
    if (ideBundle) {
      const ideVfs = new ideBundle.VirtualFS('document-reader-ide-test', dir);
      const ideAgent = new ideBundle.Agent({ vfs: ideVfs, cwd: '/', config: {} });
      const ideResult = await ideAgent.executeTool('read_document', { path: '/laporan.docx' });
      ok('IDE Agent exposes and executes read_document', ideAgent.allTools.some((entry) => entry.function.name === 'read_document') && ideResult.includes('Halo & Niyusha'));
      ok('TUI and IDE document-reading skills stay in parity', skills.content('document-reading') === ideBundle.skills.content('document-reading'));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${pass} pass, 0 fail`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
