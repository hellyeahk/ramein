# Ramein

## Menambahkan Video

Untuk sementara, tambahkan video dengan paste URL YouTube di tombol **Find a video**. Video akan masuk ke queue dan tersinkron ke semua guest dalam room.

## YouTube

Tidak perlu YouTube API key. Pengguna cukup paste URL YouTube, lalu video masuk ke queue.
Metadata video diambil melalui YouTube oEmbed. Endpoint pencarian YouTube masih tersedia untuk pengembangan berikutnya, tetapi tidak dipakai oleh frontend saat ini.

## Deploy ke Vercel

Import repository ini ke Vercel tanpa environment variable. Vercel otomatis menyajikan file frontend dan endpoint `/api/video` serta `/api/search` sebagai serverless functions.

Fitur paste link dan pemutaran video tidak memerlukan YouTube API key. Vercel tidak menjalankan WebSocket Python persisten, jadi chat, queue bersama, dan playback bersama belum tersedia dalam mode Vercel-only.
