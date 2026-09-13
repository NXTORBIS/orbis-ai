import { Fragment, useState } from 'react'
import { Image as ImageIcon, Loader } from 'lucide-react'
import type { Attachment } from '../../../shared/types'

interface Props {
  disabled?: boolean
  onImageSelect(file: File): void
}

export default function VisionUI({ disabled, onImageSelect }: Props) {
  const [loading, setLoading] = useState(false)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    setLoading(true)
    try {
      onImageSelect(file)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Fragment>
      <label className="vision-button" title="Attach image">
        {loading ? <Loader size={18} className="animate-spin" /> : <ImageIcon size={18} />}
        <input type="file" accept="image/*" onChange={handleFileSelect} disabled={disabled || loading} style={{ display: 'none' }} />
      </label>
    </Fragment>
  )
}

/** Display an attached image in a message. */
export function ImageAttachment({ content, name }: Attachment) {
  const isBase64 = content.startsWith('data:image')
  return (
    <div className="image-attachment">
      <img src={isBase64 ? content : `data:image/jpeg;base64,${content}`} alt={name} loading="lazy" />
      <div className="image-name">{name}</div>
    </div>
  )
}
