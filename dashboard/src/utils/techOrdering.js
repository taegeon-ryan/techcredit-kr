export const AGE_FILTERS = [
  { value: 'all', label: '전체', minMonths: 0 },
  { value: '3y', label: '3년 이상', minMonths: 36 },
  { value: '5y', label: '5년 이상', minMonths: 60 },
]

export const SORT_OPTIONS = [
  { value: 'statute', label: '별표 순' },
  { value: 'introduced', label: '도입일 순' },
  { value: 'name', label: '가나다 순' },
]

export function compareStatuteOrder(a, b) {
  const sectorDiff = (parseInt(a.sector_number, 10) || 999) - (parseInt(b.sector_number, 10) || 999)
  if (sectorDiff !== 0) return sectorDiff

  const subsectorDiff = (a.subsector || '').localeCompare(b.subsector || '', 'ko', { numeric: true })
  if (subsectorDiff !== 0) return subsectorDiff

  const itemDiff = (a.item_no || '').localeCompare(b.item_no || '', 'ko', { numeric: true })
  if (itemDiff !== 0) return itemDiff

  return (parseInt(a.index, 10) || 0) - (parseInt(b.index, 10) || 0)
}

export function compareTechs(sortBy) {
  return (a, b) => {
    if (sortBy === 'name') {
      const nameDiff = a.tech_name.localeCompare(b.tech_name, 'ko', { numeric: true })
      return nameDiff || compareStatuteOrder(a, b)
    }

    if (sortBy === 'introduced') {
      const dateDiff = (a.first_apply_date || '').localeCompare(b.first_apply_date || '')
      return dateDiff || compareStatuteOrder(a, b)
    }

    return compareStatuteOrder(a, b)
  }
}

export function techRowKey(row) {
  return `${row.index ?? ''}::${row.item_no ?? ''}::${row.tech_name ?? ''}`
}

export function getOrderedTechs(rows, sector, controls) {
  const { ageFilter = 'all', includeDeleted = false, sortBy = 'statute' } = controls || {}
  const targetSectorKey = sector.key.split('::')[1]
  const selectedAge = AGE_FILTERS.find((f) => f.value === ageFilter)
  const minMonths = selectedAge?.minMonths || 0

  return rows
    .filter((r) => r.current && r.sector_key === targetSectorKey)
    .filter((r) => !r.renumbered_deletion)
    .filter((r) => minMonths === 0 || r.introduced_elapsed_months >= minMonths)
    .filter((r) => includeDeleted || r.status !== '삭제')
    .sort(compareTechs(sortBy))
}
