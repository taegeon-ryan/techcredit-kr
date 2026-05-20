// 본문을 spans 기준으로 토큰화한다.
// spans: [{surface, concept_id}, ...] — 같은 surface 가 본문에 여러 번 등장하면 모두 매칭한다.
// 토큰 결과: 문자열 또는 { surface, concept_id, entry } 객체의 배열.

export function tokenizeBySpans(text, spans, byConceptId, allowedConcepts = null) {
  if (!text) return []
  if (!Array.isArray(spans) || !spans.length || !byConceptId) return [text]

  // surface 가 긴 것부터 매칭(겹침 방지). 같은 surface 가 두 spans 항목으로 와도 합쳐 처리.
  const surfaceMap = new Map()
  for (const s of spans) {
    if (!s.surface) continue
    if (allowedConcepts && !allowedConcepts.has(s.concept_id)) continue
    if (!byConceptId.has(s.concept_id)) continue
    if (!surfaceMap.has(s.surface)) surfaceMap.set(s.surface, s.concept_id)
  }
  const surfaces = [...surfaceMap.keys()].sort((a, b) => b.length - a.length)
  if (!surfaces.length) return [text]

  const matches = []
  for (const surface of surfaces) {
    let idx = 0
    while (idx <= text.length - surface.length) {
      const found = text.indexOf(surface, idx)
      if (found === -1) break
      matches.push({ start: found, end: found + surface.length, surface })
      idx = found + surface.length
    }
  }
  // 겹치는 매칭 제거 — 시작 위치 오름차순, 길이 내림차순 우선
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const accepted = []
  let cursor = 0
  for (const m of matches) {
    if (m.start >= cursor) {
      accepted.push(m)
      cursor = m.end
    }
  }

  const tokens = []
  let i = 0
  for (const m of accepted) {
    if (m.start > i) tokens.push(text.slice(i, m.start))
    const concept_id = surfaceMap.get(m.surface)
    const entry = byConceptId.get(concept_id)
    tokens.push({ surface: m.surface, concept_id, entry })
    i = m.end
  }
  if (i < text.length) tokens.push(text.slice(i))
  return tokens
}
