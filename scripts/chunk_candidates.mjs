#!/usr/bin/env node
// glossary_candidates.json 을 20개씩 잘라 input/candidate_chunks/01.json … 으로 저장한다.
// 운영자가 각 chunk 파일을 그대로 LLM에 붙여넣어 배치를 돌리면 된다.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const candidatesPath = resolve(projectRoot, 'input/glossary_candidates.json')
const outDir = resolve(projectRoot, 'input/candidate_chunks')
const CHUNK_SIZE = 20

if (!existsSync(candidatesPath)) {
  console.error(`no candidates at ${candidatesPath}. run extract_terms.mjs first.`)
  process.exit(1)
}

const all = JSON.parse(readFileSync(candidatesPath, 'utf8'))
if (!Array.isArray(all) || all.length === 0) {
  console.error('candidates file is empty')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
// 이전 출력 정리
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.json')) unlinkSync(resolve(outDir, f))
}

const totalChunks = Math.ceil(all.length / CHUNK_SIZE)
const pad = String(totalChunks).length

for (let i = 0; i < totalChunks; i++) {
  const slice = all.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
  const name = String(i + 1).padStart(pad, '0') + '.json'
  writeFileSync(resolve(outDir, name), JSON.stringify(slice, null, 2) + '\n', 'utf8')
}

console.log(`split ${all.length} candidates into ${totalChunks} chunks (${CHUNK_SIZE} each)`)
console.log(`-> ${outDir}/`)
