import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ApiError,
  cancelAutoSubmit,
  generateCoverLetter,
  getAutoSubmitStatus,
  getCoverLetter,
  getCoverLetterPdfUrl,
  getJob,
  triggerAutoSubmit,
} from '../api/client'
import type { AutoSubmitStatus, Job, UserAction } from '../api/types'
import { formatDate } from '../lib/format'
import { ScorePill } from './ScorePill'
import { SiteIcon } from './SiteIcon'
import { UserActionSelect } from './UserActionSelect'

export const MIN_PANEL_WIDTH = 360
export const MAX_PANEL_WIDTH = 900

interface Props {
  job: Job
  onClose: () => void
  onUserActionChange: (job: Job, value: UserAction | null) => void
  onDismissChange: (job: Job, dismissed: boolean) => void
  onCoverLetterGenerated: () => void
  onAutoSubmitComplete: () => void
  cvCount: number
  width: number
  onWidthChange: (width: number) => void
}

// Friendlier labels for the specific reason codes launcher.py's PERMANENT_FAILURES
// writes into apply_error -- anything not in this map just shows the raw
// reason text, which is still useful, just untranslated.
const FAILURE_LABELS: Record<string, string> = {
  no_resume: 'No matching resume found — add a CV or tailor one for this job first.',
  captcha: 'Blocked by a CAPTCHA the agent could not solve.',
  login_issue: 'The site required a login the agent could not complete.',
  expired: 'The job posting appears to have expired.',
  not_eligible_location: 'Not eligible — location requirement not met.',
  not_eligible_salary: 'Not eligible — salary requirement not met.',
  already_applied: 'The site indicates this application was already submitted.',
  account_required: 'The site requires creating an account to apply.',
  not_a_job_application: "This page doesn't appear to be a job application.",
  unsafe_permissions: 'Stopped for safety — the form requested unusual permissions.',
  unsafe_verification: 'Stopped for safety — an unusual verification step was requested.',
  sso_required: 'The site requires single sign-on the agent could not complete.',
  site_blocked: 'This site is blocked from auto-submit.',
  cloudflare_blocked: 'Blocked by Cloudflare bot protection.',
  blocked_by_cloudflare: 'Blocked by Cloudflare bot protection.',
}

function describeFailure(reason: string | null): string {
  if (!reason) return 'Auto-submit failed.'
  return FAILURE_LABELS[reason] ?? reason
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="meta-row">
      <div className="meta-label">{label}</div>
      <div className="meta-value">{children}</div>
    </div>
  )
}

