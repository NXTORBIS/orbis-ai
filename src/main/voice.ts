export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export async function transcribeAudio(audio: Buffer, fetchFn: FetchFn, apiKey: string): Promise<string> {
  const form = new FormData()
  // The renderer's MediaRecorder produces WebM/Opus; the filename extension tells Groq the format.
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/webm' }), 'audio.webm')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('response_format', 'json')

  const res = await fetchFn('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  if (!res.ok) throw new Error(`Transcription failed: ${res.status} ${await res.text().catch(() => '')}`)
  return ((await res.json()) as { text: string }).text.trim()
}
