import { get, put } from '@vercel/blob';
import { Readable } from 'node:stream';

export default async function handler(request, response) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return response.status(503).json({ error: 'Media uploads are not configured' });
  }

  const filename = String(request.query.filename || `upload-${Date.now()}`);
  if (!filename || filename.length > 300) return response.status(400).json({ error: 'Invalid filename' });

  if (request.method === 'GET') {
    try {
      const result = await get(filename, { access: 'private' });
      if (!result) return response.status(404).json({ error: 'Media not found' });
      response.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
      response.setHeader('Cache-Control', 'private, max-age=3600');
      Readable.fromWeb(result.stream).pipe(response);
      return;
    } catch (error) {
      console.error('Blob download failed:', error);
      return response.status(404).json({ error: 'Media not found' });
    }
  }

  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) return response.status(400).json({ error: 'Empty file' });

    await put(filename, buffer, {
      access: 'private',
      addRandomSuffix: false,
      contentType: request.headers['content-type'] || 'application/octet-stream',
    });
    return response.status(200).json({ url: `/api/upload?filename=${encodeURIComponent(filename)}` });
  } catch (error) {
    console.error('Blob upload failed:', error);
    return response.status(500).json({ error: 'Upload failed' });
  }
}
