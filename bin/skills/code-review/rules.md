# Skill: code-review — rules ringkas

1. **BAHWA TIDAK ADA YANG DITEBAK**: baca jalur kode nyata (read_file) SAMPAI SELESAI; kutip baris persis + nomor.
2. Urutkan temuan by severity: kritis (bug/security/crash) → menengah (correctness/edge) → nit (style).
3. Fokus: kebenaran, keamanan (input/secret/auth), performa (N+1/loop), lalu readability.
4. Setiap temuan: lokasi, kenapa masalah, dampak, dan SARAN perbaikan konkret (jangan cuma "lebih baik ...").
5. Jangan angkat skenario hipotetis sebagai bug — tandai "catatan" bila belum terverifikasi.
6. Kalau ada jalur tidak lolos audit (belum dibaca), tulis "PERLU VERIFIKASI" — bukan keputusan.
7. Bila diminta sekadar opini, katakan rekomendasi singkat tanpa menulis file.

## Diulangi: JANGAN menulis/me-review hanya dari teks logika tanpa menyebut sumber.