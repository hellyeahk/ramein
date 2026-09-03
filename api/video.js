export default async function handler(request, response) {
  const videoId = String(request.query.id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return response.status(400).json({ error: 'Valid YouTube video id is required' });
  }

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const result = await fetch(oembedUrl);
    if (!result.ok) return response.status(502).json({ error: 'YouTube metadata unavailable' });
    const metadata = await result.json();
    return response.status(200).json({ id: videoId, title: metadata.title, channel: metadata.author_name });
  } catch {
    return response.status(502).json({ error: 'YouTube metadata unavailable' });
  }
}
