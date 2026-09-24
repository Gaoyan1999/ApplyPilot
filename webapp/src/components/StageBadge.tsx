import type { Stage } from '../api/types'

export const CLASS_BY_STAGE: Record<Stage, string> = {
  Discovered: 'stage-discovered',
  Enriched: 'stage-enriched',
  Scored: 'stage-scored',
  Tailored: 'stage-tailored',
  'Cover Letter Ready': 'stage-cover-letter-ready',
  Applying: 'stage-applying',
  'Ready for Review': 'stage-ready-for-review',
  Blocked: 'stage-blocked',
  Applied: 'stage-applied',
  Failed: 'stage-failed',
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`stage-badge ${CLASS_BY_STAGE[stage]}`}>{stage}</span>
}
