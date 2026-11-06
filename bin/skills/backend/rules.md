# Skill: backend-engineering — rules ringkas

1. **Desain dulu**: method, path, request/response shape, dan kode error sebelum menulis kode.
2. **Jangan percaya input** (body/query/header): validasi tipe, batas, dan skema. Jangan pakai data user langsung di query/HTML/shell.
3. **Error handling**: status code tepat; jangan bocorkan stack trace/secret ke client; log terstruktur di server.
4. **Auth/otorisasi per permintaan**, bukan cuma di login: cek identity & hak akses; least privilege.
5. Keamanan dasar: rate-limit pada endpoint publik, CORS dibatasi, secret hanya dari env (tidak pernah di log/kode).
6. **Test**: unit di layer service + minimal 1 integration per endpoint penting.
7. Verifikasi: jalanin dev server lokal (background), `curl -I` + satu flow utama sukses & satu error case.