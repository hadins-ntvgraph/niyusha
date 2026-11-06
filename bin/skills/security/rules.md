# Skill: security-review — rules ringkas

1. **Input selalu validate/sanitize**; **output escape sesuai konteks** (HTML/SQL/shell/JSON).
2. Jangan simpan/commit secret; pakai env `/.env` yang masuk `.gitignore`; jangan log key/token.
3. **Auth & otorisasi per permintaan**: verifikasi identitas dan hak akses, bukan hanya filenya ada login.
4. Dependensi: cek vuln yang dikenal bila tool tersedia (`npm audit`, `pip-audit`).
5. Rate-limit & access control pada resource sensitif; batasi ukuran upload/body bila relevan.
6. Coret hanya risiko nyata di kode (baca jalurnya dulu) — jangan skenario hipotetis belaka.