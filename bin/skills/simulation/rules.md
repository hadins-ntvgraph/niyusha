# Skill: simulation-harness

1. **Simulasi perilaku, bukan asumsi**: target bisa aplikasi web/SaaS, alur browser, software, game, atau app Android. Tetapkan skenario + ekspektasi, beri input nyata, observasi, ukur, simpulkan.
2. **Pakai harness bawaan** `node bin/sim.js` (zero-dep). Jangan tambah Playwright/Puppeteer.

## Skenario & web/UI
- Tetapkan tujuan, langkah, kondisi sukses; uji alur utama + satu edge case.
- Serve: `node bin/sim.js serve <dir> --port 8765` (background) atau `web --serve <dir>`.
- Drive: `sim web <url> --viewport 430x880 --wait 800 --click "<sel>" --tap x,y --key Space --eval "<js>" --metrics "<sel1,sel2>" --shot out.png`
- Cek: `readyState`, console error, DOM/state, rect/style, screenshot sebelum vs sesudah aksi.
- Assert: `--assert "Boolean(document.querySelector('#app'))"` atau cek `bottom===innerHeight`, radius `"0px"`, canvas bitmap===rect.
- Untuk menyimpan bukti saat action/assertion gagal, tambahkan `--shot-on-failure tmp/failure.png`. Output error memuat path screenshot, URL, viewport, langkah, metrics, console, dan error yang tertangkap.
- Tambahkan `--evidence tmp/visual-context.json` untuk menyimpan report mesin-baca berisi elemen semantic DOM, accessible label, teks, bounding box relatif, status terlihat/on-screen, overflow, gambar gagal dimuat, console, dan aksi. Saat gagal, report juga mengambil screenshot ke file `.failure.png` terkait.
- Gunakan `read_visual_evidence` pada report JSON. Representasi DOM/geometri memberi semua model jalur QA berbasis teks yang sama tanpa mewajibkan input gambar provider; ini bukan deteksi pixel/vector dan bukan jaminan semua bug visual terdeteksi.
- `inspect_image` opsional untuk provider multimodal. Jangan menjadikannya jalur wajib atau mengklaim model sudah melihat screenshot kecuali request gambar benar-benar diterima.
- Uji 2 viewport (portrait + kecil/landscape).

## Game / canvas
- Klik/tap mulai, tunggu beberapa frame, baru ukur. Cek `canvas.width/height` vs CSS rect (bitmap salah = blur/stretch).
- Screenshot sebelum/sesudah; cek tombol keluar/restart mengubah state.

## Android / ADB
- Cari adb tanpa asumsi PATH: `sim adb path` (cek `ANDROID_HOME`, `local.properties`, `%LOCALAPPDATA%\Android\Sdk`).
- Alur: `adb devices` → `install -r <apk>` → `launch <package>` → `shot out.png` → `log [lines]`.
- `offline/unauthorized` → `adb reconnect offline`, terima prompt USB; `INJECT_EVENTS` ditolak → jangan fake; pakai monkey/AM atau minta user menyentuh layar.
- Build resmi dulu (`gradlew assembleDebug`), install setelah artefak ada.

## Evidence & cleanup
- Laporkan: target, viewport, command, hasil, path evidence/screenshot, error console/log, dan bedakan fakta DOM terukur dari dugaan visual.
- Cleanup: tutup Chrome/server, `kill_process` background, hapus artefak sementara.
- Jangan ubah proyek demi tes kecuali bagian perbaikan.
