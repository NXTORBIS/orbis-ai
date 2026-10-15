// Modular source-adapter layer for the Video Downloader.
//
// Design principle: this tool only downloads content the user is legally and
// technically permitted to download. It never bypasses DRM, paywalls,
// authentication, or platform download restrictions. When a source does not
// provide an authorized download method, we say so clearly rather than
// pretending the URL is downloadable.

// Hosts that are known to restrict downloads (DRM, ToS, auth, or no public
// direct-media endpoint). We do NOT attempt to circumvent any of these.
const RESTRICTED_HOSTS = [
  { match: /youtube\.com|youtu\.be/i, name: 'YouTube' },
  { match: /vimeo\.com/i, name: 'Vimeo' },
  { match: /tiktok\.com/i, name: 'TikTok' },
  { match: /instagram\.com/i, name: 'Instagram' },
  { match: /facebook\.com|fb\.watch/i, name: 'Facebook' },
  { match: /twitter\.com|x\.com/i, name: 'X (Twitter)' },
  { match: /netflix\.com/i, name: 'Netflix' },
  { match: /twitch\.tv/i, name: 'Twitch' },
  { match: /dailymotion\.com/i, name: 'Dailymotion' },
  { match: /disneyplus\.com|hbomax\.com|hulu\.com|primevideo\.com|peacocktv\.com/i, name: 'this streaming service' },
  { match: /soundcloud\.com/i, name: 'SoundCloud' },
  { match: /spotify\.com/i, name: 'Spotify' },
];

// Direct video file extensions we can fetch as a single blob.
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'ogg', 'm4v', 'mov', 'mkv', 'avi', 'm4a'];

const VIDEO_MIME = /^video\/(mp4|webm|ogg|quicktime|x-matroska|x-msvideo|mp2t)$/i;
const AUDIO_MIME = /^audio\/(mp4|webm|ogg|mpeg|x-wav|x-m4a|aac)$/i;

export function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getExtension(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const m = path.match(/\.([a-z0-9]{2,5})(?:$|\?)/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

// Classify a URL without making a network request.
// Returns { kind: 'direct' | 'restricted' | 'unknown', host, name?, reason? }
export function classifyUrl(rawUrl) {
  if (!isValidUrl(rawUrl)) return { kind: 'invalid', reason: 'Enter a valid http or https URL.' };
  let host = '';
  try { host = new URL(rawUrl).hostname; } catch { /* noop */ }

  const restricted = RESTRICTED_HOSTS.find((r) => r.match.test(rawUrl));
  if (restricted) {
    return {
      kind: 'restricted',
      host,
      name: restricted.name,
      reason: `${restricted.name} does not provide an available download method for this content. Downloading from ${restricted.name} requires its official export/download feature (if any) or explicit authorization from the rights holder.`,
    };
  }

  const ext = getExtension(rawUrl);
  if (VIDEO_EXTENSIONS.includes(ext)) {
    return { kind: 'direct', host, ext };
  }

  // HLS / DASH manifests are not single-file downloadable in-browser.
  if (ext === 'm3u8' || ext === 'mpd') {
    return {
      kind: 'restricted',
      host,
      name: 'streaming manifest',
      reason: 'This is a streaming playlist (HLS/DASH). It is not a single downloadable file and may be protected. Use the source\'s official download option if available.',
    };
  }

  return { kind: 'unknown', host };
}

// Probe a URL to learn its content type and size without downloading the body.
// Tries HEAD first; falls back to a tiny ranged GET. Returns null on failure.
export async function probeUrl(url, signal) {
  async function tryHead() {
    const res = await fetch(url, { method: 'HEAD', signal, redirect: 'follow' });
    if (!res.ok) return null;
    return {
      contentType: res.headers.get('content-type') || '',
      size: Number(res.headers.get('content-length')) || 0,
      supportsRange: (res.headers.get('accept-ranges') || '') !== 'none',
    };
  }
  async function tryRange() {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal, redirect: 'follow' });
    if (!res.ok && res.status !== 206 && res.status !== 200) return null;
    const contentType = res.headers.get('content-type') || '';
    let size = 0;
    const cr = res.headers.get('content-range');
    if (cr) {
      const m = cr.match(/\/(\d+)/);
      if (m) size = Number(m[1]);
    }
    if (!size) size = Number(res.headers.get('content-length')) || 0;
    return { contentType, size, supportsRange: true };
  }
  try {
    const head = await tryHead();
    if (head) return head;
  } catch { /* HEAD may be blocked by CORS — try ranged GET */ }
  try { return await tryRange(); } catch { return null; }
}

// Decide whether a probed content type is a downloadable media file.
export function isDownloadableMedia(contentType, ext) {
  if (contentType && (VIDEO_MIME.test(contentType) || AUDIO_MIME.test(contentType))) return true;
  if (ext && VIDEO_EXTENSIONS.includes(ext)) return true;
  return false;
}

// Load a <video> element to read duration and resolution without CORS issues.
// Thumbnail capture requires CORS; we degrade gracefully.
export function loadVideoMetadata(url, signal) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.crossOrigin = 'anonymous';
    let done = false;
    const finish = (data) => {
      if (done) return; done = true;
      v.removeAttribute('src'); v.load();
      resolve(data);
    };
    signal?.addEventListener('abort', () => finish(null));
    v.onloadedmetadata = () => {
      const data = {
        duration: v.duration && isFinite(v.duration) ? v.duration : 0,
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
      };
      // Try to capture a thumbnail at ~25%.
      try {
        v.currentTime = Math.min(data.duration / 4 || 0.1, 0.1);
      } catch { finish(data); }
      v.onseeked = () => {
        let thumb = null;
        try {
          const c = document.createElement('canvas');
          c.width = v.videoWidth || 320; c.height = v.videoHeight || 180;
          const ctx = c.getContext('2d');
          ctx.drawImage(v, 0, 0, c.width, c.height);
          thumb = c.toDataURL('image/jpeg', 0.7);
        } catch { /* CORS-tainted canvas — skip thumbnail */ }
        finish({ ...data, thumbnail: thumb });
      };
    };
    v.onerror = () => finish(null);
    v.src = url;
    setTimeout(() => finish(null), 12000);
  });
}

export function fmtDuration(s) {
  if (!s || !isFinite(s)) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function qualityLabel(width, height) {
  const h = height || 0;
  if (h >= 2160) return '2160p (4K)';
  if (h >= 1440) return '1440p (2K)';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  if (h >= 360) return '360p';
  if (h > 0) return `${h}p`;
  return '—';
}

export function containerLabel(ext, contentType) {
  if (ext === 'mp4' || /mp4/i.test(contentType || '')) return 'MP4';
  if (ext === 'webm' || /webm/i.test(contentType || '')) return 'WebM';
  if (ext === 'mov' || /quicktime/i.test(contentType || '')) return 'MOV';
  if (ext === 'mkv' || /matroska/i.test(contentType || '')) return 'MKV';
  if (ext === 'ogv' || ext === 'ogg' || /ogg/i.test(contentType || '')) return 'OGG';
  if (ext === 'm4a' || ext === 'm4v') return 'M4A';
  if (ext === 'avi') return 'AVI';
  if (contentType && /^audio\//i.test(contentType)) return 'Audio';
  return ext ? ext.toUpperCase() : '—';
}