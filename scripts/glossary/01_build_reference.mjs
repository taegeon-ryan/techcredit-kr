#!/usr/bin/env node
// 전략·신성장 기술 CSV에서 current=True 이고 삭제되지 않은 현행 기술만 골라
//   input/glossary/stage1_reference.csv 를 생성한다.
// 이 파일은 02_split_reference_chunks.mjs 의 입력이자 Stage 1 LLM 참조용.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv, writeCsv } from './_csv.mjs'
import { techId } from './_tech_id.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')
const outputDir = resolve(projectRoot, 'output')
const glossaryDir = resolve(projectRoot, 'input/glossary')
const refPath = resolve(glossaryDir, 'stage1_reference.csv')

const SOURCES = [
  { dataset: 'strategic', file: 'strategic_tech.csv' },
  { dataset: 'newgrowth', file: 'newgrowth_tech.csv' },
]

const HEADER = ['tech_id', 'dataset', 'sector_name', 'subsector', 'item_no', 'tech_name', 'status', 'apply_date', 'tech_description']

function build() {
  const rows = []
  for (const { dataset, file } of SOURCES) {
    const path = resolve(outputDir, file)
    if (!existsSync(path)) {
      console.warn(`[skip] missing: ${path}`)
      continue
    }
    const { rows: parsed } = parseCsv(readFileSync(path, 'utf8'))
    for (const r of parsed) {
      if (r.current !== 'True' || r.status === '삭제') continue
      rows.push({
        tech_id: techId(dataset, r),
        dataset,
        sector_name: r.sector_name || '',
        subsector: r.subsector || '',
        item_no: r.item_no || '',
        tech_name: r.tech_name || '',
        status: r.status || '',
        apply_date: r.apply_date || '',
        tech_description: r.tech_description || '',
      })
    }
  }

  rows.sort((a, b) => a.dataset.localeCompare(b.dataset)
    || a.sector_name.localeCompare(b.sector_name)
    || (a.subsector || '').localeCompare(b.subsector || '')
    || a.item_no.localeCompare(b.item_no))

  writeFileSync(refPath, writeCsv(HEADER, rows), 'utf8')
  console.log(`reference: ${rows.length} techs -> ${refPath}`)
}

build()
