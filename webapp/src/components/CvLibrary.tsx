import { useEffect, useRef, useState } from 'react'
import { ApiError, deleteCv, getCvFileUrl, listCvs, setPrimaryCv, uploadCv } from '../api/client'
import type { Cv } from '../api/types'
import { formatDate } from '../lib/format'

interface Props {
  onActivity: () => void
  /** Runs after a successful upload, before the list refreshes. `isFirst`
   * is true when the library was empty -- the upload became the primary CV. */
  afterUpload?: (isFirst: boolean) => Promise<void>
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(0)} KB`
}

/** The user's master resumes (~/.applypilot/cvs): list, set primary, delete, upload. */
export function CvLibrary({ onActivity, afterUpload }: Props) {
  const [cvs, setCvs] = useState<Cv[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [busyName, setBusyName] = useState<string | null>(null)

  function refresh() {
    listCvs()
      .then((data) => {
        setCvs(data)
        setLoadError(null)
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Failed to load CVs'))
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const isFirst = (cvs?.length ?? 0) === 0
      await uploadCv(file, name.trim())
      setName('')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (afterUpload) await afterUpload(isFirst)
      refresh()
      onActivity()
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : 'Failed to upload CV')
    } finally {
      setUploading(false)
    }
  }

  async function runRowAction(cvName: string, action: () => Promise<unknown>, fallback: string) {
    setBusyName(cvName)
    try {
      await action()
      refresh()
      onActivity()
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : fallback)
    } finally {
      setBusyName(null)
    }
  }

  return (
    <div className="ctx-editor-wrap">
      {loadError && <p className="search-result search-error">{loadError}</p>}

      {cvs && cvs.length === 0 && !loadError && (
        <p className="ctx-hint">No CVs yet. Upload one below. Your first CV becomes the primary one, and AI fills Profile.md from it.</p>
      )}

      {cvs && cvs.length > 0 && (
        <ul className="ctx-cv-list">
          {cvs.map((cv) => (
            <li className={`ctx-cv-card${cv.primary ? ' primary' : ''}`} key={cv.name}>
              <div className="ctx-cv-icon" aria-hidden="true">PDF</div>
              <div className="ctx-cv-info">
                <span className="ctx-cv-title">
                  <a href={getCvFileUrl(cv.name)} target="_blank" rel="noreferrer">{cv.name}</a>
                  {cv.primary && <span className="ctx-segment-badge">Primary</span>}
                </span>
                <span>{formatSize(cv.size)} · uploaded {formatDate(cv.uploaded_at)}</span>
              </div>
              <span className="ctx-actions-spacer" />
              {!cv.primary && (
                <button
                  type="button"
                  className="ctx-btn"
                  disabled={busyName === cv.name}
                  onClick={() => runRowAction(cv.name, () => setPrimaryCv(cv.name), 'Failed to set primary CV')}
                >
                  Set as primary
                </button>
              )}
              <button
                type="button"
                className="ctx-btn ghost"
                disabled={busyName === cv.name}
                onClick={() => runRowAction(cv.name, () => deleteCv(cv.name), 'Failed to delete CV')}
                aria-label={`Delete ${cv.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ctx-subsection">
        <h3 className="ctx-subsection-title">Add a CV</h3>
        <input
          type="text"
          className="ctx-input"
          placeholder="Name (e.g. Backend Engineer) — defaults to filename"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="ctx-actions">
          <label className="ctx-btn">
            Choose PDF
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="ctx-file-input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <span className="ctx-hint">{file ? file.name : 'No file selected'}</span>
          <span className="ctx-actions-spacer" />
          <button type="button" className="ctx-btn primary" disabled={!file || uploading} onClick={handleUpload}>
            {uploading ? 'Uploading…' : 'Upload CV'}
          </button>
        </div>
        {uploadError && <p className="search-result search-error">{uploadError}</p>}
      </div>
    </div>
  )
}
