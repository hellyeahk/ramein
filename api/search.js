export default async function handler(request, response) {
  const query = String(request.query.q || '').trim();
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!query) return response.status(400).json({ error: 'Search query is required' });
  if (!apiKey) return response.status(503).json({ error: 'YouTube search is not configured' });

  try {
    const params = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '8', q: query, key: apiKey });
    const result = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!result.ok) return response.status(502).json({ error: 'YouTube search unavailable' });
    const payload = await result.json();
    return response.status(200).json({ items: (payload.items || []).map((item) => ({ id: item.id.videoId, title: item.snippet.title, channel: item.snippet.channelTitle })) });
  } catch {
    return response.status(502).json({ error: 'YouTube search unavailable' });
  }
}
