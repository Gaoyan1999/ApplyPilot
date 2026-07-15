import { useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Job } from '../api/types'
import { formatDate } from '../lib/format'
import { ScorePill } from './ScorePill'
import { StageBadge } from './StageBadge'
import { SiteIcon } from './SiteIcon'

interface Props {
  job: Job
  onClose: () => void
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="meta-row">
      <div className="meta-label">{label}</div>
      <div className="meta-value">{children}</div>
    </div>
  )
}

export function JobPreviewModal({ job, onClose }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
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
