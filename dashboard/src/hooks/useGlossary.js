import { useEffect, useMemo, useState } from 'react'
import { buildMatcher } from '../utils/glossaryMatcher'

const EMPTY = { asciiRe: null, koreanRe: null, byKey: new Map() }

export function useGlossary() {
  const [entries, setEntries] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}data/glossary.json`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        if (!cancelled) setEntries(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => { cancelled = true }
  }, [])

  const matcher = useMemo(() => {
    if (!entries || entries.length === 0) return EMPTY
    return buildMatcher(entries)
  }, [entries])

  return { matcher, loaded: entries != null }
}
