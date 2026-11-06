# Skill: devops-engineering — rules ringkas

1. **Konfigurasi via env/secret**, bukan hardcode. Pisahkan dev/staging/prod; jangan commit secret.
2. **Reproducible**: kunci versi (lockfile), sediakan skrip setup yang terdokumentasi.
3. **Proses & server**: jalankan app sebagai service (systemd/pm2), reverse proxy (nginx) + health check.
4. **Observability**: log terstruktur, metrik dasar (latensi/error rate), alert pada kegagalan.
5. **Aman**: least privilege, jangan expose port internal, secret dari secret manager/env.
6. Verifikasi: jalankan setup di lingkungan bersih & cek health endpoint (curl), bukan asumsi.