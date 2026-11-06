# Skill: database-engineering — rules ringkas

1. Pahami schema & relasi dulu (baca model/migration), sebelum menulis query.
2. **Query sehat**: pakai index untuk kolom filter/join; hindari N+1 (pilih `join`/`in`); `SELECT` kolom yang dibutuhkan; batasi pagination besar (cursor better).
3. **Integrity**: transaksi untuk tulis multi-langkah; jangan simpan secret (password/token) mentah.
4. **Migration backward-compatible**: boleh add column/index saat runtime; jangan drop tanpa konfirmasi; uji di DB lokal/copy.
5. Jangan jalankan `drop`/`truncate`/`update without where` tanpa backup & konfirmasi user.
6. Verifikasi: jalankan query di DB nyata (hasil/summary), cek `EXPLAIN` bila ragu performa.