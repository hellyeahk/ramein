# Ramein

## Menambahkan Video

Untuk sementara, tambahkan video dengan paste URL YouTube di tombol **Find a video**. Video akan masuk ke queue dan tersinkron ke semua guest dalam room.

## YouTube

Tidak perlu YouTube API key. Pengguna cukup paste URL YouTube, lalu video masuk ke queue.
Metadata video diambil melalui YouTube oEmbed. Endpoint pencarian YouTube masih tersedia untuk pengembangan berikutnya, tetapi tidak dipakai oleh frontend saat ini.

## Deploy ke Vercel

Import repository ini ke Vercel tanpa environment variable. Vercel otomatis menyajikan file frontend dan endpoint `/api/video` serta `/api/search` sebagai serverless functions.

Fitur paste link dan pemutaran video tidak memerlukan YouTube API key. Chat, queue bersama, playback bersama, reaction, dan presence menggunakan Firebase Realtime Database sehingga tetap bisa berjalan dalam mode Vercel-only. Foto dan voice note menggunakan Vercel Blob lewat endpoint `/api/upload`.

## Setup Vercel Blob

1. Di dashboard Vercel, buka project ini → tab **Storage** → **Create Database** → pilih **Blob**.
2. Hubungkan (Connect) Blob store itu ke project ini. Vercel otomatis menambahkan environment variable `BLOB_READ_WRITE_TOKEN`, tidak perlu diisi manual dan tidak butuh kartu kredit di plan Hobby.
3. Redeploy project. Fitur foto & voice note langsung aktif.

Batas plan Hobby: 1GB penyimpanan dan ukuran body request per function sekitar 4.5MB, jadi foto berukuran sangat besar bisa gagal diupload — cukup untuk pemakaian personal biasa.
