const SECTOR_PAIRS = [
  ['반도체', '차세대전자정보디바이스'],
  ['디스플레이', '차세대전자정보디바이스'],
  ['인공지능', '지능정보'],
  ['인공지능', '차세대소프트웨어(SW)및보안'],
  ['바이오의약품', '바이오·헬스'],
  ['백신', '바이오·헬스'],
  ['미래형운송및이동수단', '미래형자동차'],
  ['이차전지', '에너지·환경'],
  ['수소', '에너지·환경'],
  ['수소', '탄소중립'],
].map(([strategic, growth]) => [normalizeName(strategic), normalizeName(growth)])

const SIMILARITY_THRESHOLD = 0.75

const GENERIC_TECH_TERMS = [
  '설계',
  '제조',
  '개발',
  '공정',
  '모듈',
  '구동',
  '부품',
  '소재',
  '장비',
  '패키징',
  '패키지',
  '기술',
  '적용',
]

const TOKEN_STOPWORDS = new Set([
  '및',
  '등',
  '위한',
  '이하',
  '이상',
  '이용한',
  '관련',
  '포함',
  '또는',
  '하는',
])

function normalizeName(name) {
  if (!name) return ''
  return String(name)
    .replace(/micro/gi, '마이크로')
    .replace(/[ㆍ‧·․∙•]/g, '·')
    .replace(/\s+/g, '')
    .trim()
}

export function normalizeTechName(name) {
  return normalizeName(name)
    .replace(/\((?=[^)]*[A-Za-z])[^)]*\)/g, '')
    .replace(/[()]/g, '')
    .toLowerCase()
}

function normalizeTokenText(text) {
  return String(text || '')
    .replace(/micro/gi, '마이크로')
    .replace(/(\d+(?:\.\d+)?)(?=\s*(?:nm|단|gb|tb|ghz|mhz|kw|mw|°c|℃|v|w|%))/gi, '#')
    .toLowerCase()
    .replace(/#\s*(?:°c|℃)/g, '#c')
    .replace(/(#\s*(?:nm|단|gb|tb|ghz|mhz|kw|mw|c|v|w|%))\s*(?:이하|이상)?급/g, '$1')
    .replace(/(#\s*(?:nm|단|gb|tb|ghz|mhz|kw|mw|c|v|w|%))\s*(?:이하|이상)/g, '$1')
    .replace(/#\s+/g, '#')
    .replace(/[ㆍ‧·․∙•/]/g, ' ')
    .replace(/\((?=[^)]*[A-Za-z])[^)]*\)/g, '')
    .replace(/[()[\]{}]/g, ' ')
}

function splitGenericTerms(token) {
  let value = token
  for (const term of GENERIC_TECH_TERMS) {
    value = value.replaceAll(term, ' ')
  }

  return value
    .split(/\s+/)
    .map((part) => part.replace(/[의을를은는이가과와]$/, ''))
    .filter(Boolean)
}

function techTokens(row, fields) {
  const text = normalizeTokenText(fields.map((field) => row[field] || '').join(' '))
  return text
    .split(/[^#%0-9a-z가-힣]+/i)
    .flatMap(splitGenericTerms)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !TOKEN_STOPWORDS.has(token))
}

function comparableText(row, fields) {
  return techTokens(row, fields).join('')
}

export function crossTechKey(type, row) {
  return [
    type,
    row.sector_key,
    row.subsector || '',
    row.item_no || '',
    normalizeTechName(row.tech_name),
  ].join('::')
}

export function getRelatedSectors(sectorKey, type) {
  const key = normalizeName(sectorKey)
  const sourceIndex = type === 'strategic' ? 0 : 1
  const targetIndex = type === 'strategic' ? 1 : 0

  return SECTOR_PAIRS
    .filter((pair) => pair[sourceIndex] === key)
    .map((pair) => pair[targetIndex])
}

function isRelatedSector(strategicRow, growthRow) {
  return SECTOR_PAIRS.some(([strategicSector, growthSector]) => {
    return strategicRow.sector_key === strategicSector && growthRow.sector_key === growthSector
  })
}

function isActive(row) {
  return row.current && row.status !== '삭제'
}

function isDeletedCurrent(row) {
  return row.current && row.status === '삭제' && !row.renumbered_deletion
}

function lcsLength(a, b) {
  if (!a || !b) return 0

  const previous = new Array(b.length + 1).fill(0)
  const current = new Array(b.length + 1).fill(0)

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1])
    }
    previous.splice(0, previous.length, ...current)
    current.fill(0)
  }

  return previous[b.length]
}

export function similarityRatio(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  return (lcsLength(a, b) * 2) / (a.length + b.length)
}

function tokenCounts(tokens) {
  const counts = new Map()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1)
  }
  return counts
}

function tokenDiceSimilarity(leftTokens, rightTokens) {
  const left = tokenCounts(leftTokens)
  const right = tokenCounts(rightTokens)
  let intersection = 0
  let total = 0

  for (const count of left.values()) total += count
  for (const count of right.values()) total += count
  if (total === 0) return 0

  for (const [gram, count] of left) {
    intersection += Math.min(count, right.get(gram) || 0)
  }

  return (2 * intersection) / total
}

function charBigrams(text) {
  const counts = new Map()
  if (!text) return counts
  if (text.length < 2) {
    counts.set(text, 1)
    return counts
  }

  for (let index = 0; index <= text.length - 2; index += 1) {
    const gram = text.slice(index, index + 2)
    counts.set(gram, (counts.get(gram) || 0) + 1)
  }
  return counts
}

