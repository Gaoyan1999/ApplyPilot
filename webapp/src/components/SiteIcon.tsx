interface SiteMeta {
  label: string
  abbr: string
  color: string
}

export const SITE_META: Record<string, SiteMeta> = {
  linkedin: { label: 'LinkedIn', abbr: 'in', color: '#0a66c2' },
  indeed: { label: 'Indeed', abbr: 'Id', color: '#2164f3' },
  glassdoor: { label: 'Glassdoor', abbr: 'gd', color: '#0caa41' },
  zip_recruiter: { label: 'ZipRecruiter', abbr: 'zr', color: '#4776e6' },
  ziprecruiter: { label: 'ZipRecruiter', abbr: 'zr', color: '#4776e6' },
  google: { label: 'Google', abbr: 'g', color: '#ea4335' },
}

// Valid jobspy site_name values for the quick-search form (excludes the
// "ziprecruiter" alias and "google", which jobspy doesn't accept directly).
export const SEARCHABLE_SITES = ['indeed', 'linkedin', 'glassdoor', 'zip_recruiter']

const FALLBACK_COLOR = '#787774'

function metaFor(site: string | null): SiteMeta {
  const key = (site || '').toLowerCase().trim()
  if (SITE_META[key]) return SITE_META[key]
  const label = site && site.trim() ? site : 'Unknown'
  return { label, abbr: label.slice(0, 2).toUpperCase(), color: FALLBACK_COLOR }
}

export function SiteIcon({ site }: { site: string | null }) {
  const meta = metaFor(site)
  return (
    <span
      className="site-icon"
      style={{ background: meta.color }}
      title={meta.label}
      aria-label={meta.label}
    >
      {meta.abbr}
    </span>
  )
}
