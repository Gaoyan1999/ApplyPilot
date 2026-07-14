import { useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Job } from '../api/types'

interface Props {
  job: Job
  onClose: () => void
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
              {[job.site, job.location].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
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