function charBigramDiceSimilarity(leftText, rightText) {
  const left = charBigrams(leftText)
  const right = charBigrams(rightText)
  let intersection = 0
  let total = 0

  for (const count of left.values()) total += count
  for (const count of right.values()) total += count
  if (total === 0) return 0

  for (const [gram, count] of left) {
    intersection += Math.min(count, right.get(gram) || 0)
  }

  return (2 * intersection) / total
}

function fieldTokenSimilarity(a, b, fields) {
  return tokenDiceSimilarity(techTokens(a, fields), techTokens(b, fields))
}

function fieldBigramSimilarity(a, b, fields) {
  return charBigramDiceSimilarity(comparableText(a, fields), comparableText(b, fields))
}

export function techSimilarity(a, b) {
  const nameTokenScore = fieldTokenSimilarity(a, b, ['tech_name'])
  const nameBigramScore = fieldBigramSimilarity(a, b, ['tech_name'])
  const fullTokenScore = fieldTokenSimilarity(a, b, ['tech_name', 'tech_description'])
  const fullBigramScore = fieldBigramSimilarity(a, b, ['tech_name', 'tech_description'])
  const nameScore = (nameTokenScore * 0.5) + (nameBigramScore * 0.5)
  const fullTextScore = (fullTokenScore * 0.5) + (fullBigramScore * 0.5)
  const blendedScore = (nameScore * 0.45) + (fullTextScore * 0.55)

  if (nameTokenScore >= 0.8 && nameBigramScore >= 0.6) {
    const nameAlignedScore = (nameTokenScore * 0.9) + (fullTextScore * 0.1)
    return Math.max(blendedScore, nameAlignedScore)
  }

  return blendedScore
}

function clinicalPhase(name) {
  const match = name.match(/임상([123])상/)
  return match?.[1] || null
}

function canBeSimilarMatch(a, b) {
  const aPhase = clinicalPhase(a)
  const bPhase = clinicalPhase(b)
  return !aPhase || !bPhase || aPhase === bPhase
}

function ensureEntry(map, type, row) {
  const key = crossTechKey(type, row)
  if (!map.has(key)) {
    map.set(key, {
      exactMatches: [],
      manualMatches: [],
      similarMatches: [],
      promotedMatches: [],
      promoted: false,
      otherType: type === 'growth' ? 'strategic' : 'growth',
    })
  }
  return map.get(key)
}

function pushUnique(list, row, type, extra = {}) {
  const key = crossTechKey(type, row)
  if (list.some((item) => item._crossKey === key)) return
  list.push({ ...row, _crossKey: key, _type: type, ...extra })
}

function sortByScoreThenName(a, b) {
  const scoreDiff = (b._similarity || 0) - (a._similarity || 0)
  if (scoreDiff !== 0) return scoreDiff
  return (a.tech_name || '').localeCompare(b.tech_name || '', 'ko', { numeric: true })
}

export function buildCrossMatches(growthTechs, strategicTechs) {
  const matches = new Map()
  const activeGrowth = growthTechs.filter(isActive)
  const activeStrategic = strategicTechs.filter(isActive)
  const deletedGrowth = growthTechs.filter(isDeletedCurrent)
  const activeGrowthNames = new Set(activeGrowth.map((row) => normalizeTechName(row.tech_name)))

  for (const strategic of activeStrategic) {
    const strategicName = normalizeTechName(strategic.tech_name)

    for (const growth of activeGrowth) {
      if (!isRelatedSector(strategic, growth)) continue

      const growthName = normalizeTechName(growth.tech_name)
      const strategicEntry = ensureEntry(matches, 'strategic', strategic)
      const growthEntry = ensureEntry(matches, 'growth', growth)

      if (strategicName === growthName) {
        pushUnique(strategicEntry.exactMatches, growth, 'growth')
        pushUnique(growthEntry.exactMatches, strategic, 'strategic')
        continue
      }

      const ratio = techSimilarity(strategic, growth)
      if (
        canBeSimilarMatch(strategicName, growthName)
        && ratio >= SIMILARITY_THRESHOLD
      ) {
        pushUnique(strategicEntry.similarMatches, growth, 'growth', { _similarity: ratio })
        pushUnique(growthEntry.similarMatches, strategic, 'strategic', { _similarity: ratio })
      }
    }

    for (const growth of deletedGrowth) {
      if (!isRelatedSector(strategic, growth)) continue
      if (activeGrowthNames.has(strategicName)) continue
      const growthName = normalizeTechName(growth.tech_name)
      const ratio = techSimilarity(strategic, growth)
      const promotedByName = strategicName === growthName
      const promotedBySimilarity = (
        canBeSimilarMatch(strategicName, growthName)
        && ratio >= SIMILARITY_THRESHOLD
      )
      if (!promotedByName && !promotedBySimilarity) continue

      const strategicEntry = ensureEntry(matches, 'strategic', strategic)
      const growthEntry = ensureEntry(matches, 'growth', growth)
      strategicEntry.promoted = true
      growthEntry.promoted = true
      pushUnique(strategicEntry.promotedMatches, growth, 'growth', { _similarity: ratio })
      pushUnique(growthEntry.promotedMatches, strategic, 'strategic', { _similarity: ratio })
    }
  }

  for (const entry of matches.values()) {
    entry.exactMatches.sort(sortByScoreThenName)
    entry.manualMatches.sort(sortByScoreThenName)
    entry.similarMatches.sort(sortByScoreThenName)
    entry.promotedMatches.sort(sortByScoreThenName)
  }

  return matches
}
