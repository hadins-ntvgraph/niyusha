# Skill: deployment-release — rules ringkas

1. **Build deterministik**: kunci versi (lockfile), bersihkan artefak lama sebelum build.
2. **Uji sebelum rilis**: lint + test harus hijau di CI; gagal → jangan publish.
3. Docker: image kecil (multi-stage), jangan root, `.dockerignore`, sertakan healthcheck.
4. **Rencana rollback**: simpan versi sebelumnya; deploy bertahap (bukan straight swap penuh sekali jalan).
5. Sebelum publish: cek isi paket (`--dry-run`), versi dinaikkan benar, changelog singkat.
6. Verifikasi hasil artefak di lingkungan bersih (fresh build) bukan cuma di mesin sendiri.