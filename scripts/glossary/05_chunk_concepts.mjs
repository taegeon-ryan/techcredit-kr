#!/usr/bin/env node
// input/glossary/concepts.json (concept 단위)을 잘라 input/glossary/stage2_chunks/NN.json 으로 저장.
// 이미 LLM 응답이 채워진 stage2_batches/NN.json 이 있으면 해당 번호의 chunk 는 보존하고,
// 그 다음 concept 부터 다시 묶는다.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')
const candidatesPath = resolve(projectRoot, 'input/glossary/concepts.json')
const outDir = resolve(projectRoot, 'input/glossary/stage2_chunks')
const batchesDir = resolve(projectRoot, 'input/glossary/stage2_batches')
const CHUNK_SIZE = Number(process.env.GLOSSARY_CHUNK_SIZE || 80)

if (!existsSync(candidatesPath)) {
  console.error(`no concepts at ${candidatesPath}. run 04_aggregate_concepts.mjs first.`)
  process.exit(1)
}

const all = JSON.parse(readFileSync(candidatesPath, 'utf8'))
if (!Array.isArray(all) || !all.length) {
  console.error('candidates file is empty')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
mkdirSync(batchesDir, { recursive: true })

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isCompletedBatch(index) {
  const path = resolve(batchesDir, String(index).padStart(2, '0') + '.json')
  if (!existsSync(path)) return false
  try {
    const parsed = readJson(path)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

let lockedCount = 0
while (isCompletedBatch(lockedCount + 1)) lockedCount++

let consumed = 0
for (let i = 1; i <= lockedCount; i++) {
  const path = resolve(outDir, String(i).padStart(2, '0') + '.json')
  if (!existsSync(path)) {
    console.error(`completed batch ${i} exists, but matching chunk is missing: ${path}`)
    process.exit(1)
  }
  const chunk = readJson(path)
  if (!Array.isArray(chunk)) {
    console.error(`chunk is not an array: ${path}`)
    process.exit(1)
  }
  consumed += chunk.length
}

for (const f of readdirSync(outDir)) {
  if (!f.endsWith('.json')) continue
  const n = Number(f.replace(/\.json$/, ''))
  if (!Number.isFinite(n) || n > lockedCount) unlinkSync(resolve(outDir, f))
}

const remaining = all.slice(consumed)
const newChunks = Math.ceil(remaining.length / CHUNK_SIZE)
const totalChunks = lockedCount + newChunks
const pad = Math.max(2, String(totalChunks).length)

for (let i = 0; i < newChunks; i++) {
  const slice = remaining.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
  const name = String(lockedCount + i + 1).padStart(pad, '0') + '.json'
  writeFileSync(resolve(outDir, name), JSON.stringify(slice, null, 2) + '\n', 'utf8')
}

for (const f of readdirSync(batchesDir)) {
  if (!f.endsWith('.json')) continue
  const n = Number(f.replace(/\.json$/, ''))
  const path = resolve(batchesDir, f)
  if (!Number.isFinite(n) || n > totalChunks) {
    try {
      const parsed = readJson(path)
      if (Array.isArray(parsed) && parsed.length === 0) unlinkSync(path)
    } catch {
      // Leave malformed files in place for manual inspection.
    }
  }
}

console.log(`split ${all.length} concepts into ${totalChunks} chunks (${CHUNK_SIZE} each after ${lockedCount} completed batch files)`)
console.log(`-> ${outDir}/`)
