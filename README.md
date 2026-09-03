# Ramein

## Menambahkan Video

Untuk sementara, tambahkan video dengan paste URL YouTube di tombol **Find a video**. Video akan masuk ke queue dan tersinkron ke semua guest dalam room.

## YouTube API (opsional)

1. Open Google Cloud Console and enable **YouTube Data API v3**.
2. Create an API key and restrict it to YouTube Data API v3.
3. Set the key in PowerShell before starting the app:

```powershell
$env:YOUTUBE_API_KEY="your_api_key_here"
python server.py
```

Open `http://localhost:4173`. Endpoint pencarian API tetap tersedia untuk pengembangan berikutnya; key disimpan di server dan tidak pernah dikirim ke browser.

If the key is not configured, the UI falls back to the small demo catalog.

## Deploy ke Render

Gunakan dua Render Web Service dari source yang sama karena setiap service memakai satu port publik.

### Web Service HTTP

Buat Web Service pertama dengan start command `python server.py` dan environment variables:

```text
RAMEIN_SERVICE=http
YOUTUBE_API_KEY=your_api_key_here
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

Import repository/folder ini ke Vercel. Endpoint `/api/video` dan `/api/search` akan otomatis menjadi serverless functions.

Vercel tidak menjalankan WebSocket Python yang persisten. Untuk realtime production, gunakan konfigurasi Render di atas dan set `window.RAMEIN_WS_URL` di `index.html` ke URL `wss://` backend tersebut.
