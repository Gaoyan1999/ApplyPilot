interface Criteria {
  met: string[]
  gaps: string[]
}

function parseCriteria(raw: string): Criteria | null {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.met) && Array.isArray(parsed?.gaps)) {
      return { met: parsed.met, gaps: parsed.gaps }
    }
  } catch {
    // Older rows stored a plain "keywords\nreasoning" string, not JSON.
  }
  return null
}

// Renders the LLM's fit assessment as a met/gap checklist. Falls back to
// the raw text for jobs scored before this format existed.
export function ScoreCriteria({ reasoning }: { reasoning: string }) {
  const criteria = parseCriteria(reasoning)
  if (!criteria || (criteria.met.length === 0 && criteria.gaps.length === 0)) {
    return <span className="meta-note">{reasoning}</span>
  }

  return (
    <div className="score-criteria">
      {criteria.met.map((item, i) => (
        <div className="score-criteria-row" key={`met-${i}`}>
          <span className="score-criteria-icon met">✓</span>
          <span>{item}</span>
        </div>
      ))}
      {criteria.gaps.map((item, i) => (
        <div className="score-criteria-row" key={`gap-${i}`}>
          <span className="score-criteria-icon miss">✕</span>
          <span className="score-criteria-text-miss">{item}</span>
        </div>
      ))}
    </div>
  )
}
