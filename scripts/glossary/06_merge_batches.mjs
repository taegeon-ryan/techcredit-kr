#!/usr/bin/env node
// input/glossary/stage2_batches/NN.json 응답들을 합쳐 input/glossary/glossary.csv 한 파일로 저장.
// CSV 컬럼: concept_id, en_abbrev, en_full, korean, domain, short, related
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeCsv } from './_csv.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')
const batchesDir = resolve(projectRoot, 'input/glossary/stage2_batches')
const conceptsPath = resolve(projectRoot, 'input/glossary/concepts.json')
const outPath = resolve(projectRoot, 'input/glossary/glossary.csv')

const HEADER = ['concept_id', 'en_abbrev', 'en_full', 'korean', 'domain', 'short', 'related']
const LIST_DELIM = ';'

function readJsonArray(path) {
  const text = readFileSync(path, 'utf8').trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) throw new Error(`no JSON array in ${path}`)
  return JSON.parse(text.slice(start, end + 1))
}

function dedupList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const v of value) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

function merge() {
  if (!existsSync(batchesDir)) {
    console.error(`no batches dir: ${batchesDir}`)
    process.exit(1)
  }
  const conceptDomainById = new Map()
  if (existsSync(conceptsPath)) {
    const concepts = JSON.parse(readFileSync(conceptsPath, 'utf8'))
    for (const c of concepts) {
      if (c?.concept_id) conceptDomainById.set(c.concept_id, c.domain || '')
    }
  }
  const files = readdirSync(batchesDir).filter(n => n.endsWith('.json')).sort()
  if (!files.length) {
    console.error(`no .json files in ${batchesDir}`)
    process.exit(1)
  }

  const byKey = new Map()
  let added = 0, updated = 0, skipped = 0
  for (const file of files) {
    let entries
    try { entries = readJsonArray(resolve(batchesDir, file)) } catch (e) {
      console.error(`[error] ${file}: ${e.message}`); continue
    }
    for (const entry of entries) {
      if (!entry || !entry.concept_id) { skipped++; continue }
      if (entry.short == null) { skipped++; continue }
      const key = entry.concept_id
      const next = {
        concept_id: String(entry.concept_id).trim(),
        en_abbrev: (entry.en_abbrev || '').trim(),
        en_full: (entry.en_full || '').trim(),
        korean: (entry.korean || '').trim(),
        domain: (conceptDomainById.get(String(entry.concept_id).trim()) || entry.domain || '').trim(),
        short: String(entry.short).trim(),
        related: dedupList(entry.related),
      }
      const prev = byKey.get(key)
      if (!prev) { byKey.set(key, next); added++ }
      else if (prev.short !== next.short) {
        console.error(`[conflict] ${entry.concept_id}: keeping new`)
        console.error(`  existing: ${prev.short}`)
        console.error(`  incoming: ${next.short}`)
        byKey.set(key, next); updated++
      }
    }
  }

  const rows = [...byKey.values()]
    .sort((a, b) => a.concept_id.localeCompare(b.concept_id))
    .map(e => ({
      concept_id: e.concept_id,
      en_abbrev: e.en_abbrev,
      en_full: e.en_full,
      korean: e.korean,
      domain: e.domain,
      short: e.short,
      related: e.related.join(LIST_DELIM),
    }))

  writeFileSync(outPath, writeCsv(HEADER, rows), 'utf8')
  console.error(`merged ${files.length} batches: +${added} added, ${updated} updated, ${skipped} skipped, total ${rows.length}`)
  console.error(`-> ${outPath}`)
}

merge()
