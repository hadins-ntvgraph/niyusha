# Skill: mobile-app-development — rules ringkas

1. **Baca stack dulu** (android-manifest/gradle/`package.json`/`pubspec`); ikuti yang dipakai, jangan ganti framework.
2. **Build/run pakai command resmi proyek** — Gradle: `./gradlew` (Unix) atau `gradlew.bat` (Windows), `assembleDebug`/`assembleRelease`/`bundleRelease`. RN: `npx react-native`. Flutter: `flutter build apk`. Watcher/long-running → background.

## Tool tak ada di PATH — LACAK (jangan nyerah)
- Lokasi: `which gradlew` / `where gradlew` (Windows: `where.exe`); cari `gradlew`/`gradlew.bat` di root proyek (pakai yang ada).
- **Android SDK**: env `ANDROID_HOME` / `ANDROID_SDK_ROOT` (`echo %ANDROID_HOME%` / `$ANDROID_HOME`); cek `local.properties` → `sdk.dir=...`; lokasi umum Windows `%LOCALAPPDATA%\Android\Sdk`, Linux `~/Android/Sdk`, macOS `~/Library/Android/sdk`.
- **JDK**: `JAVA_HOME` (`java -version`). Gradle butuh JDK kompatibel; set `JAVA_HOME` bila build gagal.
- **adb/platform-tools**: di `<SDK>/platform-tools/adb(.exe)` — pakai path absolut bila tak ada di PATH.
- Kalau `gradlew` tak ada: `gradle wrapper` atau pakai `gradle` global. Sertakan `--no-daemon` bila daemon bikin nyangkut.

## adb ke device/emulator
- Cek device: `adb devices` (harus ada serial + `device`, bukan `unauthorized`).
- Install APK: `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
- Log: `adb logcat`; shell: `adb shell`; restart server: `adb kill-server` lalu `adb start-server`.
- Emulator: `emulator -list-avds` → `emulator -avd <nama>`. HP nyata: aktifkan **USB debugging**. `unauthorized` → terima prompt di HP; masih gagal → cabut/pasang ulang + `adb kill-server`.
- Mac/Linux: cukup `adb`. Windows: `adb.exe`. Nyalakan port bila perlu: `adb tcpip 5555` + `adb connect <ip>:5555`.

3. **Native quirk**: izin di manifest; resource/naming sesuai konversi; jangan hardcode string UI (pakai `strings.xml`).
4. **Verifikasi**: build sukses (`exit 0` + artefak ada di `app/build/outputs/`), lalu `adb install`/luncurkan bila ada device. Kalau tak ada device → lapor status build.
5. Jangan tambah dependency berat tanpa perlu; cek `minSdk`/`compileSdk` kompatibel.
6. Lifecycle: hindari memory leak (listener/timer di-unmount), batasi re-render.
