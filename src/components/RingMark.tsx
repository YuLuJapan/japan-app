// The small ring mark from the design prototype — a plain white circle on
// the brand-coral square, used in the trips-list and in-trip headers (the
// login screen has its own larger version with an accent dot).
export function RingMark({ size = 34 }: { size?: number }) {
  const ring = Math.round(size * 0.38)
  return (
    <span
      className="flex shrink-0 items-center justify-center bg-brand shadow-card"
      style={{ width: size, height: size, borderRadius: size * 0.35 }}
      aria-hidden
    >
      <span
        className="rounded-full border-white"
        style={{ width: ring, height: ring, borderWidth: 2.5 }}
      />
    </span>
  )
}
