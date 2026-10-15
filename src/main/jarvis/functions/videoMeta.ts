// @ts-nocheck -- ported unchanged from the Jarvis project's backend function of the same name; only the import line differs.
import { createClientFromRequest } from './local'

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const videoId = String(body?.videoId ?? '').trim();
    if (!VIDEO_ID.test(videoId)) return Response.json({ error: 'A valid video id is required' }, { status: 400 });

    const target = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const res = await fetch(target, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      const message = res.status === 404
        ? 'That video is private, removed, or the id is wrong.'
        : `YouTube replied with ${res.status}.`;
      return Response.json({ error: message }, { status: res.status === 404 ? 404 : 502 });
    }

    const data = await res.json();
    return Response.json({
      videoId,
      title: data.title ?? '',
      author: data.author_name ?? '',
      authorUrl: data.author_url ?? '',
      thumbnail: data.thumbnail_url ?? '',
      width: data.width ?? null,
      height: data.height ?? null,
    });
  } catch (error) {
    return Response.json({ error: error?.message ?? 'Lookup failed' }, { status: 500 });
  }
}