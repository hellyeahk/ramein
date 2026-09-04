# Ramein

## Menambahkan Video

Untuk sementara, tambahkan video dengan paste URL YouTube di tombol **Find a video**. Video akan masuk ke queue dan tersinkron ke semua guest dalam room.

## YouTube

Tidak perlu YouTube API key. Pengguna cukup paste URL YouTube, lalu video masuk ke queue.
Metadata video diambil melalui YouTube oEmbed. Endpoint pencarian YouTube masih tersedia untuk pengembangan berikutnya, tetapi tidak dipakai oleh frontend saat ini.

## Deploy ke Vercel

Import repository ini ke Vercel tanpa environment variable. Vercel otomatis menyajikan file frontend dan endpoint `/api/video` serta `/api/search` sebagai serverless functions.

Fitur paste link dan pemutaran video tidak memerlukan YouTube API key. Chat, queue bersama, playback bersama, reaction, dan presence menggunakan Firebase Realtime Database sehingga tetap bisa berjalan dalam mode Vercel-only. Foto dan voice note menggunakan Firebase Storage.

Aktifkan Realtime Database dan Storage di Firebase Console, lalu isi konfigurasi Firebase di `index.html`. Untuk testing awal, database dan Storage boleh memakai Test mode; sebelum dipublikasikan, ubah rules agar akses tidak terbuka tanpa batas.
