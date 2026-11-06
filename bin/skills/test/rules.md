# Skill: test-engineering — rules ringkas

1. **Ikut framework proyek**: cari konfigurasi nyata (jest/vitest/pytest/mocha) — jangan asumsi stack.
2. Unit: nama deskriptif (perilaku), satu fokus tiap test, pola arrange-act-assert.
3. Tutup jalur penting: normal, edge (kosong/0/batas/panjang), dan error/exception.
4. Test **perilaku**, bukan detail implementasi (biar refactor tidak merusak test).
5. Verifikasi: jalankan command resmi (`npm test` / `pytest ...`) → exit 0; laporkan coverage yang terukur.
6. **Probe nyata, bukan cuma unit**: test hijau ≠ app jalan. Jalankan aplikasinya (server → `background:true`) lalu tembak endpoint/UI/CLI nyata (`curl -I`, cek output) 2–3× bila bind baru. Laporkan hasil probe sebagai bukti, bukan asumsi.