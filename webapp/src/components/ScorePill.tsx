export function ScorePill({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="score-pill none">—</span>
  }
  const tier = score >= 7 ? 'high' : score >= 5 ? 'mid' : 'low'
  return <span className={`score-pill ${tier}`}>{score}</span>
}
