#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const dataDir = resolve(projectRoot, 'dashboard/public/data')
const seedPath = resolve(projectRoot, 'input/glossary_seed.txt')
const domainsPath = resolve(projectRoot, 'input/sector_domains.json')
const outPath = resolve(projectRoot, 'input/glossary_candidates.json')

// 텍스트 하이라이트 대상은 *_description 두 컬럼이지만, 풀네임 괄호 페어
// (예: "고유전체(High-k dielectric)")가 tech_name 쪽에만 있는 경우가 있어
// 후보 추출 단계에서는 tech_name도 함께 스캔한다.
const CSV_TARGETS = [
  { file: 'strategic_tech.csv', column: 'tech_name' },
  { file: 'strategic_tech.csv', column: 'tech_description' },
  { file: 'strategic_facility.csv', column: 'tech_name' },
  { file: 'strategic_facility.csv', column: 'facility_description' },
  { file: 'newgrowth_tech.csv', column: 'tech_name' },
  { file: 'newgrowth_tech.csv', column: 'tech_description' },
  { file: 'newgrowth_facility.csv', column: 'tech_name' },
  { file: 'newgrowth_facility.csv', column: 'facility_description' },
]

const ACRONYM_RE = /\b[A-Z][A-Z0-9](?:[A-Z0-9-]{0,8})\b/g
// 영문 측은 다단어 허용(공백·하이픈), 한글 측은 공백 미허용
// (한글 복합 명사가 공백을 포함하는 경우는 드물고, 공백 허용 시 백트래킹으로
// 직전 어절까지 흡수되는 문제가 발생함). 영문 측은 직전 글자가 영문이면 시작점 회피.
const PAIR_EN_KR_RE = /(?<![A-Za-z])([A-Za-z][A-Za-z0-9 .\-]{1,40}?)\s*\(\s*([가-힣][가-힣A-Za-z0-9]{0,20})\s*\)/g
const PAIR_KR_EN_RE = /([가-힣][가-힣A-Za-z0-9]{1,20})\s*\(\s*([A-Za-z][A-Za-z0-9 .\-]{0,40}?)\s*\)/g
const KOREAN_PARTICLES = '(?:을|를|의|에|은|는|이|가|도|만|과|와|로|으로|에서|에게|부터|까지|보다|라고|라는|이라|이라는|이며|이고|이다)?'

const COMMON_ACRONYM_BLOCKLIST = new Set([
  // 흔한 일반 단어/단위는 후보에서 제외 (운영자 검수 부담 경감)
  'KG', 'KW', 'KWH', 'MW', 'GW', 'TWH', 'GHZ', 'MHZ', 'KHZ',
  'MM', 'CM', 'NM', 'PM', 'UM', 'KM',
  'TRUE', 'FALSE', 'YES', 'NO',
  'CSV', 'PDF', 'JSON', 'XML', 'HTML', 'CSS',
])

function parseCsv(text) {
  // BOM 제거
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
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        row.push(field); field = ''
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = ''
      } else if (ch === '\r') {
        // skip
      } else {
        field += ch
      }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  if (!rows.length) return []
  const header = rows.shift()
  return rows.filter(r => r.some(x => x && x.length > 0)).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

function loadSeed(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
}

function loadSectorDomains(path) {
  if (!existsSync(path)) return {}
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  // _comment 처럼 _ 로 시작하는 메타 키는 무시. 값은 문자열 또는 배열 둘 다 허용하며
  // 내부적으로는 항상 배열로 정규화한다.
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue
    if (Array.isArray(v)) {
      const arr = v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())
      if (arr.length) out[k] = arr
    } else if (typeof v === 'string' && v.trim()) {
      out[k] = [v.trim()]
    }
  }
  return out
}

function uniqPush(arr, value) {
  if (!value) return
  if (!arr.includes(value)) arr.push(value)
}

function contextSnippets(text, term) {
  const snippets = []
  const lower = text
  let idx = 0
  while (idx < lower.length && snippets.length < 3) {
    const found = lower.indexOf(term, idx)
    if (found === -1) break
    const start = Math.max(0, found - 40)
    const end = Math.min(text.length, found + term.length + 40)
    snippets.push((start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : ''))
    idx = found + term.length
  }
  return snippets
}

function bumpSector(entry, sector) {
  if (!sector) return
  entry.sectors = entry.sectors || new Map()
  entry.sectors.set(sector, (entry.sectors.get(sector) || 0) + 1)
}

