import { put } from '@vercel/blob';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  const filename = String(request.query.filename || `upload-${Date.now()}`);
  if (!filename || filename.length > 300) return response.status(400).json({ error: 'Invalid filename' });

  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) return response.status(400).json({ error: 'Empty file' });

    const blob = await put(filename, buffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType: request.headers['content-type'] || 'application/octet-stream',
    });
    return response.status(200).json({ url: blob.url });
  } catch (error) {
    return response.status(500).json({ error: 'Upload failed' });
  }
}
