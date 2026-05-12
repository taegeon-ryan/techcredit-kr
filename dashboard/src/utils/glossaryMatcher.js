const KOREAN_PARTICLES = '(?:을|를|의|에|은|는|이|가|도|만|과|와|로|으로|에서|에게|부터|까지|보다|라고|라는|이라|이라는|이며|이고|이다)?'

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isAscii(s) {
  // 한글이 섞이지 않은 문자열은 ASCII 경로(대소문자 무시 + 단어 경계)로 처리한다.
  return !/[가-힣]/.test(s)
}

export function buildMatcher(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { asciiRe: null, koreanRe: null, byKey: new Map() }
  }

  const byKey = new Map()
  const asciiTerms = []
  const koreanTerms = []
  for (const entry of entries) {
    if (!entry || !entry.term) continue
    if (isAscii(entry.term)) {
      byKey.set(entry.term.toUpperCase(), entry)
      asciiTerms.push(entry.term)
    } else {
      byKey.set(entry.term, entry)
      koreanTerms.push(entry.term)
    }
    if (Array.isArray(entry.aliases)) {
      for (const alias of entry.aliases) {
        if (typeof alias !== 'string' || !alias.trim()) continue
        const a = alias.trim()
        if (isAscii(a)) {
          if (!byKey.has(a.toUpperCase())) byKey.set(a.toUpperCase(), entry)
          asciiTerms.push(a)
        } else {
          if (!byKey.has(a)) byKey.set(a, entry)
          koreanTerms.push(a)
        }
      }
    }
  }

  const asciiSorted = [...new Set(asciiTerms)].sort((a, b) => b.length - a.length)
  const koreanSorted = [...new Set(koreanTerms)].sort((a, b) => b.length - a.length)

  const asciiRe = asciiSorted.length
    ? new RegExp('\\b(' + asciiSorted.map(escapeRegex).join('|') + ')\\b', 'gi')
    : null
  const koreanRe = koreanSorted.length
    ? new RegExp('(' + koreanSorted.map(escapeRegex).join('|') + ')' + KOREAN_PARTICLES, 'g')
    : null

  return { asciiRe, koreanRe, byKey }
}

export function tokenize(text, matcher) {
  if (!text) return []
  if (!matcher || (!matcher.asciiRe && !matcher.koreanRe)) return [text]

  const matches = []
  if (matcher.asciiRe) {
    matcher.asciiRe.lastIndex = 0
    let m
    while ((m = matcher.asciiRe.exec(text)) !== null) {
      const matched = m[1]
      const term = matcher.byKey.get(matched.toUpperCase())
      if (term) matches.push({ start: m.index, end: m.index + matched.length, matched, term })
    }
  }
  if (matcher.koreanRe) {
    matcher.koreanRe.lastIndex = 0
    let m
    while ((m = matcher.koreanRe.exec(text)) !== null) {
      const matched = m[1]
      const term = matcher.byKey.get(matched)
      if (term) matches.push({ start: m.index, end: m.index + matched.length, matched, term })
    }
  }

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
    tokens.push({ term: m.term, matched: m.matched })
    i = m.end
  }
  if (i < text.length) tokens.push(text.slice(i))
  return tokens
}
