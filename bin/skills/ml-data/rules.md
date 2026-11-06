# Skill: data-science-ml — rules ringkas

1. Pahami data dulu: baca kolom, tipe, missing, distribusi (head/info/describe). EDA sebelum memodelkan.
2. **Garbage-in warning**: nil missing/duplikat/outlier ditangani & dijelaskan; jangan diam-diam.
3. Pisahkan train/test/val secara proper (hindari data leakage; shuffle bertanggung jawab).
4. Preprocessing konsisten antara train & infer (sama scaling/encoding pilihan).
5. Evaluasi dengan metrik sesuai masalah (klasifikasi: precision/recall/F1; regresi: MAE/RMSE) + baseline; JANGAN klaim akurasi tanpa angka.
6. Reproducible: seed tetap, versi data/model dicatat, kode deterministik.
7. Verifikasi: jalankan skrip (exit 0) & laporkan metrik terukur, bukan "sepertinya lebih baik".