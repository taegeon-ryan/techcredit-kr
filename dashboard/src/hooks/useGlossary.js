import { useEffect, useMemo, useState } from 'react'

// glossary.json: [{concept_id, en_abbrev, en_full, korean, domain, short, related?}]
// term_spans.json: { [tech_id]: [{surface, concept_id}, ...] }

const EMPTY = { byConceptId: new Map(), spans: {}, loaded: false }

export function useGlossary() {
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/glossary.json`).then(r => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`${import.meta.env.BASE_URL}data/term_spans.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
    ]).then(([entries, spans]) => {
      if (cancelled) return
      setData({
        entries: Array.isArray(entries) ? entries : [],
        spans: spans && typeof spans === 'object' ? spans : {},
      })
    })
    return () => { cancelled = true }
  }, [])

  return useMemo(() => {
    if (!data) return EMPTY
    const byConceptId = new Map()
    for (const e of data.entries) {
      if (e && e.concept_id) byConceptId.set(e.concept_id, e)
    }
    return { byConceptId, spans: data.spans, loaded: true }
  }, [data])
}

// 주어진 tech_id 의 spans 를 가져온다. 글로서리에 정의된 concept 만 남김.
export function spansForTech(glossary, tech_id) {
  if (!glossary || !glossary.spans) return []
  const list = glossary.spans[tech_id]
  if (!Array.isArray(list)) return []
  return list.filter(s => s && s.surface && glossary.byConceptId.has(s.concept_id))
}
