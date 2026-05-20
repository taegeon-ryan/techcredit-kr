#!/usr/bin/env node
// 검수된 input/glossary/workbook.csv 를 읽어 surface 들을 concept 단위로 클러스터링.
// 출력: input/glossary/concepts.json  — [{ concept_id, primary_canonical, surfaces, domain, sample_contexts, sample_techs }]
//
// 클러스터 키: (domain_hint, normalized surface key)
//   - normalize: 소문자화, 공백/하이픈/중점/괄호·내부 텍스트/조사 제거
//   - 영문 약어와 페어 풀네임은 같은 클러스터에 들어가도록 페어(예: "ALD"와 "원자층증착법(ALD, ...)") 보강 매칭
// concept_id: primary_canonical 의 slug
// primary_canonical 후보 선정: 클러스터의 surfaces 중 한 가지를 임의로 골라 LLM 단계에서 정식으로 결정
//   (여기서는 ASCII 가 있으면 가장 짧은 ASCII 표기, 없으면 가장 짧은 한글 표기)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from './_csv.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')
const workbookPath = resolve(projectRoot, 'input/glossary/workbook.csv')
const refPath = resolve(projectRoot, 'input/glossary/stage1_reference.csv')
const outPath = resolve(projectRoot, 'input/glossary/concepts.json')

function isAscii(s) { return !/[가-힣]/.test(s) }
function hasKorean(s) { return /[가-힣]/.test(s) }

// 클러스터링 키: 공백/하이픈/중점/대소문자 무시 + 괄호 안 텍스트 제거
function normKey(s) {
  return String(s || '')
    .toLowerCase()
    // 괄호 안 텍스트는 보조 표기로 보고 핵심부만 남겨 키 산출
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s\-_·ㆍ․/.,]/g, '')
    .trim()
}

// "한글(영문…)" / "영문(한글)" 페어에서 안쪽 표기들도 같은 클러스터로 모으기 위한 보조 키 목록
function pairKeys(surface) {
  const out = []
  const PAIR = /^([^()]+?)\s*\(([^()]+)\)\s*$/.exec(surface)
  if (PAIR) {
    const outer = PAIR[1].trim()
    // 괄호 안은 콤마/세미콜론으로 여러 별칭일 수 있음
    const innerParts = PAIR[2].split(/[,;]/).map(x => x.trim()).filter(Boolean)
    out.push(normKey(outer))
    for (const ip of innerParts) out.push(normKey(ip))
  }
  return out
}

function slugify(s) {
  // 영문/숫자/한글 외 제거, 공백→-
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^\w가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function snippet(text, surface) {
  const i = text.indexOf(surface)
  if (i < 0) return ''
  const s = Math.max(0, i - 40)
  const e = Math.min(text.length, i + surface.length + 40)
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '')
}

function aggregate() {
  if (!existsSync(workbookPath)) {
    console.error(`no workbook at ${workbookPath}. run 03_combine_extractions.mjs first.`)
    process.exit(1)
  }
  if (!existsSync(refPath)) {
    console.error(`no reference at ${refPath}`)
    process.exit(1)
  }

  const workbookRows = parseCsv(readFileSync(workbookPath, 'utf8')).rows
    .filter(r => r.surface && (r.keep || 'True').trim().toLowerCase() !== 'false')

  const refRows = parseCsv(readFileSync(refPath, 'utf8')).rows
  const techById = new Map(refRows.map(r => [r.tech_id, r]))

  // 1차 패스: 키 그래프 만들어 union-find 로 묶기
  // 각 surface 에 대해 normKey + pairKeys 를 같은 그룹으로 연결.
  const parent = new Map()
  function find(k) { if (parent.get(k) !== k) parent.set(k, find(parent.get(k))); return parent.get(k) }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  function ensure(k) { if (!parent.has(k)) parent.set(k, k) }

  // (domain, keyRoot) 단위로 묶기 위해 도메인을 키에 prefix
  function compoundKey(domain, k) { return `${domain || ''}::${k}` }

  for (const row of workbookRows) {
    const domain = (row.domain_hint || '').trim()
    const base = compoundKey(domain, normKey(row.surface))
    ensure(base)
    for (const pk of pairKeys(row.surface)) {
      const ck = compoundKey(domain, pk)
      ensure(ck)
      union(base, ck)
    }
  }

  // 2차 패스: 클러스터에 row 배치
  const clusters = new Map() // root -> { domain, surfaces:Map<surface,Set<tech_id>>, techIds:Set, notes:Set }
  for (const row of workbookRows) {
    const domain = (row.domain_hint || '').trim()
    const base = compoundKey(domain, normKey(row.surface))
    const root = find(base)
    let cl = clusters.get(root)
    if (!cl) {
      cl = { domain, surfaces: new Map(), techIds: new Set(), notes: new Set() }
      clusters.set(root, cl)
    }
    if (!cl.surfaces.has(row.surface)) cl.surfaces.set(row.surface, new Set())
    cl.surfaces.get(row.surface).add(row.tech_id)
    cl.techIds.add(row.tech_id)
    if (row.note?.trim()) cl.notes.add(row.note.trim())
  }

  // 산출
  const out = []
  for (const cl of clusters.values()) {
    const surfaceList = [...cl.surfaces.keys()]
    // primary canonical 후보: ASCII 표기 중 가장 짧은 것, 없으면 한글 중 가장 짧은 것
    const asciiSurfaces = surfaceList.filter(isAscii).sort((a, b) => a.length - b.length)
    const koreanSurfaces = surfaceList.filter(s => hasKorean(s)).sort((a, b) => a.length - b.length)
    const primary = asciiSurfaces[0] || koreanSurfaces[0] || surfaceList[0]

    const sampleContexts = []
    const sampleTechs = []
    for (const [surface, techSet] of cl.surfaces) {
      for (const tid of techSet) {
        const tech = techById.get(tid)
        if (!tech) continue
        if (sampleTechs.length < 5) sampleTechs.push({ tech_id: tid, sector_name: tech.sector_name, tech_name: tech.tech_name, surface })
        if (sampleContexts.length < 3) {
          const snip = snippet(tech.tech_description || '', surface)
          if (snip && !sampleContexts.includes(snip)) sampleContexts.push(snip)
        }
      }
    }

    out.push({
      concept_id: slugify(primary),
      primary_canonical: primary,
      domain: cl.domain,
      surfaces: surfaceList,
      sample_techs: sampleTechs,
      sample_contexts: sampleContexts,
      ...(cl.notes.size ? { notes: [...cl.notes] } : {}),
    })
  }

  // concept_id 충돌 시 suffix
  const idCount = new Map()
  for (const c of out) {
    const base = c.concept_id || 'concept'
    const n = (idCount.get(base) || 0) + 1
    idCount.set(base, n)
    if (n > 1) c.concept_id = `${base}-${n}`
    else c.concept_id = base
  }

  out.sort((a, b) => b.sample_techs.length - a.sample_techs.length || a.concept_id.localeCompare(b.concept_id))

  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.log(`aggregated ${workbookRows.length} (tech, surface) rows -> ${out.length} concepts`)
  console.log(`-> ${outPath}`)
}

aggregate()
