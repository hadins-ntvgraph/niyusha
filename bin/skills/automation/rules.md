# Skill: automation-engineering — rules ringkas

1. **Sederhanakan dulu**: pecah jadi langkah kecil yang bisa diuji terpisah sebelum dirangkai.
2. **Idempotent**: menjalankan ulang tidak boleh merusak/duplikat (pakai guard: cek ada/skip/final state).
3. Error handling: tiap langkah berhenti jelas + status exit; log cukup untuk audit (siapa/kapan/apa).
4. Konfigurasi lewat env/argumen, bukan hardcode di dalam script.
5. Jadwal (cron/schedule): atur TZ, hindari overlapping run (lock), kirim notifikasi saat gagal.
6. Verifikasi: jalankan end-to-end 2x (harus sama hasilnya) dan uji jalur gagal.