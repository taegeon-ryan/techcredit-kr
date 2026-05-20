// 기술 행을 식별하는 안정 키 — 스크립트/런타임이 같은 함수를 mirror 한다.
// dataset(strategic|newgrowth) + sector_number + subsector 첫 글자 + item_no
export function subsectorCode(s) {
  const m = String(s || '').match(/^\s*([가-힣])\s*[.)]/)
  return m ? m[1] : ''
}

export function techId(dataset, row) {
  const sub = subsectorCode(row.subsector || '')
  return `${dataset}::${row.sector_number || ''}::${sub}::${row.item_no || ''}`
}
