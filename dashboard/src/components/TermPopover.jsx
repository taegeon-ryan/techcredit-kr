import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const PopoverContext = createContext(null)

const HOVER_OPEN_DELAY = 120
const HOVER_CLOSE_DELAY = 160

function hasHover() {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

export function TermPopoverProvider({ children }) {
  const [state, setState] = useState(null) // { term, matched, anchorEl, source: 'hover'|'click'|'focus' }
  const hoverTimer = useRef(0)
  const closeTimer = useRef(0)

  const close = useCallback(() => {
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    setState(null)
  }, [])

  const openImmediate = useCallback((next) => {
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    setState(next)
  }, [])

  const scheduleHoverOpen = useCallback((next) => {
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    hoverTimer.current = window.setTimeout(() => setState(next), HOVER_OPEN_DELAY)
  }, [])

  const scheduleHoverClose = useCallback(() => {
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setState(null), HOVER_CLOSE_DELAY)
  }, [])

  const cancelHoverClose = useCallback(() => {
    clearTimeout(closeTimer.current)
  }, [])

  useEffect(() => {
    if (!state) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') close()
    }
    const onPointer = (e) => {
      if (state.source !== 'click') return
      if (!state.anchorEl) return
      if (state.anchorEl.contains(e.target)) return
      // 팝오버 본체 클릭은 살림 — 팝오버 노드는 data 속성으로 식별
      const popoverEl = document.querySelector('[data-term-popover="open"]')
      if (popoverEl && popoverEl.contains(e.target)) return
      close()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [state, close])

  const api = useMemo(() => ({
    state,
    close,
    openImmediate,
    scheduleHoverOpen,
    scheduleHoverClose,
    cancelHoverClose,
  }), [state, close, openImmediate, scheduleHoverOpen, scheduleHoverClose, cancelHoverClose])

  return (
    <PopoverContext.Provider value={api}>
      {children}
      {state ? <PopoverBody state={state} api={api} /> : null}
    </PopoverContext.Provider>
  )
}

function PopoverBody({ state, api }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0, placement: 'bottom' })

  useLayoutEffect(() => {
    const anchor = state.anchorEl
    const el = ref.current
    if (!anchor || !el) return
    const rect = anchor.getBoundingClientRect()
    const popRect = el.getBoundingClientRect()
    const margin = 6
    let left = rect.left + rect.width / 2 - popRect.width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8))
    const wantBottom = rect.bottom + margin + popRect.height <= window.innerHeight - 8
    const top = wantBottom
      ? rect.bottom + margin
      : Math.max(8, rect.top - margin - popRect.height)
    setPos({ top: Math.round(top + window.scrollY), left: Math.round(left + window.scrollX), placement: wantBottom ? 'bottom' : 'top' })
  }, [state])

  const hoverMode = state.source === 'hover'

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      data-term-popover="open"
      data-placement={pos.placement}
      className="term-popover"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={hoverMode ? api.cancelHoverClose : undefined}
      onMouseLeave={hoverMode ? api.scheduleHoverClose : undefined}
    >
      <div className="term-popover-head">
        <span className="term-popover-title">{state.term.term}</span>
        {state.term.domain && <span className="term-popover-domain">{state.term.domain}</span>}
      </div>
      {state.term.aliases?.length ? (
        <div className="term-popover-aliases">{state.term.aliases.join(' · ')}</div>
      ) : null}
      <div className="term-popover-body">{state.term.short || '(설명 준비 중)'}</div>
      <div className="term-popover-disclaimer">AI가 생성한 설명으로, 일부 불확실한 정보가 포함될 수 있습니다.</div>
    </div>,
    document.body,
  )
}

export function TermSpan({ term, matched }) {
  const ctx = useContext(PopoverContext)
  const ref = useRef(null)
  const id = useId()
  const supportsHover = useMemo(() => hasHover(), [])

  if (!ctx) {
    return <span className="term-marker">{matched}</span>
  }

  const isOpen = ctx.state?.id === id

  const onClick = (e) => {
    if (supportsHover) return
    e.stopPropagation()
    if (isOpen) ctx.close()
    else ctx.openImmediate({ id, term, matched, anchorEl: ref.current, source: 'click' })
  }

  const onMouseEnter = () => {
    if (!supportsHover) return
    ctx.scheduleHoverOpen({ id, term, matched, anchorEl: ref.current, source: 'hover' })
  }

  const onMouseLeave = () => {
    if (!supportsHover) return
    ctx.scheduleHoverClose()
  }

  const onFocus = () => {
    ctx.openImmediate({ id, term, matched, anchorEl: ref.current, source: 'focus' })
  }

  const onBlur = () => {
    if (ctx.state?.source === 'focus') ctx.close()
  }

  return (
    <span
      ref={ref}
      className="term-marker"
      tabIndex={0}
      role="button"
      aria-haspopup="true"
      aria-expanded={isOpen}
      aria-label={`${term.term} 설명`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {matched}
    </span>
  )
}
