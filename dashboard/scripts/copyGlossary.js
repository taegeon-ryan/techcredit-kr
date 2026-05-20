// 빌드 산출물 생성기 (predev/prebuild 단계).
//   - input/glossary/glossary.csv : LLM 이 채운 concept-level 설명
//   - input/glossary/workbook.csv : 사용자가 검수한 (tech_id, surface) 행
//   - input/glossary/concepts.json: aggregate_concepts.mjs 가 만든 클러스터 — surface ↔ concept_id 매핑
//   →
//   - dashboard/public/data/glossary.json   : [{concept_id, en_abbrev, en_full, korean, domain, short, related}]
//   - dashboard/public/data/term_spans.json : { [tech_id]: [{surface, concept_id}, ...] }
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const dashboardDir = resolve(scriptDir, '..')
const projectRoot = resolve(dashboardDir, '..')
const dataDir = resolve(dashboardDir, 'public/data')
const glossaryCsvPath = resolve(projectRoot, 'input/glossary/glossary.csv')
const workbookPath = resolve(projectRoot, 'input/glossary/workbook.csv')
const candidatesPath = resolve(projectRoot, 'input/glossary/concepts.json')
const glossaryOut = resolve(dataDir, 'glossary.json')
const spansOut = resolve(dataDir, 'term_spans.json')
const LIST_DELIM = ';'

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else { field += ch }
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { row.push(field); field = '' }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (ch === '\r') { /* skip */ }
      else field += ch
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  if (!rows.length) return []
  const header = rows.shift()
  return rows
    .filter(r => r.some(x => x && x.length > 0))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

function splitList(s) {
  if (!s) return []
  return s.split(LIST_DELIM).map(x => x.trim()).filter(Boolean)
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

mkdirSync(dataDir, { recursive: true })

// 1) glossary.json
let glossaryEntries = []
if (existsSync(glossaryCsvPath)) {
  const rows = parseCsv(readFileSync(glossaryCsvPath, 'utf8'))
  for (const r of rows) {
    if (!r.concept_id || !r.short) continue
    const entry = {
      concept_id: r.concept_id.trim(),
      en_abbrev: (r.en_abbrev || '').trim(),
      en_full: (r.en_full || '').trim(),
      korean: (r.korean || '').trim(),
      domain: (r.domain || '').trim(),
      short: r.short.trim(),
    }
    const related = splitList(r.related)
    if (related.length) entry.related = related
    glossaryEntries.push(entry)
  }
}
writeJson(glossaryOut, glossaryEntries)
console.log(`glossary.json: ${glossaryEntries.length} concepts -> ${glossaryOut}`)

// 2) term_spans.json — 검수된 workbook 의 (tech_id, surface) 를 concept_id 로 매핑
let spans = {}
const validConceptIds = new Set(glossaryEntries.map(e => e.concept_id))
let mappedSurfaces = 0
let droppedNoConcept = 0
if (existsSync(workbookPath) && existsSync(candidatesPath)) {
  const workbookRows = parseCsv(readFileSync(workbookPath, 'utf8'))
    .filter(r => r.surface && (r.keep || 'True').trim().toLowerCase() !== 'false')

  const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'))
  // surface → concept_id 사전: candidates 의 surfaces 목록을 펼침
  // 같은 surface 가 여러 concept 에 속할 수 있으므로 domain 까지 키로 사용
  const surfaceToConcept = new Map()
  for (const c of candidates) {
    if (!validConceptIds.has(c.concept_id)) continue
    for (const s of c.surfaces || []) {
      const key = `${(c.domain || '').trim()}::${s}`
      // 첫 매핑 우선 (충돌 시 무시)
      if (!surfaceToConcept.has(key)) surfaceToConcept.set(key, c.concept_id)
    }
  }

  for (const row of workbookRows) {
    const key = `${(row.domain_hint || '').trim()}::${row.surface}`
    const concept_id = surfaceToConcept.get(key)
    if (!concept_id) { droppedNoConcept++; continue }
    if (!spans[row.tech_id]) spans[row.tech_id] = []
    // 동일 (tech_id, surface) 중복 방지
    if (spans[row.tech_id].some(x => x.surface === row.surface)) continue
    spans[row.tech_id].push({ surface: row.surface, concept_id })
    mappedSurfaces++
  }
}
writeJson(spansOut, spans)
console.log(`term_spans.json: ${mappedSurfaces} surfaces across ${Object.keys(spans).length} techs -> ${spansOut}`)
if (droppedNoConcept) console.warn(`[warn] ${droppedNoConcept} workbook rows had no matching concept (glossary not generated yet?)`)
