import Papa from 'papaparse'
import { crossTechKey, normalizeTechName } from './crossCategoryMap'

function normalizeSectorName(name) {
  if (!name) return ''
  return String(name)
    .replace(/[ㆍ‧·․∙•]/g, '·')
    .replace(/\s+/g, '')
    .trim()
}

function strategicSnapshot(row) {
  return {
    dataset: 'strategic',
    sector: row.strategic_sector?.trim(),
    subsector: '',
    first_apply: row.strategic_apply_date?.trim(),
    initial_name: row.strategic_tech_name?.trim(),
  }
}

function growthSnapshot(row) {
  return {
    dataset: 'growth',
    sector: row.newgrowth_sector?.trim(),
    subsector: row.newgrowth_subsector?.trim(),
    first_apply: row.newgrowth_apply_date?.trim(),
    initial_name: row.newgrowth_tech_name?.trim(),
  }
}

function relationHasSnapshot(snapshot) {
  return snapshot.dataset && snapshot.sector && snapshot.first_apply && snapshot.initial_name
}

export function parseManualRelationsCsv(text) {
  if (!text?.trim()) return []

  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    comments: '#',
    transformHeader: (header) => header.trim().replace(/^\uFEFF/, ''),
  })

  return result.data.filter((row) => relationHasSnapshot(strategicSnapshot(row)) && relationHasSnapshot(growthSnapshot(row)))
}

function historyKey(row) {
  return [
    row.sector_key,
    row.subsector || '',
    row.item_no || row.tech_name,
  ].join('::')
}

function rowSortValue(row) {
  return `${row.apply_date || ''}::${row.version || ''}`
}

function latestActive(rows) {
  return rows
    .filter((row) => row.status !== '삭제')
    .sort((a, b) => rowSortValue(b).localeCompare(rowSortValue(a)))
    .at(0) || null
}

function buildHistoryIndex(rows) {
  const chains = new Map()

  for (const row of rows) {
    const key = historyKey(row)
    if (!chains.has(key)) chains.set(key, [])
    chains.get(key).push(row)
  }

  return Array.from(chains.values()).map((chainRows) => {
    const allRows = chainRows.slice().sort((a, b) => rowSortValue(a).localeCompare(rowSortValue(b)))
    const firstRow = allRows[0]
    const currentRow = allRows.find((row) => row.current && row.status !== '삭제') || latestActive(allRows)

    return {
      firstRow,
      currentRow,
      allRows,
      sector: normalizeSectorName(firstRow.sector_name),
      subsector: normalizeSectorName(firstRow.subsector),
      initialName: normalizeTechName(firstRow.tech_name),
      firstApply: firstRow.first_apply_date || firstRow.apply_date || '',
    }
  })
}

function buildDataIndex(growthTechs, strategicTechs) {
  return {
    growth: buildHistoryIndex(growthTechs),
    strategic: buildHistoryIndex(strategicTechs),
  }
}

function matchesSnapshot(chain, snapshot) {
  return (
    chain.sector === normalizeSectorName(snapshot.sector)
    && chain.subsector === normalizeSectorName(snapshot.subsector)
    && chain.initialName === normalizeTechName(snapshot.initial_name)
  )
}

function matchesReissuedSnapshot(chain, snapshot) {
  const snapshotSubsector = normalizeSectorName(snapshot.subsector)
  return (
    chain.initialName === normalizeTechName(snapshot.initial_name)
    && (!snapshotSubsector || chain.subsector === snapshotSubsector)
  )
}

function latestCurrentRow(chains, snapshot) {
  return chains
    .filter((chain) => matchesReissuedSnapshot(chain, snapshot))
    .map((chain) => chain.currentRow)
    .filter((row) => row?.current && row.status !== '삭제')
    .sort((a, b) => rowSortValue(b).localeCompare(rowSortValue(a)))
    .at(0) || null
}

export function resolveSnapshot(snapshot, dataIndex) {
  const chains = dataIndex[snapshot.dataset]
  if (!chains) return null

  const candidates = chains.filter((chain) => matchesSnapshot(chain, snapshot))
  const exact = candidates.find((chain) => chain.firstApply === snapshot.first_apply)
  if (exact?.currentRow?.current) return exact.currentRow
  if (exact) return latestCurrentRow(chains, snapshot) || exact.currentRow

  return null
}

function emptyEntry(type) {
  return {
    exactMatches: [],
    manualMatches: [],
    similarMatches: [],
    promotedMatches: [],
    promoted: false,
    otherType: type === 'growth' ? 'strategic' : 'growth',
  }
}

function ensureEntry(map, type, row) {
  const key = crossTechKey(type, row)
  if (!map.has(key)) map.set(key, emptyEntry(type))
  return map.get(key)
}

function pushUniqueManual(entry, row, type) {
  const key = crossTechKey(type, row)
  if (entry.manualMatches.some((item) => item._crossKey === key)) return
  entry.manualMatches.push({ ...row, _crossKey: key, _type: type, _manual: true })
}

function warnStale(relation, side, snapshot) {
  console.warn(
    `[manual_relations] stale ${relation.id || '(no id)'} ${side} — `
      + `${snapshot.dataset} / ${snapshot.sector} / ${snapshot.subsector || ''} / `
      + `${snapshot.first_apply} / ${snapshot.initial_name}`
  )
}

export function buildManualMatches(relations, growthTechs, strategicTechs) {
  const matches = new Map()
  const dataIndex = buildDataIndex(growthTechs, strategicTechs)

  for (const relation of relations) {
    const sourceSnapshot = strategicSnapshot(relation)
    const targetSnapshot = growthSnapshot(relation)
    const source = resolveSnapshot(sourceSnapshot, dataIndex)
    const target = resolveSnapshot(targetSnapshot, dataIndex)

    if (!source) warnStale(relation, 'source', sourceSnapshot)
    if (!target) warnStale(relation, 'target', targetSnapshot)
    if (!source || !target) continue

    const sourceEntry = ensureEntry(matches, sourceSnapshot.dataset, source)
    const targetEntry = ensureEntry(matches, targetSnapshot.dataset, target)
    pushUniqueManual(sourceEntry, target, targetSnapshot.dataset)
    pushUniqueManual(targetEntry, source, sourceSnapshot.dataset)
  }

  return matches
}

function hasAutomaticMatch(entry, key) {
  return [
    ...(entry.exactMatches || []),
    ...(entry.similarMatches || []),
    ...(entry.promotedMatches || []),
  ].some((item) => item._crossKey === key)
}

function sortByName(a, b) {
  return (a.tech_name || '').localeCompare(b.tech_name || '', 'ko', { numeric: true })
}

export function mergeManualIntoCrossMatches(crossMatches, manualMatches) {
  for (const [key, manualEntry] of manualMatches) {
    if (!crossMatches.has(key)) {
      crossMatches.set(key, {
        ...emptyEntry(key.split('::')[0]),
        promoted: manualEntry.promoted || false,
      })
    }

    const entry = crossMatches.get(key)
    if (!entry.manualMatches) entry.manualMatches = []

    for (const item of manualEntry.manualMatches || []) {
      if (hasAutomaticMatch(entry, item._crossKey)) continue
      if (entry.manualMatches.some((existing) => existing._crossKey === item._crossKey)) continue
      entry.manualMatches.push(item)
    }

    entry.manualMatches.sort(sortByName)
  }

  return crossMatches
}
