# Skill: data-engineering — rules ringkas

1. Pahami **sumber & skema** dulu; inventaris kolom/tipe/kualitas sebelum transformasi.
2. **Pipeline idempotent**: dijalankan ulang tidak menduplikasi; pakai checkpoint/watermark.
3. **Transformasi teruji** + data-quality check (null, duplikat, range, referensi).
4. **Skala**: batch vs streaming sesuai kebutuhan; partisi & index; hindari full-scan besar.
5. **Lineage & schema evolution**: dokumentasikan sumber→tujuan; migrasi kolom aman & backward-compatible.
6. Verifikasi: row counts, sampling, dan rekonsiliasi before/after sebagai bukti.