import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ApiError, generateCoverLetter, getCoverLetter } from '../api/client'
import type { Job, UserAction } from '../api/types'
import { formatDate } from '../lib/format'
import { ScorePill } from './ScorePill'
import { StageBadge } from './StageBadge'
import { SiteIcon } from './SiteIcon'
import { UserActionSelect } from './UserActionSelect'

interface Props {
  job: Job
  onClose: () => void
  onUserActionChange: (job: Job, value: UserAction | null) => void
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="meta-row">
      <div className="meta-label">{label}</div>
      <div className="meta-value">{children}</div>
    </div>
  )
}

export function JobPreviewModal({ job, onClose, onUserActionChange }: Props) {
  const [coverLetterText, setCoverLetterText] = useState<string | null>(null)
  const [coverLetterLoading, setCoverLetterLoading] = useState(false)
  const [coverLetterError, setCoverLetterError] = useState<string | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    setCoverLetterText(null)
    setCoverLetterError(null)
    if (!job.cover_letter_path) return
    let cancelled = false
    getCoverLetter(job.url)
      .then((res) => {
        if (!cancelled) setCoverLetterText(res.text)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [job.url, job.cover_letter_path])

  async function handleGenerateCoverLetter() {
    setCoverLetterLoading(true)
    setCoverLetterError(null)
    try {
      const res = await generateCoverLetter(job.url)
      setCoverLetterText(res.text)
    } catch (e) {
      setCoverLetterError(e instanceof ApiError ? e.message : 'Failed to generate cover letter')
    } finally {
      setCoverLetterLoading(false)
    }
  }

  return (
    <div className="modal-backdrop job-detail-backdrop" onClick={onClose}>
      <div className="modal-panel job-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{job.title || '(untitled)'}</h2>
            <div className="modal-subtitle">
              {[job.company, job.site, job.location].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="meta-grid">
            <MetaRow label="Mark">
              <UserActionSelect
                value={job.user_action}
                onChange={(value) => onUserActionChange(job, value)}
              />
            </MetaRow>
            <MetaRow label="Stage">
              <StageBadge stage={job.stage} />
            </MetaRow>
            <MetaRow label="Score">
              <ScorePill score={job.fit_score} />
              {job.score_reasoning && <span className="meta-note">{job.score_reasoning}</span>}
            </MetaRow>
            {job.salary && <MetaRow label="Salary">{job.salary}</MetaRow>}
            <MetaRow label="Listing">
              <a href={job.url} target="_blank" rel="noreferrer">
                <SiteIcon site={job.site} /> Open listing
              </a>
            </MetaRow>
            {job.application_url && job.application_url !== job.url && job.application_url !== 'None' && (
              <MetaRow label="Apply link">
                <a href={job.application_url} target="_blank" rel="noreferrer">
                  {job.application_url}
                </a>
              </MetaRow>
            )}
            <MetaRow label="Discovered">{formatDate(job.discovered_at)}</MetaRow>
            {job.scored_at && <MetaRow label="Scored">{formatDate(job.scored_at)}</MetaRow>}
            {job.tailored_at && (
              <MetaRow label="Tailored">
                {formatDate(job.tailored_at)}
                {job.tailor_attempts > 0 && ` (${job.tailor_attempts} attempt${job.tailor_attempts === 1 ? '' : 's'})`}
              </MetaRow>
            )}
            {job.cover_letter_at && (
              <MetaRow label="Cover letter">
                {formatDate(job.cover_letter_at)}
                {job.cover_attempts > 0 && ` (${job.cover_attempts} attempt${job.cover_attempts === 1 ? '' : 's'})`}
              </MetaRow>
            )}
            {job.applied_at && <MetaRow label="Applied">{formatDate(job.applied_at)}</MetaRow>}
            {job.apply_status && <MetaRow label="Apply status">{job.apply_status}</MetaRow>}
            {job.apply_error && <MetaRow label="Apply error">{job.apply_error}</MetaRow>}
            {job.detail_error && <MetaRow label="Enrichment error">{job.detail_error}</MetaRow>}
          </div>

          <div className="section-heading-row">
            <h3 className="section-heading">Cover Letter</h3>
            <button
              type="button"
              disabled={coverLetterLoading || !job.full_description}
              title={!job.full_description ? 'Needs a job description first' : undefined}
              onClick={handleGenerateCoverLetter}
            >
              {coverLetterLoading
                ? 'Generating…'
                : coverLetterText
                  ? 'Regenerate'
                  : 'Generate cover letter'}
            </button>
          </div>
          {coverLetterError && <p className="cover-letter-error">{coverLetterError}</p>}
          {coverLetterText ? (
            <pre className="cover-letter-text">{coverLetterText}</pre>
          ) : (
            !coverLetterLoading && <p className="empty-state">No cover letter yet.</p>
          )}

          <h3 className="section-heading">Job Description</h3>
          {job.full_description ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.full_description}</ReactMarkdown>
          ) : (
            <p className="empty-state">No description available yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
