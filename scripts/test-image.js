'use strict';

// ── Tes lampiran gambar (tanpa API key) ────────────────────────────────
// Menguji _attachImageSpec / _tryAttachDropped / _imgCmd via prototype TUI:
// path host, quote, file://, ~, non-gambar, file hilang, multi, cancel.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { TUI } = require(path.join(__dirname, '..', 'bin/tui'));

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`PASS ${label}`);
  } else {
    fail++;
    console.log(`FAIL ${label} ${extra}`);
  }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-img-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const p1 = path.join(dir, 'a.png');
const p2 = path.join(dir, 'b.jpg');
fs.writeFileSync(p1, PNG);
fs.writeFileSync(p2, PNG);
fs.writeFileSync(path.join(dir, 'notimg.txt'), 'x');

const mk = () => {
  const o = Object.create(TUI.prototype);
  o.pendingImages = [];
  o.msgs = [];
  o.agent = { vfs: { root: dir } };
  o.push = (t, m) => o.msgs.push(`${t}: ${m}`);
  o.render = () => {};
  return o;
};

const t = mk();
ok('attach path host', t._attachImageSpec(p1) === true && t.pendingImages.length === 1);
ok('dataUrl PNG valid', /^data:image\/png;base64,/.test(t.pendingImages[0].dataUrl));
ok('nama file benar', t.pendingImages[0].name === 'a.png');

ok('drop path (tanpa quote)', t._tryAttachDropped(p2) === true && t.pendingImages.length === 2);

const t2 = mk();
ok('drop path ber-quote', t2._tryAttachDropped(`"${p1}"`) === true && t2.pendingImages.length === 1);
ok('drop file:// URI', mk()._tryAttachDropped('file://' + p1) === true);
ok('drop teks biasa → false', mk()._tryAttachDropped('tolong jelaskan kode ini') === false);
ok('drop path non-gambar → false', mk()._tryAttachDropped(path.join(dir, 'notimg.txt')) === false);
ok('drop path gambar tak ada → false', mk()._tryAttachDropped('/tidak/ada/x.png') === false);
ok('attach .txt → false', mk()._attachImageSpec(path.join(dir, 'notimg.txt')) === false);

const spaces = path.join(dir, 'with space.png');
fs.writeFileSync(spaces, PNG);
ok('path berspasi (quote) → true', mk()._attachImageSpec(`"${spaces}"`) === true);

const t3 = mk();
t3._imgCmd(`${p1} ${p2}`);
ok('_imgCmd multi (2 file)', t3.pendingImages.length === 2, JSON.stringify(t3.pendingImages.map((i) => i.name)));
t3._imgCmd('cancel');
ok('_imgCmd cancel → bersih', t3.pendingImages.length === 0);

const t4 = mk();
t4._imgCmd('/tidak/ada.png');
ok('_imgCmd gambar tak ada → error, tidak crash', t4.pendingImages.length === 0 && /Cannot attach/.test(t4.msgs.join('|')));

// _pasteCmd — stub clipboard (deterministik)
const p3 = path.join(dir, 'clip.png');
fs.writeFileSync(p3, PNG);
const t5 = mk();
t5._insertInput = () => {};
t5._clipboardImage = () => p3;
t5._clipboardText = () => '';
t5._pasteCmd();
ok('paste: gambar clipboard → attach', t5.pendingImages.length === 1);
ok('paste: temp gambar dihapus', !fs.existsSync(p3));

const t6 = mk();
t6._insertInput = () => {};
t6._clipboardImage = () => null;
t6._clipboardText = () => p1;
t6._pasteCmd();
ok('paste: teks clipboard = path gambar → attach', t6.pendingImages.length === 1);

const t7 = mk();
let inserted = null;
t7._insertInput = (s) => { inserted = s; };
t7._clipboardImage = () => null;
t7._clipboardText = () => 'halo dunia';
t7._pasteCmd();
ok('paste: teks biasa → insert input', inserted === 'halo dunia' && t7.pendingImages.length === 0);

const t8 = mk();
t8._insertInput = () => {};
t8._clipboardImage = () => null;
t8._clipboardText = () => '';
t8._pasteCmd();
ok('paste: clipboard kosong → info, tidak crash', t8.pendingImages.length === 0 && /Clipboard kosong/.test(t8.msgs.join('|')));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
