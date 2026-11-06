# Skill: embedded-systems — rules ringkas

1. Tentukan **target board & batasan** dulu (RAM/Flash, pin, tegangan, daya).
2. **Loop non-blocking**: hindari `delay()` panjang; pakai timer/interrupt/state machine.
3. Baca **datasheet/pinout** — jangan asumsi level tegangan (3.3V vs 5V) atau alamat I2C.
4. Hemat memori: utamakan alokasi statis; waspada stack kecil & watchdog.
5. **Uji per modul** (sensor/aktuator) sebelum integrasi; kirim serial log untuk debugging.
6. Verifikasi: build/flash sukses + perilaku teramati (serial/LED/output), bukan asumsi.