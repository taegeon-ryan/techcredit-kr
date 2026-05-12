import { useState, useEffect } from 'react'
import Papa from 'papaparse'
import { buildCrossMatches } from '../utils/crossCategoryMap'
import {
  buildManualMatches,
  mergeManualIntoCrossMatches,
  parseManualRelationsCsv,
} from '../utils/manualRelations'

const FILES = {
  growth_tech: '/data/newgrowth_tech.csv',
  growth_facility: '/data/newgrowth_facility.csv',
  strategic_tech: '/data/strategic_tech.csv',
  strategic_facility: '/data/strategic_facility.csv',
}

const MANUAL_RELATIONS_FILE = '/data/manual_relations.csv'

function computeElapsedMonths(applyDate) {
  if (!applyDate) return null
  const d = new Date(applyDate)
  const now = new Date()
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
}

export function historyKey(row) {
  return [
    row.sector_key,
    row.subsector || '',
    row.item_no || row.tech_name,
  ].join('::')
}

function renumberKey(row) {
  return [
    row.sector_key,
    row.subsector || '',
    row.tech_name,
  ].join('::')
}

function enrichTechHistory(rows) {
  const firstActiveDate = new Map()
  const firstAnyDate = new Map()
  const activeCurrentKeys = new Set()
  const currentDeletedByRenumberKey = new Map()
  const duplicateCurrentDeletedRows = new Set()

  for (const row of rows) {
    if (row.current && row.status !== '삭제') {
      activeCurrentKeys.add(renumberKey(row))
    } else if (row.current && row.status === '삭제') {
      const key = renumberKey(row)
      if (!currentDeletedByRenumberKey.has(key)) {
        currentDeletedByRenumberKey.set(key, [])
      }
      currentDeletedByRenumberKey.get(key).push(row)
    }
  }

  for (const deletedRows of currentDeletedByRenumberKey.values()) {
    if (deletedRows.length <= 1) continue
    deletedRows
      .sort((a, b) => {
        const dateDiff = String(a.apply_date || '').localeCompare(String(b.apply_date || ''))
        if (dateDiff !== 0) return dateDiff
        return String(a.version || '').localeCompare(String(b.version || ''))
      })
      .slice(0, -1)
      .forEach((row) => duplicateCurrentDeletedRows.add(row))
  }

  for (const row of rows) {
    if (!row.apply_date) continue
    const key = historyKey(row)

    if (!firstAnyDate.has(key) || row.apply_date < firstAnyDate.get(key)) {
      firstAnyDate.set(key, row.apply_date)
    }

    if (row.status !== '삭제' && (!firstActiveDate.has(key) || row.apply_date < firstActiveDate.get(key))) {
      firstActiveDate.set(key, row.apply_date)
    }
  }

  return rows.map((row) => {
    const firstApplyDate = firstActiveDate.get(historyKey(row)) || firstAnyDate.get(historyKey(row)) || ''
    return {
      ...row,
      renumbered_deletion: (
        row.current
        && row.status === '삭제'
        && (activeCurrentKeys.has(renumberKey(row)) || duplicateCurrentDeletedRows.has(row))
      ),
      first_apply_date: firstApplyDate,
      first_year: firstApplyDate ? firstApplyDate.slice(0, 4) : '',
      introduced_elapsed_months: computeElapsedMonths(firstApplyDate),
    }
  })
}

function normalize(row) {
  const ad = row.apply_date ? String(row.apply_date) : ''
  return {
    ...row,
    current: row.current === 'True',
    apply_date: ad,
    elapsed_months: computeElapsedMonths(ad),
    year: ad ? ad.slice(0, 4) : '',
    sector_key: normalizeSector(row.sector_name),
  }
}

export function normalizeSector(name) {
  if (!name) return ''
  return name
    .replace(/[ㆍ‧·․∙•]/g, '·')
    .replace(/\s+/g, '')
    .trim()
}

function loadCsv(url) {
  return new Promise((resolve) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (r) => resolve(r.data.map(normalize)),
    })
  })
}

function loadOptionalText(url) {
  return fetch(url)
    .then((response) => (response.ok ? response.text() : ''))
    .catch(() => '')
}

export function useAllData() {
  const [data, setData] = useState(null)

  useEffect(() => {
    Promise.all([
      ...Object.values(FILES).map(loadCsv),
      loadOptionalText(MANUAL_RELATIONS_FILE),
    ]).then(([gt, gf, st, sf, manualRelationsText]) => {
      const growthTech = enrichTechHistory(gt)
      const strategicTech = enrichTechHistory(st)
      const crossMatches = buildCrossMatches(growthTech, strategicTech)
      const manualRelations = parseManualRelationsCsv(manualRelationsText)
      mergeManualIntoCrossMatches(
        crossMatches,
        buildManualMatches(manualRelations, growthTech, strategicTech)
      )
      setData({
        growth_tech: growthTech,
        growth_facility: gf,
        strategic_tech: strategicTech,
        strategic_facility: sf,
        crossMatches,
      })
    })
  }, [])

  return { data, loading: !data }
}
