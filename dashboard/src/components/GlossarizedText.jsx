import { Fragment, createElement, useMemo } from 'react'
import { useGlossary } from '../hooks/useGlossary'
import { tokenize } from '../utils/glossaryMatcher'
import { TermSpan } from './TermPopover'

export function GlossarizedText({ text, as = 'p', className, fallback = '(설명 없음)' }) {
  const { matcher } = useGlossary()
  const safe = text ?? ''
  const tokens = useMemo(() => tokenize(safe, matcher), [safe, matcher])

  const content = safe
    ? tokens.map((token, i) =>
        typeof token === 'string'
          ? <Fragment key={i}>{token}</Fragment>
          : <TermSpan key={i} term={token.term} matched={token.matched} />,
      )
    : fallback

  return createElement(as, { className }, content)
}
