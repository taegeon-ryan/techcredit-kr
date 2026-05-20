#!/usr/bin/env node
// Stage 2 LLM 응답 품질 점검.
// 현재는 short 본문 안의 인접 동일 단어 반복(예: "전력 전력")을 배치별로 집계한다.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')
const batchesDir = resolve(projectRoot, 'input/glossary/stage2_batches')

function words(s) {
  return String(s || '')
    .replace(/[*_`"'“”‘’()[\]{}<>]/g, ' ')
    .split(/[\s,.;:!?，。、《》·ㆍ․…]+/)
    .map(w => w.trim().toLowerCase().replace(/^[^0-9a-z가-힣]+|[^0-9a-z가-힣]+$/gi, ''))
    .filter(Boolean)
}

const files = readdirSync(batchesDir).filter(f => f.endsWith('.json')).sort()
const stats = []
const findings = []

for (const file of files) {
  const entries = JSON.parse(readFileSync(resolve(batchesDir, file), 'utf8'))
  let totalWords = 0
  let exactEntries = 0
  let exactPairs = 0

  for (const entry of entries) {
    if (!entry || typeof entry.short !== 'string') continue
    const ws = words(entry.short)
    totalWords += ws.length
    const pairs = []
    for (let i = 1; i < ws.length; i++) {
      if (ws[i].length >= 2 && ws[i] === ws[i - 1]) pairs.push(`${ws[i - 1]} ${ws[i]}`)
    }
    if (!pairs.length) continue
    exactEntries++
    exactPairs += pairs.length
    findings.push({
      file,
      concept_id: entry.concept_id,
      pairs: [...new Set(pairs)],
      short: entry.short,
    })
  }

  stats.push({
    file,
    entries: entries.length,
    totalWords,
    exactEntries,
    exactPairs,
    exactPairsPer1000Words: totalWords ? Number((exactPairs / totalWords * 1000).toFixed(2)) : 0,
  })
}

console.log(JSON.stringify({ stats, findings }, null, 2))
