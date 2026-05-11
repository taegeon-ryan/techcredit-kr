import { useEffect, useLayoutEffect, useRef } from 'react'
import { historyKey } from './useAllData'

const APP_NAV_MARKER = '__appNav'
const SEARCH_REPLACE_DELAY = 150

export function computeScreenKey(state) {
  const techKey = state.selectedTech ? historyKey(state.selectedTech) : ''
  const searchMode = state.search?.trim() ? 'searching' : 'browsing'

  return [
    state.view,
    state.filter,
    state.selectedSector?.key || '',
    techKey,
    searchMode,
  ].join('|')
}

function snapshotForState(state, scrollY = 0) {
  return {
    view: state.view,
    filter: state.filter,
    selectedSector: state.selectedSector ? { ...state.selectedSector } : null,
    selectedTech: state.selectedTech ? { ...state.selectedTech } : null,
    techListControls: { ...state.techListControls },
    search: state.search || '',
    scrollY: Math.max(0, Math.round(scrollY || 0)),
  }
}

function appHistoryState(snapshot) {
  return {
    [APP_NAV_MARKER]: true,
    screenKey: computeScreenKey(snapshot),
    snapshot,
  }
}

function isAppHistoryState(state) {
  return Boolean(state?.[APP_NAV_MARKER] && state.snapshot)
}

function replaceCurrentEntry(snapshot) {
  window.history.replaceState(appHistoryState(snapshot), '')
}

function pushEntry(snapshot) {
  window.history.pushState(appHistoryState(snapshot), '')
}

export function useNavigationHistory({ state, applySnapshot }) {
  const initializedRef = useRef(false)
  const previousScreenKeyRef = useRef(null)
  const previousSnapshotRef = useRef(null)
  const suppressPushForScreenKeyRef = useRef(null)
  const pendingScrollYRef = useRef(null)
  const searchDebounceRef = useRef(null)
  const stateRef = useRef(state)
  const applySnapshotRef = useRef(applySnapshot)

  useLayoutEffect(() => {
    stateRef.current = state
    applySnapshotRef.current = applySnapshot
  })

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const restoreSnapshot = (snapshot) => {
      const screenKey = computeScreenKey(snapshot)
      suppressPushForScreenKeyRef.current = screenKey
      pendingScrollYRef.current = snapshot.scrollY || 0
      applySnapshotRef.current(snapshot)
      requestAnimationFrame(() => {
        window.scrollTo({ top: snapshot.scrollY || 0, behavior: 'auto' })
      })
    }

    const handlePopState = (event) => {
      if (isAppHistoryState(event.state)) {
        restoreSnapshot(event.state.snapshot)
      }
    }

    const handlePageShow = (event) => {
      if (event.persisted && isAppHistoryState(window.history.state)) {
        restoreSnapshot(window.history.state.snapshot)
      }
    }

    window.addEventListener('popstate', handlePopState)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])

  useLayoutEffect(() => {
    const screenKey = computeScreenKey(state)

    if (!initializedRef.current) {
      initializedRef.current = true

      if (isAppHistoryState(window.history.state)) {
        const { snapshot } = window.history.state
        previousScreenKeyRef.current = computeScreenKey(snapshot)
        previousSnapshotRef.current = snapshot
        suppressPushForScreenKeyRef.current = previousScreenKeyRef.current
        pendingScrollYRef.current = snapshot.scrollY || 0
        applySnapshotRef.current(snapshot)
        requestAnimationFrame(() => {
          window.scrollTo({ top: snapshot.scrollY || 0, behavior: 'auto' })
        })
        return
      }

      const initialSnapshot = snapshotForState(state, window.scrollY)
      replaceCurrentEntry(initialSnapshot)
      previousScreenKeyRef.current = screenKey
      previousSnapshotRef.current = initialSnapshot
      return
    }

    if (suppressPushForScreenKeyRef.current) {
      if (suppressPushForScreenKeyRef.current === screenKey) {
        const restoredScrollY = pendingScrollYRef.current ?? window.scrollY
        previousScreenKeyRef.current = screenKey
        previousSnapshotRef.current = snapshotForState(state, restoredScrollY)
        suppressPushForScreenKeyRef.current = null
        pendingScrollYRef.current = null
        return
      }

      suppressPushForScreenKeyRef.current = null
      pendingScrollYRef.current = null
    }

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
      searchDebounceRef.current = null
    }

    if (previousScreenKeyRef.current !== screenKey) {
      const previousSnapshot = previousSnapshotRef.current
      if (previousSnapshot) {
        replaceCurrentEntry({
          ...previousSnapshot,
          scrollY: Math.max(0, Math.round(window.scrollY || 0)),
        })
      }

      const nextSnapshot = snapshotForState(state, 0)
      pushEntry(nextSnapshot)
      previousScreenKeyRef.current = screenKey
      previousSnapshotRef.current = nextSnapshot
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'auto' })
      })
      return
    }

    const nextSnapshot = snapshotForState(state, window.scrollY)
    const searchChanged = previousSnapshotRef.current?.search !== nextSnapshot.search

    if (searchChanged) {
      previousScreenKeyRef.current = screenKey
      previousSnapshotRef.current = nextSnapshot
      searchDebounceRef.current = setTimeout(() => {
        const debouncedSnapshot = snapshotForState(stateRef.current, window.scrollY)
        replaceCurrentEntry(debouncedSnapshot)
        previousScreenKeyRef.current = computeScreenKey(debouncedSnapshot)
        previousSnapshotRef.current = debouncedSnapshot
      }, SEARCH_REPLACE_DELAY)
      return
    }

    replaceCurrentEntry(nextSnapshot)
    previousScreenKeyRef.current = screenKey
    previousSnapshotRef.current = nextSnapshot
  }, [state])
}
