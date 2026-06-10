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

// 소분류 정렬은 전체 이름이 아닌 가나다 prefix 글자만 사용한다.
// (소분류명이 개정으로 바뀐 경우, 옛 이름을 단 항목이 형제와 갈라져
//  엉뚱한 위치로 밀리는 것을 방지 — 같은 prefix는 item_no 순으로 묶임)
function subsectorPrefix(s) {
  const m = (s || '').match(/^([가-힣])\./)
  return m ? m[1] : (s || '')
}

// 한글 열거기호 순서: 가 나 다 … 하 거 너 더 … (자음 14 × 모음 라운드 ㅏㅓㅗㅜㅡㅣ)
const CHO_ORDER = { 0: 0, 2: 1, 3: 2, 5: 3, 6: 4, 7: 5, 9: 6, 11: 7, 12: 8, 14: 9, 15: 10, 16: 11, 17: 12, 18: 13 }
const JUNG_ORDER = { 0: 0, 4: 1, 8: 2, 13: 3, 18: 4, 20: 5 }
function korMarkerOrder(ch) {
  if (!ch) return 9999
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return 9000 + ch.charCodeAt(0)
  const cho = Math.floor(code / 588)
  const jung = Math.floor((code % 588) / 28)
  const jong = code % 28
  if (jong !== 0 || !(cho in CHO_ORDER) || !(jung in JUNG_ORDER)) return 9000 + ch.charCodeAt(0)
  return JUNG_ORDER[jung] * 14 + CHO_ORDER[cho]
}

// item_no 정렬 키: 숫자 항목(1) 2)…) < 한글 항목(가. 나. …하. 거.…) < 기타
function itemSortKey(itemNo) {
  const s = (itemNo || '').trim()
  const num = s.match(/^(\d+)\)/)
  if (num) return [0, parseInt(num[1], 10), 0]
  const kor = s.match(/^([가-힣])/)
  if (kor) return [1, 0, korMarkerOrder(kor[1])]
  return [2, 0, 0]
}

function cmpArr(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

export function compareStatuteOrder(a, b) {
  const sectorDiff = (parseInt(a.sector_number, 10) || 999) - (parseInt(b.sector_number, 10) || 999)
  if (sectorDiff !== 0) return sectorDiff

  const subDiff = korMarkerOrder(subsectorPrefix(a.subsector)) - korMarkerOrder(subsectorPrefix(b.subsector))
  if (subDiff !== 0) return subDiff

  const itemDiff = cmpArr(itemSortKey(a.item_no), itemSortKey(b.item_no))
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
