# Skill: refactoring-engineering — rules ringkas

1. **JAGA PERILAKU**: hasil akhir harus sama. Kalau ada test → semua hijau SEBELUM dan SESUDAH.
2. **Langkah kecil**: satu transformasi per langkah (rename → ekstrak → pindah), tiap langkah tersimpan & teruji.
3. Hitung dampak lintas file dulu (`grep` usages; string/documentation juga bisa ikut berubah).
4. JANGAN campur refactor dengan penambahan fitur baru dalam satu perubahan.
5. Berhenti berkala agar user bisa review (staged); laporkan perbaikan terukur, bukan perasaan.