# Skill: image-ocr — rules ringkas

1. Untuk teks dari gambar/upload: pakai tool `image_ocr` (Tesseract). Tool otomatis memakai `ind+eng` bila keduanya tersedia, atau model `ind`/`eng` yang terpasang sebagai fallback; hasil menyebut bahasa yang digunakan.
2. Untuk gambar dari halaman berita + OCR massal: pakai script `python ntv_img_ocr.py <url> --format md` (atau `--image`).
3. Prioritas: `image_ocr` dulu; script hanya bila butuh koleksi gambar dari berita.
4. Output OCR = teks; jangan anggap OCR sempurna, tandai ketidakpastian.
5. Jika tool melaporkan `DEPENDENCY_MISSING`, jelaskan bahwa belum ada instalasi yang dilakukan, tampilkan perintah instalasi yang disarankan, minta izin user sebelum menjalankan `run_command`, verifikasi instalasi, lalu ulangi OCR.
