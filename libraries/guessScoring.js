export function calculateNormalizedDistance(target, selected, bounds) {
  const x1 = target.x   ?? target[0]
  const y1 = target.y   ?? target[1]
  const x2 = selected.x ?? selected[0]
  const y2 = selected.y ?? selected[1]

  const { width, height } = bounds

  const dx = (x1 - x2) / width
  const dy = (y1 - y2) / height

  const normalizedDistance = Math.hypot(dx, dy) / Math.SQRT2

  return Math.min(1, Math.max(0, normalizedDistance))
}

export function calculateScore(normalizedDistance, maxScore = 1000, decayFactor = 15) {
  if (normalizedDistance <= 0) return maxScore
  if (normalizedDistance >= 1) return 0

  const expDecay            = Math.exp(-decayFactor * normalizedDistance)
  const expMin              = Math.exp(-decayFactor)
  const ratio               = (expDecay - expMin) / (1 - expMin)

  return Math.round(maxScore * ratio)
}

export function evaluateGuess(target, selected, bounds, maxScore = 1000, decayFactor = 15, scoreRadius = 15) {
  const x1 = target.x   ?? target[0]
  const y1 = target.y   ?? target[1]
  const x2 = selected.x ?? selected[0]
  const y2 = selected.y ?? selected[1]

  const distance           = Math.hypot(x1 - x2, y1 - y2)
  const normalizedDistance = calculateNormalizedDistance(target, selected, bounds)
  const score              = distance <= Math.max(0, scoreRadius)
    ? maxScore
    : calculateScore(normalizedDistance, maxScore, decayFactor)

  return {
    distance,
    score,
  }
}