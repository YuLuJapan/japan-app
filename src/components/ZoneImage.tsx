// Photo block with a graceful fallback: when there is no image (or it fails to
// load on a bad connection), show a quiet paper block with the Japanese name —
// never a broken-image icon.
import { useState } from 'react'

interface Props {
  src?: string | null
  alt: string
  nameJa?: string | null
  className?: string
}

export function ZoneImage({ src, alt, nameJa, className = '' }: Props) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center bg-gradient-to-br from-sand/60 to-sand ${className}`}
      >
        <span className="font-display text-3xl text-fog/50">{nameJa || '旅'}</span>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  )
}
