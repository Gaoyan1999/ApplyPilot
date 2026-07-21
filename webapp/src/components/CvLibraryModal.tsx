import { useEffect, useRef, useState } from 'react'
import { ApiError, deleteCv, getCvFileUrl, listCvs, uploadCv } from '../api/client'
import type { Cv } from '../api/types'
import { formatDate } from '../lib/format'

interface Props {
  onActivity: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function CvLibraryModal({ onActivity }: Props) {
  const [open, setOpen] = useState(false)
  const [cvs, setCvs] = useState<Cv[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [deletingName, setDeletingName] = useState<string | null>(null)

  function refresh() {
    listCvs()
      .then((data) => {
        setCvs(data)
        setLoadError(null)
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Failed to load CVs'))
  }

  useEffect(() => {
    if (open) refresh()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      await uploadCv(file, name.trim())
      setName('')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      refresh()
      onActivity()
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : 'Failed to upload CV')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(cvName: string) {
    setDeletingName(cvName)
    try {
      await deleteCv(cvName)
      refresh()
      onActivity()
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Failed to delete CV')
    } finally {
      setDeletingName(null)
    }
  }

  return (
    <>
      <button
        type="button"
        className="search-trigger cv-library-trigger"
        onClick={() => setOpen(true)}
        title="Manage your CV library"
      >
        CVs{cvs && cvs.length > 0 ? ` (${cvs.length})` : ''}
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel cv-library-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">CV Library</h2>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="cv-library-panel">
              <p className="prompt-field-description">
                Master resumes you maintain yourself. When auto-submitting a job with no tailored resume,
                the best-matching CV here is used instead — no LLM rewriting, just selection.
              </p>

              {loadError && <p className="search-result search-error">{loadError}</p>}

              {cvs && cvs.length === 0 && !loadError && (
                <p className="empty-state">No CVs yet — upload one below.</p>
              )}

              {cvs && cvs.length > 0 && (
                <div className="cv-list">
                  {cvs.map((cv) => (
                    <div className="config-row cv-row" key={cv.name}>
                      <div className="cv-row-info">
                        <a href={getCvFileUrl(cv.name)} target="_blank" rel="noreferrer" className="cv-row-name">
                          {cv.name}
                        </a>
                        <span className="cv-row-meta">
                          {formatSize(cv.size)} · uploaded {formatDate(cv.uploaded_at)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="remove-btn"
                        disabled={deletingName === cv.name}
                        onClick={() => handleDelete(cv.name)}
                        aria-label={`Delete ${cv.name}`}
                      >
                        {deletingName === cv.name ? '…' : '✕'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="config-section cv-upload-section">
                <h3>Add a CV</h3>
                <div className="config-row">
                  <input
                    type="text"
                    placeholder="Name (e.g. Backend Engineer) — defaults to filename"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="config-row">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <button type="button" disabled={!file || uploading} onClick={handleUpload}>
                    {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
                {uploadError && <p className="cover-letter-error">{uploadError}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
