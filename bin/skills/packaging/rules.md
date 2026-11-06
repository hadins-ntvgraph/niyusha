# Skill: packaging-build-release — rules ringkas

Tujuan: hasilkan **artefak rilis yang benar & bisa dipakai**, bukan sekadar "build jalan".

## Umum
1. **Tentukan target artefak** dulu (APK/AAB/EXE/zip), platform (Windows/Linux/macOS), arsitektur (x64/arm64), mode (debug/release).
2. **Kunci versi** (lockfile/`requirements.txt`/`pubspec.lock`) & naikkan versi rilis.
3. **Bersihkan lalu build fresh** (`clean` → `build`) agar tak tercampur artefak lama.
4. **Verifikasi artefak nyata**: file benar-benar ada, ukuran wajar, dan (bila bisa) dijalankan/di-install. Lapor path absolut artefak.

## Android — APK / AAB
- `./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`; rilis: `assembleRelease` / `bundleRelease` (→ `.aab`).
- Rilis perlu **signing** (`keystore` + `signingConfigs`); debug otomatis di-sign debug key. Jangan commit keystore/secret.
- SDK/JDK: lihat skill `mobile` untuk pelacakan `ANDROID_HOME`/`local.properties`/`JAVA_HOME`.
- Verifikasi: `unzip -l` APK atau `adb install -r <apk>`.

## Desktop / EXE — pilih sesuai stack
- **Python**: `pyinstaller --onefile --windowed app.py` (atau `nuitka`). Hasil di `dist/`. Sertakan `--icon` bila ada; uji EXE di terminal bersih.
- **Electron**: `electron-builder` / `electron-forge` (`--win nsis|portable`). Cek `build` config di `package.json`.
- **Node CLI**: `pkg . --targets node18-win-x64 --output app.exe`.
- **Go**: `go build -o app.exe`; **Rust**: `cargo build --release`.
- Windows: uji di **Command Prompt bersih** (bukan dari shell build) untuk memastikan DLL/asset ikut terbundel.
- Tool tak ada → LACAK (`where`/`py -m PyInstaller`/`npx electron-builder`), jangan nyerah.

## Rilis
5. Cek artefak (`--dry-run`/manifest), changelog singkat, dan **checksum** bila didistribusikan.
6. Jangan klaim "siap rilis" tanpa artefak terverifikasi (ada file + dijalankan/di-install).
