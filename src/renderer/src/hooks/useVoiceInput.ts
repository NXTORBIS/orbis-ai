import { useCallback, useRef, useState } from 'react'

export function useVoiceInput() {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        chunksRef.current.push(e.data)
      }

      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setIsRecording(true)
    } catch (err) {
      console.error('Microphone access denied:', err)
    }
  }, [])

  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (!mediaRecorderRef.current) return null

    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        mediaRecorder.stream.getTracks().forEach((track) => track.stop())
        setIsRecording(false)

        setIsTranscribing(true)
        try {
          const arrayBuffer = await blob.arrayBuffer()
          const text = await window.api.transcribeAudio(new Uint8Array(arrayBuffer))
          resolve(text)
        } catch (err) {
          console.error('Transcription failed:', err)
          resolve(null)
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorder.stop()
    })
  }, [])

  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording
  }
}
