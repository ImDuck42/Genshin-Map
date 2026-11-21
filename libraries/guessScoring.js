export function calculateNormalizedDistance(target, selected, bounds) {
  const dx = ((target.x ?? target[0]) - (selected.x ?? selected[0])) / bounds.width
  const dy = ((target.y ?? target[1]) - (selected.y ?? selected[1])) / bounds.height

  return Math.min(1, Math.max(0, Math.sqrt(dx * dx + dy * dy) / Math.SQRT2))
}

export function calculateScore(normalizedDistance, maxScore = 1000, decayFactor = 15) {
  if (normalizedDistance <= 0) return maxScore
  if (normalizedDistance >= 1) return 0

  const expDecay = Math.exp(-decayFactor * normalizedDistance)
  const expMin   = Math.exp(-decayFactor)

  return Math.round(maxScore * ((expDecay - expMin) / (1 - expMin)))
}

export function evaluateGuess(target, selected, bounds, maxScore = 1000, decayFactor = 15, scoreRadius = 15) {
  const dx                 = (target.x ?? target[0]) - (selected.x ?? selected[0])
  const dy                 = (target.y ?? target[1]) - (selected.y ?? selected[1])
  const distance           = Math.sqrt(dx * dx + dy * dy)
  const normalizedDistance = Math.min(1, Math.max(0, Math.sqrt((dx / bounds.width) ** 2 + (dy / bounds.height) ** 2) / Math.SQRT2))

  const score = distance <= Math.max(0, scoreRadius)
    ? maxScore
    : calculateScore(normalizedDistance, maxScore, decayFactor)

  return { distance, normalizedDistance, score }
}