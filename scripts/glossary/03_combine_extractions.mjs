#!/usr/bin/env node
// input/glossary/stage1_extractions/*.json 응답들을 합쳐 input/glossary/workbook.csv 한 파일로 저장.
//   - 같은 tech_id 가 여러 파일에 나뉘어 있으면 surfaces 를 합칩니다.
//   - 같은 (tech_id, surface) 가 중복되면 한 행으로 통합.
//   - 출력 컬럼: tech_id, dataset, sector_name, tech_name, surface, domain_hint, keep, note
//     · keep 기본값 True — 사용자는 검수하며 불필요한 행만 False 로 바꾸거나 삭제하면 됨
//     · note 는 사용자 메모용
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv, writeCsv } from './_csv.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')
const extractionDir = resolve(projectRoot, 'input/glossary/stage1_extractions')
const refPath = resolve(projectRoot, 'input/glossary/stage1_reference.csv')
const outPath = resolve(projectRoot, 'input/glossary/workbook.csv')

const HEADER = ['tech_id', 'dataset', 'sector_name', 'tech_name', 'surface', 'domain_hint', 'keep', 'note']
const KEY_SEP = '\u001f'

function readJsonArray(path) {
  const text = readFileSync(path, 'utf8').trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`no JSON array in ${path}`)
  }
  return JSON.parse(text.slice(start, end + 1))
}

function combine() {
  if (!existsSync(extractionDir)) {
    console.error(`no extraction dir: ${extractionDir}`)
    process.exit(1)
  }
  if (!existsSync(refPath)) {
    console.error(`no reference at ${refPath}`)
    process.exit(1)
  }
  const refRows = parseCsv(readFileSync(refPath, 'utf8')).rows
  const refByTechId = new Map(refRows.map(r => [r.tech_id, r]))
  const existingByKey = new Map()
  if (existsSync(outPath)) {
    for (const row of parseCsv(readFileSync(outPath, 'utf8')).rows) {
      if (!row.tech_id || !row.surface) continue
      existingByKey.set(`${row.tech_id}${KEY_SEP}${row.surface}`, row)
    }
  }

  const files = readdirSync(extractionDir).filter(f => f.endsWith('.json')).sort()
  if (!files.length) {
    console.error(`no .json files in ${extractionDir}`)
    process.exit(1)
  }

  // (tech_id, surface) -> row
  const byKey = new Map()
  let unknownTech = 0
  for (const file of files) {
    let entries
    try { entries = readJsonArray(resolve(extractionDir, file)) } catch (e) {
      console.error(`[error] ${file}: ${e.message}`)
      continue
    }
    for (const entry of entries) {
      if (!entry || !entry.tech_id || !Array.isArray(entry.surfaces)) continue
      const ref = refByTechId.get(entry.tech_id)
      if (!ref) { unknownTech++; continue }
      for (const s of entry.surfaces) {
        const surface = (s?.surface || '').trim()
        if (!surface) continue
        const domain_hint = (s?.domain_hint || '').trim()
        const key = `${entry.tech_id}${KEY_SEP}${surface}`
        if (byKey.has(key)) continue
        const existing = existingByKey.get(key)
        byKey.set(key, {
          tech_id: entry.tech_id,
          dataset: ref.dataset,
          sector_name: ref.sector_name,
          tech_name: ref.tech_name,
          surface,
          domain_hint: existing?.domain_hint || domain_hint,
          keep: existing?.keep || 'True',
          note: existing?.note || '',
        })
      }
    }
  }

  const rows = [...byKey.values()].sort((a, b) =>
    a.dataset.localeCompare(b.dataset)
    || a.sector_name.localeCompare(b.sector_name)
    || a.tech_id.localeCompare(b.tech_id)
    || a.surface.localeCompare(b.surface)
  )

  writeFileSync(outPath, writeCsv(HEADER, rows), 'utf8')
  console.log(`combined ${files.length} extraction files: ${rows.length} (tech, surface) rows`)
  if (unknownTech) console.warn(`[warn] ${unknownTech} surfaces skipped (tech_id not in reference)`)
  console.log(`-> ${outPath}`)
}

combine()
