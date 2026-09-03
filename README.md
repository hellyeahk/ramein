# Ramein

## Menambahkan Video

Untuk sementara, tambahkan video dengan paste URL YouTube di tombol **Find a video**. Video akan masuk ke queue dan tersinkron ke semua guest dalam room.

## YouTube

Tidak perlu YouTube API key. Pengguna cukup paste URL YouTube, lalu video masuk ke queue.
Metadata video diambil melalui YouTube oEmbed. Endpoint pencarian YouTube masih tersedia untuk pengembangan berikutnya, tetapi tidak dipakai oleh frontend saat ini.

Untuk menjalankan lokal:

```powershell
python server.py
```

## Deploy ke Render

Gunakan dua Render Web Service dari source yang sama karena setiap service memakai satu port publik.

### Web Service HTTP

Buat Web Service pertama dengan start command `python server.py` dan environment variables:

```text
RAMEIN_SERVICE=http
```

Render menyediakan `PORT` secara otomatis. Domain service ini dipakai untuk membuka web dan endpoint API.

### Web Service WebSocket

Buat service kedua dari repository yang sama, set start command ke `python server.py`, lalu environment variable:

```text
RAMEIN_SERVICE=ws
```

Ambil URL HTTPS service WebSocket, lalu ubah menjadi `wss://`. Setelah itu, di `index.html` tambahkan konfigurasi sebelum `app.js`:

```html
<script>window.RAMEIN_WS_URL = 'wss://domain-websocket-anda.onrender.com';</script>
<script src="app.js"></script>
```

Pastikan kedua service aktif sebelum membagikan URL web. Render Free akan sleep setelah tidak digunakan, sehingga koneksi WebSocket dapat terputus dan room di memori akan hilang. Untuk room realtime yang stabil, gunakan instance berbayar atau pindahkan state room ke Redis/database.

## Deploy ke Vercel

Import repository/folder ini ke Vercel. Endpoint `/api/video` dan `/api/search` akan otomatis menjadi serverless functions; fitur paste link tidak memerlukan API key.

Vercel tidak menjalankan WebSocket Python yang persisten. Untuk realtime production, gunakan konfigurasi Render di atas dan set `window.RAMEIN_WS_URL` di `index.html` ke URL `wss://` backend tersebut.