export function JobPreviewModal({
  job,
  onClose,
  onUserActionChange,
  onDismissChange,
  onCoverLetterGenerated,
  onAutoSubmitComplete,
  cvCount,
  width,
  onWidthChange,
}: Props) {
  const [coverLetterText, setCoverLetterText] = useState<string | null>(null)
  const [coverLetterLoading, setCoverLetterLoading] = useState(false)
  const [coverLetterError, setCoverLetterError] = useState<string | null>(null)

  const [autoSubmitStarting, setAutoSubmitStarting] = useState(false)
  const [autoSubmitRunning, setAutoSubmitRunning] = useState(false)
  const [autoSubmitStatus, setAutoSubmitStatus] = useState<AutoSubmitStatus | null>(null)
  const [autoSubmitError, setAutoSubmitError] = useState<string | null>(null)

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    document.body.classList.add('col-resizing')

    function onMouseMove(ev: MouseEvent) {
      // Panel is docked to the right edge, so dragging left (shrinking
      // clientX) grows it.
      const delta = startX - ev.clientX
      onWidthChange(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidth + delta)))
    }
    function onMouseUp() {
      document.body.classList.remove('col-resizing')
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Keyed on job.url alone, not job.cover_letter_path: generating a cover
  // letter already sets coverLetterText locally from the response, and the
  // refresh that follows updates cover_letter_path on this same job -- keying
  // on that too would re-fetch text we already have. Only switching to a
  // different job should trigger a fresh load.
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
  }, [job.url])

  async function handleGenerateCoverLetter() {
    setCoverLetterLoading(true)
    setCoverLetterError(null)
    try {
      const res = await generateCoverLetter(job.url)
      setCoverLetterText(res.text)
      onCoverLetterGenerated()
    } catch (e) {
      setCoverLetterError(e instanceof ApiError ? e.message : 'Failed to generate cover letter')
    } finally {
      setCoverLetterLoading(false)
    }
  }

  // Reset on job switch, then check once whether a run is already in flight
  // for *this* job -- e.g. the panel was closed and reopened, or reloaded,
  // while auto-submit was still going.
  useEffect(() => {
    setAutoSubmitError(null)
    setAutoSubmitRunning(false)
    setAutoSubmitStatus(null)
    let cancelled = false
    getAutoSubmitStatus(job.url)
      .then((s) => {
        if (cancelled) return
        setAutoSubmitStatus(s)
        if (s.running && s.url === job.url) setAutoSubmitRunning(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [job.url])

  // Once the run finishes, apply_status/apply_error/applied_at on the DB row
  // are the source of truth for what happened -- re-fetch rather than trying
  // to infer the outcome from anything tracked in this component.
  async function handleAutoSubmitFinished() {
    try {
      const fresh = await getJob(job.url)
      if (fresh.applied_at) {
        // Reuses the existing Mark-as mutation, which already refreshes the
        // jobs list + this preview panel -- no need to also call
        // onAutoSubmitComplete in this branch.
        onUserActionChange(job, 'applied')
        return
      }
    } catch {
      // fall through to the generic refresh below
    }
    onAutoSubmitComplete()
  }

  useEffect(() => {
    if (!autoSubmitRunning) return
    const timer = setInterval(async () => {
      try {
        const s = await getAutoSubmitStatus(job.url)
        setAutoSubmitStatus(s)
        if (!s.running) {
          setAutoSubmitRunning(false)
          handleAutoSubmitFinished()
        }
      } catch {
        // keep polling — transient network hiccup
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [autoSubmitRunning, job.url])

  async function handleAutoSubmit() {
    setAutoSubmitStarting(true)
    setAutoSubmitError(null)
    try {
      const s = await triggerAutoSubmit(job.url)
      setAutoSubmitStatus(s)
      setAutoSubmitRunning(true)
    } catch (e) {
      setAutoSubmitError(e instanceof ApiError ? e.message : 'Failed to start auto-submit')
    } finally {
      setAutoSubmitStarting(false)
    }
  }

  async function handleCancelAutoSubmit() {
    try {
      await cancelAutoSubmit(job.url)
    } catch {
      // best-effort -- the next poll tick will reflect whatever actually happened
    }
  }

  const autoSubmitRunningElsewhere = Boolean(
    autoSubmitStatus?.running && autoSubmitStatus.url !== job.url,
  )

  return (
    <div className="modal-panel job-detail-panel" style={{ width }}>
      <div className="job-detail-resize-handle" onMouseDown={startResize} />
      <button type="button" className="job-detail-close" onClick={onClose} aria-label="Close" title="Close">
        »
      </button>
      <div className="modal-header">
        <div>
          <h2 className="modal-title">{job.title || '(untitled)'}</h2>
          <div className="modal-subtitle">
            {[job.company, job.site, job.location].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="modal-header-actions">
          <button
            type="button"
            className={`dismiss-toggle${job.dismissed ? ' dismiss-toggle-active' : ''}`}
            onClick={() => onDismissChange(job, !job.dismissed)}
            title={job.dismissed ? 'Show this job in the dashboard again' : 'Hide this job from the dashboard'}
          >
            {job.dismissed ? 'Restore' : 'Not for me'}
          </button>
        </div>
      </div>

      <div className="modal-body">
        <div className="meta-grid">
          <MetaRow label="Mark">
            <UserActionSelect
              value={job.user_action}
              onChange={(value) => onUserActionChange(job, value)}
            />
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
          <h3 className="section-heading">Auto-Submit</h3>
          {autoSubmitRunning ? (
            <button type="button" className="auto-submit-cancel" onClick={handleCancelAutoSubmit}>
              Cancel
            </button>
          ) : (
            !job.applied_at && (
              <button
                type="button"
                disabled={autoSubmitStarting || (!job.tailored_at && cvCount === 0) || autoSubmitRunningElsewhere}
                title={
                  !job.tailored_at && cvCount === 0
                    ? 'Add a CV in the CV library or tailor a resume for this job first'
                    : autoSubmitRunningElsewhere
                      ? 'Another auto-submit is already running'
                      : undefined
                }
                onClick={handleAutoSubmit}
              >
                {autoSubmitStarting ? 'Starting…' : 'Auto-Submit Application'}
              </button>
            )
          )}
        </div>
        {autoSubmitError && <p className="cover-letter-error">{autoSubmitError}</p>}
        {autoSubmitRunning && (
          <div className="auto-submit-block auto-submit-running">
            <span className="auto-submit-spinner" />
            {autoSubmitStatus?.status ? `${autoSubmitStatus.status} — ` : 'Starting… '}
            {autoSubmitStatus?.last_action || 'launching Chrome'}
            {autoSubmitStatus && autoSubmitStatus.actions > 0 && ` (${autoSubmitStatus.actions} actions)`}
          </div>
        )}
        {!autoSubmitRunning && autoSubmitStatus?.error && (
          <div className="auto-submit-block auto-submit-blocked">{autoSubmitStatus.error}</div>
        )}
        {!autoSubmitRunning && job.applied_at && (
          <div className="auto-submit-block auto-submit-success">Applied {formatDate(job.applied_at)}</div>
        )}
        {!autoSubmitRunning && !job.applied_at && job.apply_status === 'manual' && (
          <div className="auto-submit-block auto-submit-blocked">
            This site isn't supported for auto-submit — apply manually.
          </div>
        )}
        {!autoSubmitRunning && !job.applied_at && job.apply_status === 'failed' && (
          <div className="auto-submit-block auto-submit-failed">{describeFailure(job.apply_error)}</div>
        )}

        <div className="section-heading-row">
          <h3 className="section-heading">Cover Letter</h3>
          <div className="cover-letter-actions">
            {coverLetterText && (
              <a
                className="cover-letter-download"
                href={getCoverLetterPdfUrl(job.url)}
                download
              >
                Download PDF
              </a>
            )}
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
        </div>
        {coverLetterError && <p className="cover-letter-error">{coverLetterError}</p>}
        {coverLetterText && <pre className="cover-letter-text">{coverLetterText}</pre>}

        <h3 className="section-heading">Job Description</h3>
        {job.full_description ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.full_description}</ReactMarkdown>
        ) : (
          <p className="empty-state">No description available yet.</p>
        )}
      </div>
    </div>
  )
}

