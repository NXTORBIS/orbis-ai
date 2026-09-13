import { Fragment, useState } from 'react'
import { Wand2, Loader, Download } from 'lucide-react'
import GameOverlay from './GameOverlay'

interface Props {
  disabled?: boolean
  onGenerate(prompt: string): Promise<string>
}

export default function ImageGenerationUI({ disabled, onGenerate }: Props) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    try {
      const imageData = await onGenerate(prompt)
      setGeneratedImage(imageData)
    } catch (err) {
      alert(`Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!generatedImage) return
    const link = document.createElement('a')
    link.href = generatedImage.startsWith('data:') ? generatedImage : `data:image/png;base64,${generatedImage}`
    link.download = `generated-${Date.now()}.png`
    link.click()
  }

  return (
    <Fragment>
      <GameOverlay visible={loading} />
      <div className="generation-panel">
        <div className="generation-input">
          <textarea
            placeholder="Describe the image you want to generate..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={disabled || loading}
            rows={2}
          />
          <button
            onClick={handleGenerate}
            disabled={disabled || loading || !prompt.trim()}
            className="generate-btn"
          >
            {loading ? <Loader size={16} className="animate-spin" /> : <Wand2 size={16} />}
            Generate
          </button>
        </div>

        {generatedImage && (
          <div className="generated-image">
            <img src={generatedImage.startsWith('data:') ? generatedImage : `data:image/png;base64,${generatedImage}`} alt="Generated" />
            <button onClick={handleDownload} className="download-btn" title="Download image">
              <Download size={16} />
            </button>
          </div>
        )}
      </div>
    </Fragment>
  )
}
