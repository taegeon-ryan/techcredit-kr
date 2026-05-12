#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const batchesDir = resolve(projectRoot, 'input/glossary_batches')
const sourcePath = resolve(projectRoot, 'input/glossary_source.json')

// 각 배치 파일은 JSON 배열: [{ term, aliases?, short, related?, domain? }, ...]
// term이 중복되면 마지막에 읽힌 배치값을 우선하고, 기존 값과 충돌 시 stderr로 보고.

function readJsonArray(path) {
  const text = readFileSync(path, 'utf8').trim()
  // 모델이 JSON 외 코드펜스를 포함했을 때를 대비해 첫 [ ... 마지막 ]만 추출
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`no JSON array in ${path}`)
  }
  return JSON.parse(text.slice(start, end + 1))
}

function normalizeKey(term) {
  return /^[A-Za-z]/.test(term) ? term.toUpperCase() : term
}

function merge() {
  if (!existsSync(batchesDir)) {
    console.error(`no batches dir: ${batchesDir}`)
    process.exit(1)
  }
  const files = readdirSync(batchesDir)
    .filter(name => name.endsWith('.json'))
    .sort()
  if (!files.length) {
    console.error(`no .json files in ${batchesDir}`)
    process.exit(1)
  }

  // 기존 source가 있으면 베이스로 사용
  const byKey = new Map()
  if (existsSync(sourcePath)) {
    const existing = readJsonArray(sourcePath)
    for (const entry of existing) {
      if (!entry.term) continue
      byKey.set(normalizeKey(entry.term), entry)
    }
    console.error(`base: ${existing.length} entries from existing source`)
  }

  let added = 0, updated = 0, skipped = 0
  for (const file of files) {
    const path = resolve(batchesDir, file)
    let entries
    try { entries = readJsonArray(path) } catch (e) {
      console.error(`[error] ${file}: ${e.message}`)
      continue
    }
    for (const entry of entries) {
      if (!entry || !entry.term) { skipped++; continue }
      if (entry.short == null) { skipped++; continue } // 모델이 "모름"으로 표시
      const key = normalizeKey(entry.term)
      const prev = byKey.get(key)
      const next = {
        term: entry.term,
        aliases: dedupArr(entry.aliases),
        short: String(entry.short).trim(),
        ...(entry.related?.length ? { related: dedupArr(entry.related) } : {}),
        ...(entry.domain ? { domain: String(entry.domain).trim() } : {}),
      }
      if (!prev) {
        byKey.set(key, next)
        added++
      } else if (prev.short !== next.short) {
        console.error(`[conflict] ${entry.term}: keeping new`)
        console.error(`  existing: ${prev.short}`)
        console.error(`  incoming: ${next.short}`)
        byKey.set(key, next)
        updated++
      }
    }
  }

  const all = [...byKey.values()].sort((a, b) => a.term.localeCompare(b.term))
  writeFileSync(sourcePath, JSON.stringify(all, null, 2) + '\n', 'utf8')
  console.error(`merged ${files.length} batches: +${added} added, ${updated} updated, ${skipped} skipped, total ${all.length}`)
  console.error(`-> ${sourcePath}`)
}

function dedupArr(value) {
  if (!Array.isArray(value)) return undefined
  const out = []
  for (const v of value) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out.length ? out : undefined
}

merge()
