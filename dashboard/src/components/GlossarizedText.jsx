import { Fragment, createElement, useMemo } from 'react'
import { useGlossary, spansForTech } from '../hooks/useGlossary'
import { tokenizeBySpans } from '../utils/glossaryMatcher'
import { TermSpan } from './TermPopover'

// 본문을 tech_id 의 spans 기준으로 하이라이트.
//   - techId: 어느 기술의 본문인지 (term_spans.json 키)
//   - allowedConcepts: Set<concept_id> 또는 null. 사업화시설 등에서 부모 기술의 concept 집합으로 제한.
export function GlossarizedText({ text, techId, allowedConcepts = null, as = 'p', className, fallback = '(설명 없음)' }) {
  const glossary = useGlossary()
  const spans = useMemo(() => spansForTech(glossary, techId), [glossary, techId])
  const tokens = useMemo(
    () => tokenizeBySpans(text ?? '', spans, glossary.byConceptId, allowedConcepts),
    [text, spans, glossary.byConceptId, allowedConcepts],
  )

  const safe = text ?? ''
  const content = safe
    ? tokens.map((token, i) =>
        typeof token === 'string'
          ? <Fragment key={i}>{token}</Fragment>
          : <TermSpan key={i} surface={token.surface} entry={token.entry} />,
      )
    : fallback

  return createElement(as, { className }, content)
}
