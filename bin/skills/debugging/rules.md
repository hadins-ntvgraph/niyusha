# Skill: debugging-investigation — rules ringkas

1. **REPRODUCE dulu** dengan langkah terkecil yang pasti; tanpa reproduce = cuma tebak.
2. **Bisect**: persempit antara perubahan terakhir vs environment (bagi-dua area kode/waktu).
3. Baca error **PERSIS** dari log/stack (kutip baris & nomor): pesan, line, env, versi.
4. Periksa asumsi riak: input kosong/null, timezone/encoding (CRLF/UTF-8), race condition, cache stale.
5. Satu perbaikan → uji. Gagal lagi → ganti hipotesis (JANGAN ulang percobaan identik).
6. Selesai: verifikasi terukur (test/curl/manual) + cek regresi area terkait.