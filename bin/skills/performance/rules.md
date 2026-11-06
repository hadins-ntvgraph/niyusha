# Skill: performance-optimization — rules ringkas

1. **UKUR dulu, jangan tebak.** Ambil baseline (waktu/memori/jumlah query) sebelum mengubah apa pun.
2. Cari **bottleneck nyata**: hot path, N+1 query, loop besar, I/O blocking, alokasi berlebih. Pakai profiler bila ada.
3. Prioritas dampak: **algoritma/data-structure > I/O > micro-optimization**. Jangan kejar nanodetik sebelum hot path jelas.
4. **Cache** hanya jika terukur manfaatnya — sebut strategi invalidasi. Kompleksitas tanpa hasil = tolak.
5. Ukur **ulang** setelah perubahan; kalau tak membaik, kembalikan.
6. Verifikasi: sajikan angka **before/after** (ms, memori, query) sebagai bukti.