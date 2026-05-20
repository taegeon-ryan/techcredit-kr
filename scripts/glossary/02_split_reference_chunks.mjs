#!/usr/bin/env node
// input/glossary/stage1_reference.csv 를 sector_name 정규화 기준으로 분할.
// 중점(ㆍ U+318D, · U+00B7, ․ U+2024) 변형은 같은 분야로 묶고, dataset 도 함께 키로 사용.
// 출력: input/glossary/stage1_reference_chunks/NN_<dataset>_<sector_slug>.csv
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv, writeCsv } from './_csv.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')
const refPath = resolve(projectRoot, 'input/glossary/stage1_reference.csv')
const outDir = resolve(projectRoot, 'input/glossary/stage1_reference_chunks')

// 중점/공백 정규화 — 분야 표기 통합용
function canonicalSector(s) {
  return String(s || '').replace(/[ㆍ․]/g, '·').replace(/\s+/g, ' ').trim()
}

function sectorSlug(s) {
  return canonicalSector(s).replace(/[\\/]/g, '').replace(/\s+/g, '_').replace(/[():,]/g, '')
}

if (!existsSync(refPath)) {
  console.error(`no reference at ${refPath}. run 01_build_reference.mjs first.`)
  process.exit(1)
}

const { rows: all } = parseCsv(readFileSync(refPath, 'utf8'))
if (!all.length) {
  console.error('reference is empty')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.csv')) unlinkSync(resolve(outDir, f))
}

const groups = new Map()
for (const r of all) {
  const key = `${r.dataset}::${canonicalSector(r.sector_name)}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}

const HEADER = ['tech_id', 'dataset', 'sector_name', 'subsector', 'item_no', 'tech_name', 'tech_description']
const sortedKeys = [...groups.keys()].sort()
const pad = String(sortedKeys.length).length

let idx = 0
for (const key of sortedKeys) {
  idx++
  const rows = groups.get(key).map(r => ({
    tech_id: r.tech_id,
    dataset: r.dataset,
    sector_name: r.sector_name,
    subsector: r.subsector || '',
    item_no: r.item_no,
    tech_name: r.tech_name,
    tech_description: r.tech_description,
  }))
  const [dataset, sector] = key.split('::')
  const name = `${String(idx).padStart(pad, '0')}_${dataset}_${sectorSlug(sector)}.csv`
  writeFileSync(resolve(outDir, name), writeCsv(HEADER, rows), 'utf8')
  console.log(`  ${name}  (${rows.length} techs)`)
}

console.log(`\nsplit ${all.length} techs into ${sortedKeys.length} sector files -> ${outDir}/`)
