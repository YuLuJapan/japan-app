// Photo block with a graceful fallback: when there is no image (or it fails to
// load on a bad connection), show a warm gradient with an icon — never a
// broken-image icon.
import { useState } from 'react'

interface Props {
  src?: string | null
  alt: string
  icon?: string
  className?: string
}

export function ZoneImage({ src, alt, icon = '📍', className = '' }: Props) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center bg-gradient-to-br from-sun/70 via-brand/60 to-brand ${className}`}
      >
        <span className="text-3xl opacity-90 drop-shadow">{icon}</span>
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
