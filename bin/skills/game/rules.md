# Skill: game-development — rules ringkas

1. **Game loop** jelas: pisahkan update & render, pakai **delta-time** (jangan asumsi FPS tetap).
2. **State** terorganisir (scene/entity); pisahkan logika dari rendering.
3. **Input & physics** deterministik; tangani tabrakan & edge (batas layar, pause, resize).
4. Performa frame: hindari alokasi per-frame, batasi draw call, ukur FPS/dropped frame.
5. Uji dengan **memainkan skenario inti** (bukan cuma compile); cek memori/GC bila berat.
6. Web game: zero-dep bila bisa; kontrol keyboard (a11y); pastikan berhenti saat pause/blur.
7. **Karakter & objek penting harus menyerupai bentuk aslinya** — manusia ya seperti manusia (kepala/tubuh/anggota badan dengan proporsi wajar), burung ya seperti burung (paruh, sayap, ekor), dan seterusnya untuk kendaraan, hewan, bangunan, dll. **Dilarang** mewakilinya dengan lingkaran/kotak/trapesium polos sebagai hasil akhir. Primitif geometry hanya boleh sebagai **kerangka/placeholder** saat pengembangan; sebelum dinyatakan selesai, WAJIB diganti bentuk yang layak: 2D → sprite dari path/gambar yang digambar sendiri dengan siluet & detail memadai; 3D → mesh/model dengan proporsi benar (bukan "kotak jalan" atau "bola bergerak"). Berlaku untuk karakter utama, NPC, hewan, kendaraan, dan objek interaktif penting — bukan untuk partikel/dekorasi kecil.