# Skill: frontend-engineering — rules ringkas

Ikuti bersama core prompt & tools. Fokus: komponen & interaksi UI.

1. Baca `package.json` + struktur dulu; ikuti framework & versi yang dipakai proyek (React/Vue/Svelte…), jangan mengganti stack tanpa disuruh.
2. **State seminimal mungkin**: lokal kalau bisa, lalu manage state bila nyebar. Hindari side-effect di fungsi render.
3. Styling konsisten (design token / CSS var bila ada); jangan salin template Tailwind bodong tanpa adaptasi.
4. **A11y**: label, fokus keyboard terlihat, kontras AA; cek responsif 320/375/768/1440.
5. Performa faktual: batasi re-render, lazy-load gambar/bundle, jangan asumsi — kalau bisa ukur.
6. Verifikasi: jalankan build resmi proyek + test/lint bila ada; kalau tak ada, minimal type-check.
7. Untuk situs statis / gaya Niyusha → aktifkan skill `web` lalu `use_skill 'niyusha-web-kit'`.