function extract() {
  const seed = loadSeed(seedPath)
  const seedSet = new Set(seed)
  const sectorDomains = loadSectorDomains(domainsPath)
  // term -> { term, aliases:Set, freq, sectors:Map<sector, count> }
  const acronymMap = new Map()
  const koreanMap = new Map()
  // [{ text, sector }] — sector는 행의 sector_name(있을 때)
  const entries = []

  for (const { file, column } of CSV_TARGETS) {
    const path = resolve(dataDir, file)
    if (!existsSync(path)) {
      console.warn(`[skip] missing CSV: ${path}`)
      continue
    }
    const rows = parseCsv(readFileSync(path, 'utf8'))
    for (const row of rows) {
      const text = (row[column] || '').trim()
      if (!text) continue
      entries.push({ text, sector: (row.sector_name || '').trim() })
    }
  }

  for (const { text, sector } of entries) {
    // 1) 영문 약자
    for (const m of text.matchAll(ACRONYM_RE)) {
      const key = m[0].toUpperCase()
      if (COMMON_ACRONYM_BLOCKLIST.has(key)) continue
      const entry = acronymMap.get(key) || { term: m[0], aliases: new Set(), freq: 0 }
      entry.freq += 1
      if (m[0] !== key) entry.aliases.add(m[0])
      bumpSector(entry, sector)
      acronymMap.set(key, entry)
    }
    // 2) 괄호 풀네임 페어 (영(한))
    for (const m of text.matchAll(PAIR_EN_KR_RE)) {
      const en = m[1].trim()
      const kr = m[2].trim()
      const key = en.toUpperCase()
      const entry = acronymMap.get(key) || { term: en, aliases: new Set(), freq: 0 }
      entry.aliases.add(kr)
      bumpSector(entry, sector)
      acronymMap.set(key, entry)
      if (seedSet.has(kr)) {
        const kEntry = koreanMap.get(kr) || { term: kr, aliases: new Set(), freq: 0 }
        kEntry.aliases.add(en)
        bumpSector(kEntry, sector)
        koreanMap.set(kr, kEntry)
      }
    }
    // 3) 괄호 풀네임 페어 (한(영))
    for (const m of text.matchAll(PAIR_KR_EN_RE)) {
      const kr = m[1].trim()
      const en = m[2].trim()
      const key = en.toUpperCase()
      const entry = acronymMap.get(key) || { term: en, aliases: new Set(), freq: 0 }
      entry.aliases.add(kr)
      bumpSector(entry, sector)
      acronymMap.set(key, entry)
      if (seedSet.has(kr)) {
        const kEntry = koreanMap.get(kr) || { term: kr, aliases: new Set(), freq: 0 }
        kEntry.aliases.add(en)
        bumpSector(kEntry, sector)
        koreanMap.set(kr, kEntry)
      }
    }
    // 4) 한글 시드 (조사 무시)
    for (const seedTerm of seed) {
      if (!seedTerm || !text.includes(seedTerm)) continue
      const re = new RegExp(escapeReg(seedTerm) + KOREAN_PARTICLES, 'g')
      const hits = text.match(re)
      if (!hits) continue
      const entry = koreanMap.get(seedTerm) || { term: seedTerm, aliases: new Set(), freq: 0 }
      entry.freq += hits.length
      bumpSector(entry, sector)
      koreanMap.set(seedTerm, entry)
    }
  }

  // 컨텍스트 샘플 채우기
  function attachContexts(map) {
    for (const entry of map.values()) {
      const samples = []
      for (const { text } of entries) {
        if (samples.length >= 3) break
        const snippets = contextSnippets(text, entry.term)
        for (const s of snippets) {
          if (samples.length >= 3) break
          if (!samples.includes(s)) samples.push(s)
        }
      }
      entry.sampleContexts = samples
    }
  }
  attachContexts(acronymMap)
  attachContexts(koreanMap)

  // 매핑되지 않은 sector_name 추적용
  const missingSectors = new Set()

  function resolveDomain(entry) {
    if (!entry.sectors || entry.sectors.size === 0) {
      return { dominantSector: '', domain: '', domainCandidates: [] }
    }
    let topSector = ''
    let topCount = -1
    for (const [s, c] of entry.sectors.entries()) {
      if (c > topCount) { topSector = s; topCount = c }
    }
    const arr = sectorDomains[topSector]
    if (!arr || arr.length === 0) {
      missingSectors.add(topSector)
      return { dominantSector: topSector, domain: '', domainCandidates: [] }
    }
    if (arr.length === 1) {
      return { dominantSector: topSector, domain: arr[0], domainCandidates: [] }
    }
    return { dominantSector: topSector, domain: '', domainCandidates: arr }
  }

  const all = [...acronymMap.values(), ...koreanMap.values()]
    .map(e => {
      const { dominantSector, domain, domainCandidates } = resolveDomain(e)
      const out = {
        term: e.term,
        aliases: [...e.aliases],
        frequency: e.freq,
        dominantSector,
        domain,
      }
      if (domainCandidates.length) out.domainCandidates = domainCandidates
      out.sampleContexts = e.sampleContexts || []
      return out
    })
    .sort((a, b) => b.frequency - a.frequency || a.term.localeCompare(b.term))

  writeFileSync(outPath, JSON.stringify(all, null, 2) + '\n', 'utf8')
  console.log(`extracted ${all.length} candidates -> ${outPath}`)
  console.log(`  acronyms: ${acronymMap.size}, korean(seed): ${koreanMap.size}`)
  if (missingSectors.size) {
    console.warn(`\n[warn] sector_domains.json에 매핑이 없는 sector_name ${missingSectors.size}개:`)
    for (const s of [...missingSectors].sort()) console.warn(`  - ${JSON.stringify(s)}`)
  }
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

extract()
