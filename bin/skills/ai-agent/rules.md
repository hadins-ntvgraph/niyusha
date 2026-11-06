# Skill: ai-agent-engineering — rules ringkas

1. **Tentukan kontrak**: input/output, daftar tool, dan **batas langkah** — jangan biarkan loop tanpa henti.
2. **Prompt & konteks**: instruksi jelas & spesifik, contoh bila perlu, batasi ukuran konteks; JANGAN masukkan secret ke prompt/log.
3. **Tool/function calling**: skema ketat, validasi argumen, tangani error tool dengan anggun (jangan crash loop).
4. **RAG**: chunking wajar, embedding, reranking, **sebut sumber** — jangan halusinasi saat data tak ada.
5. **Evaluasi**: ukur dengan dataset/skenario nyata (akurasi langkah, biaya, latensi) — bukan perasaan.
6. Verifikasi: jalankan skenario normal/edge/gagal & laporkan metrik.