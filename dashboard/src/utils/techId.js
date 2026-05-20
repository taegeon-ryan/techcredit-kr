// scripts/_tech_id.mjs 의 mirror — 빌드 산출물(term_spans.json) 의 tech_id 키를
// 런타임 tech 객체에서 동일한 규칙으로 재구성한다.
export function subsectorCode(s) {
  const m = String(s || '').match(/^\s*([가-힣])\s*[.)]/)
  return m ? m[1] : ''
}

export function techId(dataset, row) {
  const sub = subsectorCode(row?.subsector || '')
  return `${dataset}::${row?.sector_number || ''}::${sub}::${row?.item_no || ''}`
}

// sector_key 가 'strategic:…' / 'growth:…' 형식이므로 dataset 으로 정규화
export function datasetFromSectorType(type) {
  return type === 'growth' ? 'newgrowth' : 'strategic'
}
