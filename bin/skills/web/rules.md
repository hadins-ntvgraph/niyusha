# Skill: web-development — rules ringkas (berlaku saat tugas = situs web)

Ikuti bersama core prompt & tools yang ada; jangan duplikasi aturan umum.

1. **Struktur LENGKAP** (bukan cuma hero): header/nav → hero (headline + subhead + 2 CTA + visual) → fitur 3–6 ber-ikon → bukti/stats → CTA band → footer multi-kolom.
2. **Copy produk NYATA** (nilai/manfaat). DILARANG label meta/dev: `// LANDING_v1`, `no bloat`, nama file.
3. **Wajib visual** ≥1: mockup terminal/kartu, ilustrasi, atau mesh-gradient + grain. Hindari halaman teks-datar. **Ikon/ilustrasi harus BENTUK JELAS** — pakai bentuk geometris sederhana dengan path SVG valid; DILARANG mengarang path bebas yang hasilnya abstrak/tak jelas. Uji cepat: kalau tak bisa menyebut "ini gambar apa" dalam 1 kata, perbaiki. Sertakan `role="img"` + `<title>`.
4. **Zero-dep total**: tanpa CDN eksternal apa pun (Tailwind/ikon/font). Font = **hanya system stack** (Inter/Geist/system-ui); DILARANG `<link>` Google Fonts, `@import url(http…)`, atau font CDN. CSS sendiri.
5. **Design-token via CSS var** (warna, radius, spacing, easing) — jangan hardcode sembarang; konsisten antar halaman & antar tema.
6. **Responsif mobile-first** (cek 375px & 1440px) + **dark & light** via `prefers-color-scheme`.
7. **A11y AA**: kontras teks, alt/aria-label, fokus keyboard terlihat, landmark `header/main/footer`.
8. **Verifikasi sebelum klaim selesai**: tag seimbang & CSS valid; kalau bisa jalankan server → curl -I dan cek render.
9. **Gaya khas Niyusha?** → panggil `use_skill 'niyusha-web-kit'` buat tokens/aturan kualitas; kompos ulang, JANGAN salin template bulat.

## Contoh visual BENAR (TIRU pola ini, jangan karang path bebas)

Ikon/ilustrasi = bentuk geometris yang bisa dikenali. Contoh cangkir kopi (valid, dipakai nyata):

```html
<svg width="200" height="200" viewBox="0 0 220 220" role="img" aria-labelledby="cupTitle">
  <title id="cupTitle">Ilustrasi cangkir kopi panas</title>
  <g fill="none" stroke="var(--ink_muted)" stroke-width="4" stroke-linecap="round" opacity="0.7">
    <path d="M86 54c-7-9 7-15 0-26"/><path d="M110 48c-7-9 7-15 0-26"/><path d="M134 54c-7-9 7-15 0-26"/>
  </g>
  <ellipse cx="110" cy="162" rx="74" ry="12" fill="var(--surface_2)" stroke="var(--ink)" stroke-width="3"/>
  <path d="M149 102c34 0 34 40 0 40" fill="none" stroke="var(--ink)" stroke-width="9" stroke-linecap="round"/>
  <path d="M60 78h100l-14 70a16 16 0 0 1-16 14H90a16 16 0 0 1-16-14z" fill="var(--surface)" stroke="var(--ink)" stroke-width="4" stroke-linejoin="round"/>
  <ellipse cx="110" cy="78" rx="50" ry="9" fill="var(--accent_3)"/>
</svg>
```

Prinsip: mulai dari titik pasti (`M x y`), bangun dengan `H/V/L` + busur `a r r 0 0 1 …`; setiap angka punya arti. Kalau ragu, pakai bentuk dasar (kotak/lingkaran/busur) yang bisa kamu jelaskan, bukan deret path acak. Komentar di dalam `<svg>` WAJIB `<!-- ... -->` — JANGAN menaruh kata lepas (mis. `stem`) sebagai text-node di dalam SVG.