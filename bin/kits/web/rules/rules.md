# Niyusha Web Kit — Rules v2 (Modern)

Lisensi: **MIT** (original NTVGraph × Niyusha), bebas termasuk komersial.

## WAJIB — inti
1. **Tuntaskan, jangan gantung di reasoning.** Bikin/ubah situs → selesaikan dengan file nyata (`write_file`, staged). Ragu pun tulis draft terbaik. Tanya/diskusi/rencana → jawab ringkas, tak wajib file.
2. **Struktur LENGKAP**: `header/nav` → `hero` (headline + subhead + 2 CTA + visual) → `fitur` (3–6, ber-ikon) → `stats` → `cara kerja`/bukti sosial → `CTA` → `footer` multi-kolom. Jangan cuma hero.
3. **Copy produk NYATA & spesifik domain** (value/manfaat nyata). DILARANG menyisakan label meta/dev: `// LANDING_v1`, `no bloat`, `v1`, nama file, `Placeholder ...`, atau nama brand contoh (`Nama`/`NamaBrand`) di hasil final.
4. **Modern & rapi**: tipografi fluid (`clamp`), whitespace lega, sudut membulat, bayangan berlapis halus, kontras jelas. Hindari tampilan "tahun 2010": jangan font serif default, jangan border kotak tajam semua, jangan layout table/kolom sempit.
5. **Responsif mobile-first** (uji 375px & 1440px) + **dark & light** via `@media (prefers-color-scheme)`.
6. **A11y AA**: kontras teks cukup, `alt`/`aria-label`, fokus keyboard terlihat, landmark `header/main/nav/footer`, heading berurut.

## Ikon & visual — INI SERING JADI JELEK, BACA TELITI
- **JANGAN mengarang path SVG.** Model tahu ikon standar — pakai **ikon garis 24×24** bergaya set populer (Feather/Lucide/Heroicons), dengan `stroke="currentColor" stroke-width="2" fill="none"`. Kalau tidak yakin path-nya BENAR, **salin** dari daftar contoh di bawah.
- **Path WAJIB dikenali.** Kalau hasilnya cuma kotak/lingkaran acak → SALAH, ganti dengan yang dari daftar. Contoh yang sering benar (pakai apa adanya, ganti angka bila perlu):
  - check: `<path d="M20 6 9 17l-5-5"/>`
  - arrow-right: `<path d="M5 12h14M13 6l6 6-6 6"/>`
  - arrow-down: `<path d="M12 5v14M6 13l6 6 6-6"/>`
  - search: `<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>`
  - user: `<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>`
  - bolt/zap: `<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>`
  - shield: `<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3Z"/>`
  - shield-check: `<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3Z"/><path d="M9 12l2 2 4-4"/>`
  - chart: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`
  - star: `<path d="m12 3 2.6 6.3 6.4.5-4.9 4.2 1.5 6.3L12 17l-5.6 3.3 1.5-6.3L3 9.8l6.4-.5L12 3Z"/>`
  - lock: `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`
  - mail: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>`
  - settings (sliders): `<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/>`
  - globe: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>`
- Setiap `<svg>` ikon: `aria-hidden="true"` (dekoratif) atau `role="img"` + `<title>` (bermakna). Jangan taruh kata lepas di dalam `<svg>`.
- **Wajib visual** min. 1 elemen kuat: bento/kartu, mockup (mis. jendela/dashboard), atau ilustrasi geometris. **Hindari halaman teks-datar.** Boleh CSS-only (rapi) — tak perlu foto.

## Gaya modern (acuan, bukan wajib identik)
- Headline besar, tracking ketat (`letter-spacing:-.03em`), satu aksen gradien pada kata kunci.
- Label kecil **mono UPPERCASE** sebagai eyebrow; chip pill; dot status hijau.
- Latar bernuansa: aurora/mesh samar + grain halus (jangan berlebihan).
- Kartu **glass** lembut, hover lift `translateY(-2..3px)`, transisi `cubic-bezier(.22,1,.36,1)`.
- Aksen mono `//` **maks 1–2× per halaman**.
- **Bervariasi sesuai genre**: kafe/sekolah/korporat ≠ SaaS. Boleh ubah suasana (hangat, formal, playful) selama tetap rapi & modern.

## Token (dari tokens.json)
- Warna/spacing/radius/shadow SELALU via CSS var — **jangan hardcode** warna sembarangan.
- Spacing `2xs/xs/sm/md/lg/xl/2xl/3xl` · Radius `sm/md/lg/xl/pill` · Shadow `soft`/`lift`/`glow`.
- Tipografi pakai `clamp()`. Kontainer `~1140px`. Gradient signature hanya untuk latar/CTA band.

## Konsistensi (WAJIB dicek sebelum selesai)
- **Antar halaman** (bila multi-file): nav, footer, warna brand, dan style **sama** di semua halaman. Jangan satu halaman ungu, lain biru.
- **Tidak ada sisa placeholder** (`Nama`, `NamaBrand`, `NamaPerusahaan`, lorem) di hasil final — ganti sesuai proyek.
- **Tidak ada komentar dev** (`<!-- Placeholder ... -->`, `// TODO`) tertinggal.
- Setelah menulis: **grep ulang** nilai/label lama → pastikan tak ada sisa; periksa ikon terlihat benar (bukan kotak/lingkaran acak).

## Template = CONTOH, bukan isi
`templates/` & `components/` memakai placeholder netral. Tunjukkan **struktur & gaya**; **WAJIB ganti** nama/brand/copy/angka sesuai proyek client. Kit universal — untuk situs apa saja.

## Juice (secukupnya)
grain SVG turbulence (opacity ~.3, mix-blend overlay); reveal-stagger IntersectionObserver (delay ~60ms); hover lift; aurora drift ~20s. Hormati `prefers-reduced-motion`.

## Alur AI
1. `use_skill 'niyusha-web-kit'` → tokens + aturan + komponen + template.
2. **Compose halaman BARU** (jangan salin template bulat) — sesuaikan genre.
3. Tulis via `write_file` (staged). Credit footer **hanya bila** `cfg().credit` (`/credit`).

## Folder kit
`tokens.json` · `kit.json` · `templates/` (landing-saas) · `components/` (nav · hero · features · stats · cta · footer · card · button · background) · `rules/rules.md` · `assets/grain.svg`
