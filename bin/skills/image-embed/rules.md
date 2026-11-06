# Skill: image-embed — rules ringkas

1. Gunakan `image_embed` untuk membuat node sidik jari byte deterministik; ini bukan embedding semantik atau pemahaman visual.
2. Node disimpan lokal di `~/.niyusha/image-vectors/`; tool hanya mengembalikan ID dan metadata ringkas agar context tidak penuh angka.
3. Jika numeric vector benar-benar diperlukan, ambil per bagian melalui `image_vector_read` (maksimum 256 nilai per panggilan).
4. Vektor mencocokkan byte gambar yang sama, bukan makna atau kemiripan visual.
5. Bila butuh teks dari gambar, muat skill `image-ocr`.
