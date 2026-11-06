#!/usr/bin/env node
'use strict';

// Tes simpan skill dari AI (tool save_skill) + notifikasi skill baru.
// Jalankan: node scripts/test-save-skill.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nsk-'));
process.env.NIYUSHA_SKILLS_DIR = path.join(tmp, 'skills');

const root = path.resolve(__dirname, '..');
const skills = require(path.join(root, 'bin/skills'));
const { Agent } = require(path.join(root, 'bin/ai'));

let pass = 0;
let fail = 0;
function ok(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`PASS ${label}`);
  } else {
    fail++;
    console.log(`FAIL ${label} ${extra}`);
  }
}

const spec = {
  id: 'cloud-fill',
  description: 'Isi awan citra satelit dari citra pembanding',
  body: '# Cloud fill\n\n1. Deteksi awan.\n2. Normalisasi band.\n3. Isi + verifikasi.',
};

(async () => {
  // 1) preview + save ke folder user
  const pv = skills.previewSave(spec);
  ok('preview created', pv && pv.created === true && /\+# Cloud fill/.test(pv.diff));
  ok('preview tidak menyentuh disk', !fs.existsSync(path.join(process.env.NIYUSHA_SKILLS_DIR, spec.id)));
  const saved = skills.saveSkill(spec);
  ok('save ok', saved && !saved.error && fs.existsSync(path.join(saved.dir, 'rules.md')));
  ok('list memuat skill user', skills.list().includes(spec.id));
  ok('index memuat deskripsi', (skills.index({ maxChars: 100000 }) || '').includes('cloud-fill — Isi awan'));
  ok('content memuat body', (skills.content(spec.id) || '').includes('Deteksi awan'));

  // 2) update + diff
  const pv2 = skills.previewSave({ ...spec, body: spec.body + '\n4. Selesai.' });
  ok('preview update', pv2 && pv2.created === false && pv2.diff.includes('+4. Selesai.'));

  // 3) validasi
  ok('tolak id skill bawaan', !!skills.previewSave({ ...spec, id: 'web' }).error);
  ok('tolak id tidak valid', !!skills.previewSave({ ...spec, id: '../x' }).error);
  ok('tolak body kepanjangan', !!skills.previewSave({ ...spec, body: 'x'.repeat(skills.MAX_BODY + 1) }).error);

  // 4) tool save_skill butuh izin + menandai fresh
  const allow = new Agent({ vfs: { root: tmp }, cwd: '/', config: { skills: { auto: true } }, permission: async () => true });
  const res = await allow.executeTool('save_skill', { id: 'pdf-report', description: 'Buat laporan PDF', body: '# Report\n\nGunakan generator + cek visual.' });
  ok('tool save_skill sukses', typeof res === 'string' && /dibuat/.test(res));
  ok('freshSkills terisi', allow.freshSkills.includes('pdf-report'));
  ok('prompt memberi tahu skill baru', allow.systemPrompt().includes('Skill BARU sesi ini') && allow.systemPrompt().includes('pdf-report'));
  await allow.executeTool('use_skill', { name: 'pdf-report' });
  ok('fresh hilang setelah dimuat', !allow.freshSkills.includes('pdf-report'));
  ok('prompt tanpa fresh setelah dimuat', !allow.systemPrompt().includes('Skill BARU sesi ini'));

  const deny = new Agent({ vfs: { root: tmp }, cwd: '/', config: { skills: { auto: true } }, permission: async () => false });
  const denied = await deny.executeTool('save_skill', { id: 'denied-skill', description: 'Tidak boleh', body: '# Nope' });
  ok('tool menghormati penolakan user', /DITOLAK/.test(denied) && !skills.findById('denied-skill'));

  // 5) hapus hanya skill user
  ok('remove skill user', skills.removeSkill('pdf-report') === true && !skills.findById('pdf-report'));
  ok('skill bawaan tidak bisa dihapus', skills.removeSkill('web') === false && !!skills.findById('web'));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
