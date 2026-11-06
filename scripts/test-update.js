'use strict';

// ── Tes pemeriksa update (tanpa API key) ───────────────────────────────
// Menguji perbandingan versi, cache, throttle, dan jalur jaringan (pakai
// server lokal via NIYUSHA_UPDATE_URL). Tidak menyentuh cache asli user.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const CACHE = path.join(os.tmpdir(), `niyusha-upd-${process.pid}.json`);
process.env.NIYUSHA_UPDATE_CACHE = CACHE;
// Update checks are disabled in CI unless this explicit override is set.
process.env.NIYUSHA_FORCE_UPDATE_CHECK = '1';

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

const upd = require(path.join(__dirname, '..', 'bin/update'));
const { compareVersions, isNewer, cachedUpdate, checkForUpdate } = upd;

ok('compare 0.2.0 < 0.2.1', compareVersions('0.2.0', '0.2.1') === -1);
ok('compare 0.2.0 == 0.2.0', compareVersions('0.2.0', '0.2.0') === 0);
ok('compare 1.0.0 > 0.9.9', compareVersions('1.0.0', '0.9.9') === 1);
ok('compare 0.2.1 > 0.2.0-beta', compareVersions('0.2.1', '0.2.0-beta') === 1);
ok('compare 0.2.0-beta < 0.2.0', compareVersions('0.2.0-beta', '0.2.0') === -1);
ok('isNewer true', isNewer('0.3.0', '0.2.0') === true);
ok('isNewer false', isNewer('0.2.0', '0.2.0') === false);

// cache: versi lebih baru → notice
fs.writeFileSync(CACHE, JSON.stringify({ checkedAt: Date.now(), latest: '9.9.9' }));
const c1 = cachedUpdate('0.2.0', {});
ok('cachedUpdate: ada versi baru', c1 && c1.updateAvailable && c1.latest === '9.9.9', JSON.stringify(c1));

// cache: versi lama → null
fs.writeFileSync(CACHE, JSON.stringify({ checkedAt: Date.now(), latest: '0.0.1' }));
ok('cachedUpdate: versi lama → null', cachedUpdate('0.2.0', {}) === null);

// disabled → null
ok('cachedUpdate disabled → null', cachedUpdate('0.2.0', { enabled: false }) === null);
process.env.NO_UPDATE_NOTIFIER = '1';
ok('cachedUpdate NO_UPDATE_NOTIFIER → null', cachedUpdate('0.2.0', {}) === null);
delete process.env.NO_UPDATE_NOTIFIER;

// cache kosong + server lokal → checkForUpdate mendeteksi & menulis cache
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ name: 'niyusha', version: '9.9.9' }));
});
server.listen(0, async () => {
  const port = server.address().port;
  process.env.NIYUSHA_UPDATE_URL = `http://127.0.0.1:${port}`;
  // reload modul agar env URL terbaca
  delete require.cache[require.resolve(path.join(__dirname, '..', 'bin/update'))];
  const upd2 = require(path.join(__dirname, '..', 'bin/update'));

  try {
    fs.unlinkSync(CACHE);
  } catch {}
  const r = await upd2.checkForUpdate('0.2.0', { force: true, timeoutMs: 2000 });
  ok('checkForUpdate: deteksi 9.9.9', r && r.updateAvailable && r.latest === '9.9.9', JSON.stringify(r));

  const cacheAfter = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : null;
  ok('cache tertulis setelah cek', !!cacheAfter && cacheAfter.latest === '9.9.9' && typeof cacheAfter.checkedAt === 'number', JSON.stringify(cacheAfter));

  // throttle: fresh cache → tak perlu jaringan (server bisa dimatikan, tetap dapat hasil cache)
  server.close();
  const r2 = await upd2.checkForUpdate('0.2.0', { timeoutMs: 500 });
  ok('throttle: pakai cache tanpa jaringan', r2 && r2.updateAvailable && r2.fromCache === true, JSON.stringify(r2));

  try {
    fs.unlinkSync(CACHE);
  } catch {}
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
});
