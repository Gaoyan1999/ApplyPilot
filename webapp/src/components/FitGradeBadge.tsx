import type { FitGrade, FitGradeFilterValue } from '../api/types'

export const LABEL_BY_FIT_GRADE: Record<FitGradeFilterValue, string> = {
  green: 'Strong fit',
  yellow: 'Worth a try',
  red: 'Not a fit',
  ungraded: 'Not graded',
}

export const CLASS_BY_FIT_GRADE: Record<FitGradeFilterValue, string> = {
  green: 'fit-grade-green',
  yellow: 'fit-grade-yellow',
  red: 'fit-grade-red',
  ungraded: 'fit-grade-ungraded',
}

export function FitGradeBadge({ grade }: { grade: FitGrade | null }) {
  if (grade === null) {
    return <span className="fit-grade-badge fit-grade-none">—</span>
  }
  return <span className={`fit-grade-badge ${CLASS_BY_FIT_GRADE[grade]}`}>{LABEL_BY_FIT_GRADE[grade]}</span>
}
