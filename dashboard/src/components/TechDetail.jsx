import { useEffect, useMemo, useState } from 'react'
import { diffWords } from 'diff'
import { historyKey, normalizeSector } from '../hooks/useAllData'
import { crossTechKey, normalizeTechName } from '../utils/crossCategoryMap'
import { sectorIcon } from '../utils/sectorIcons'
import { compareTechs, getOrderedTechs, techRowKey } from '../utils/techOrdering'

function formatElapsed(months) {
  if (months == null) return ''
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m}개월`
  if (m === 0) return `${y}년`
  return `${y}년 ${m}개월`
}

function formatMonth(date) {
  return date ? date.slice(0, 7) : '적용시기 미상'
}

function formatVersion(version) {
  const v = String(version || '')
  if (!/^\d{6}$/.test(v)) return v ? `${v} 개정` : '개정일 미상'

  const year = 2000 + Number(v.slice(0, 2))
  const month = Number(v.slice(2, 4))
  const day = Number(v.slice(4, 6))
  return `${year}. ${month}. ${day}. 개정`
}

function statusLabel(status) {
  if (status === '삭제') return '폐지'
  return status || '상태 미상'
}

function statusClass(status) {
  if (status === '신설') return 'history-status--new'
  if (status === '변경') return 'history-status--changed'
  if (status === '삭제') return 'history-status--deleted'
  return ''
}

function hasDiff(parts) {
  return parts.some((part) => part.added || part.removed)
}

function diffStats(parts) {
  return parts.reduce(
    (acc, part) => {
      const length = part.value.trim().length
      if (part.added) acc.added += length
      else if (part.removed) acc.removed += length
      else acc.same += length
      return acc
    },
    { added: 0, removed: 0, same: 0 }
  )
}

function isMajorRewrite(parts) {
  const { added, removed, same } = diffStats(parts)
  const total = added + removed + same
  if (total === 0) return false

  const changedRatio = (added + removed) / total
  const unchangedRatio = same / total
  return added >= 30 && removed >= 30 && changedRatio >= 0.5 && unchangedRatio <= 0.45
}

function trimRepeatedDeletion(rows) {
  const firstDeletedIndex = rows.findIndex((row) => row.status === '삭제')
  return firstDeletedIndex === -1 ? rows : rows.slice(0, firstDeletedIndex + 1)
}

function sameNormalized(a, b) {
  return normalizeSector(a || '') === normalizeSector(b || '')
}

function comparableFacilityTechName(name) {
  return normalizeTechName(name || '')
    .replace(/기능개선/g, '')
    .replace(/이하[0-9a-z가-힣]*?같다/g, '')
    .replace(/및/g, '')
    .replace(/[ㆍ·]/g, '')
    .replace(/[^0-9a-z가-힣]/gi, '')
}

function looselySameFacilityTechName(a, b) {
  const left = comparableFacilityTechName(a)
  const right = comparableFacilityTechName(b)
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

function isCommonFacility(row) {
  return !row.item_no && (!row.tech_name || row.tech_name.includes('공통'))
}

function matchesFacility(row, tech) {
  const sameSector = row.sector_key === tech.sector_key
  const sameSubsector = sameNormalized(row.subsector, tech.subsector)
  const hasSubsectorScope = Boolean(row.subsector || tech.subsector)
  const sameItemNo = Boolean(row.item_no && row.item_no === tech.item_no)
  const sameNamedTech = sameNormalized(row.tech_name, tech.tech_name) && sameSector && sameSubsector
  const sameLooselyNamedTech = (
    sameSector
    && sameSubsector
    && sameItemNo
    && looselySameFacilityTechName(row.tech_name, tech.tech_name)
  )
  const sameNumberedItem = (
    hasSubsectorScope
    && sameItemNo
    && sameSector
    && sameSubsector
    && !row.tech_name
  )
  const commonFacility = isCommonFacility(row) && sameSector

  return sameNumberedItem || sameNamedTech || sameLooselyNamedTech || commonFacility
}

function facilityHistoryGroupKey(row) {
  if (isCommonFacility(row)) {
    return [
      'common',
      row.sector_key,
      normalizeSector(row.tech_name || row.facility_description || ''),
    ].join('::')
  }

  return [
    'facility',
    row.sector_key,
    normalizeSector(row.subsector || ''),
    row.item_no || '',
    normalizeSector(row.tech_name || row.facility_description || ''),
  ].join('::')
}

function facilityLabel(row) {
  if (isCommonFacility(row)) return row.tech_name || '공통 사업화시설'
  return [row.item_no, row.tech_name].filter(Boolean).join(' ')
}

function dayDiff(a, b) {
  const left = new Date(a)
  const right = new Date(b)
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return null
  return Math.round((right - left) / (1000 * 60 * 60 * 24))
}

function sameFacilityContent(a, b) {
  return (
    a.sector_key === b.sector_key
    && sameNormalized(a.subsector, b.subsector)
    && sameNormalized(a.tech_name, b.tech_name)
    && normalizeSector(a.facility_description || '') === normalizeSector(b.facility_description || '')
  )
}

function isAdministrativeFacilityReissue(deletedRow, addedRow) {
  return (
    deletedRow?.status === '삭제'
    && addedRow?.status === '신설'
    && String(deletedRow.version || '') === String(addedRow.version || '')
    && dayDiff(deletedRow.apply_date, addedRow.apply_date) === 1
    && sameFacilityContent(deletedRow, addedRow)
  )
}

function compactFacilityHistoryRows(rows) {
  const compacted = []

  for (const row of rows) {
    const previous = compacted[compacted.length - 1]

    if (isAdministrativeFacilityReissue(previous, row)) {
      compacted.pop()
      const beforeDeletion = compacted[compacted.length - 1]
      if (!beforeDeletion || !sameFacilityContent(beforeDeletion, row)) {
        compacted.push(row)
      }
      continue
    }

    compacted.push(row)
  }

  return compacted
}

function buildFacilityHistoryEntries(rows) {
  return rows.map((row, index) => {
    const previous = rows[index - 1]
    if (!previous) {
      return {
        row,
        isFirst: true,
        descChanged: false,
        statusChanged: false,
      }
    }

    const descDiff = diffWords(previous.facility_description || '', row.facility_description || '')

    return {
      row,
      previous,
      isFirst: false,
      descDiff,
      descChanged: hasDiff(descDiff),
      descRewrite: isMajorRewrite(descDiff),
      statusChanged: previous.status !== row.status,
    }
  })
}

function datasetLabel(type) {
  return type === 'growth' ? '신성장' : '전략'
}

function relatedTitle(type) {
  return type === 'strategic' ? '연관 신성장·원천기술' : '연관 국가전략기술'
}

function promotedMessage(type) {
  if (type === 'strategic') {
    return '이 기술은 신성장·원천기술에서 국가전략기술로 승격된 이력이 있습니다.'
  }
  return '이 기술은 국가전략기술로 승격된 이력이 있습니다.'
}

function relatedSectorLabel(item) {
  if (item._type === 'growth' && item.subsector) {
    return `${item.sector_name} · ${item.subsector}`
  }
  return item.sector_name
}

function CountBadge({ count }) {
  if (count <= 1) return null
  return <span className="detail-count">{count}건</span>
}

function comparableChars(text) {
  const chars = []
  for (let index = 0; index < text.length; index += 1) {
    const normalized = normalizeTechName(text[index]).toLowerCase()
    for (const char of normalized) {
      if (/[0-9a-z가-힣]/i.test(char)) {
        chars.push({ char, index })
      }
    }
  }
  return chars
}

function similarCharIndexes(source, target) {
  const left = comparableChars(source)
  const right = comparableChars(target)
  if (left.length === 0 || right.length === 0) return new Set()

  const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0))
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      dp[i][j] = left[i - 1].char === right[j - 1].char
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const indexes = new Set()
  let i = left.length
  let j = right.length
  while (i > 0 && j > 0) {
    if (left[i - 1].char === right[j - 1].char) {
      indexes.add(right[j - 1].index)
      i -= 1
      j -= 1
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1
    } else {
      j -= 1
    }
  }

  return indexes
}

function HighlightedSimilarity({ text, reference }) {
  const indexes = similarCharIndexes(reference, text)
  const parts = []
  let buffer = ''
  let highlighted = false

  for (let index = 0; index < text.length; index += 1) {
    const isHighlighted = indexes.has(index)
    if (index > 0 && isHighlighted !== highlighted) {
      parts.push({ text: buffer, highlighted })
      buffer = ''
    }
    highlighted = isHighlighted
    buffer += text[index]
  }
  if (buffer) parts.push({ text: buffer, highlighted })

  return parts.map((part, index) => {
    const className = part.highlighted && normalizeTechName(part.text).length >= 2
      ? 'similarity-highlight'
      : undefined
    return (
      <span key={`${part.text}-${index}`} className={className}>
        {part.text}
      </span>
    )
  })
}

function DiffDisplay({ parts, className = 'diff-text' }) {
  return (
    <p className={className}>
      {parts.map((part, index) => {
        const className = part.added ? 'diff-add' : part.removed ? 'diff-remove' : undefined
        return (
          <span key={`${part.value}-${index}`} className={className}>
            {part.value}
          </span>
        )
      })}
    </p>
  )
}

export default function TechDetail({ data, tech, sector, controls, onBack, onRelatedTechSelect, onNavigateTech }) {
  const facilityKey = sector.type === 'growth' ? 'growth_facility' : 'strategic_facility'
  const techKey = sector.type === 'growth' ? 'growth_tech' : 'strategic_tech'
  const [relatedOpen, setRelatedOpen] = useState(true)
  const historyPanelKey = [
    sector.type,
    tech.sector_key,
    tech.subsector || '',
    tech.item_no || '',
    tech.tech_name || '',
  ].join('::')
  const [historyPanelState, setHistoryPanelState] = useState(() => ({
    key: historyPanelKey,
    techOpen: false,
    facilityOpen: false,
  }))
  const currentHistoryPanelState = historyPanelState.key === historyPanelKey
    ? historyPanelState
    : { key: historyPanelKey, techOpen: false, facilityOpen: false }
  const techHistoryOpen = currentHistoryPanelState.techOpen
  const facilityHistoryOpen = currentHistoryPanelState.facilityOpen
  const techApplyDate = tech.first_apply_date || tech.apply_date
  const techElapsedMonths = tech.introduced_elapsed_months ?? tech.elapsed_months

  function toggleTechHistory() {
    setHistoryPanelState((previous) => {
      const state = previous.key === historyPanelKey
        ? previous
        : { key: historyPanelKey, techOpen: false, facilityOpen: false }
      return { ...state, techOpen: !state.techOpen }
    })
  }

  function toggleFacilityHistory() {
    setHistoryPanelState((previous) => {
      const state = previous.key === historyPanelKey
        ? previous
        : { key: historyPanelKey, techOpen: false, facilityOpen: false }
      return { ...state, facilityOpen: !state.facilityOpen }
    })
  }

  const historyRows = useMemo(() => {
    const key = historyKey(tech)
    const rows = data[techKey]
      .filter((row) => historyKey(row) === key)
      .sort((a, b) => String(a.version).localeCompare(String(b.version)))

    return trimRepeatedDeletion(rows)
  }, [data, tech, techKey])

  const facilities = useMemo(() => {
    return data[facilityKey]
      .filter((r) => r.current && r.status !== '삭제' && matchesFacility(r, tech))
  }, [data, tech, facilityKey])

  useEffect(() => {
    if (facilities.length <= 1) return

    console.warn('[facility_matching] multiple current facilities', {
      dataset: sector.type,
      tech: `${tech.sector_name} / ${tech.subsector || ''} / ${tech.item_no || ''} / ${tech.tech_name}`,
      facilities: facilities.map((facility) => ({
        item_no: facility.item_no,
        tech_name: facility.tech_name,
        sector_name: facility.sector_name,
        subsector: facility.subsector,
        apply_date: facility.apply_date,
      })),
    })
  }, [facilities, sector.type, tech])

  const facilityHistoryGroups = useMemo(() => {
    const groups = new Map()
    const facilityRows = data[facilityKey]
      .filter((row) => historyRows.some((techRow) => matchesFacility(row, techRow)))
      .sort((a, b) => {
        const dateDiff = String(a.apply_date || '').localeCompare(String(b.apply_date || ''))
        if (dateDiff !== 0) return dateDiff
        return String(a.version || '').localeCompare(String(b.version || ''))
      })

    for (const row of facilityRows) {
      const key = facilityHistoryGroupKey(row)
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title: facilityLabel(row),
          rows: [],
        })
      }

      groups.get(key).rows.push(row)
    }

    return Array.from(groups.values())
      .map((group) => {
        const rows = trimRepeatedDeletion(compactFacilityHistoryRows(group.rows))
        const latest = rows[rows.length - 1]
        return {
          ...group,
          title: latest ? facilityLabel(latest) : group.title,
          rows,
          entries: buildFacilityHistoryEntries(rows).reverse(),
        }
      })
      .filter((group) => group.rows.length > 0)
  }, [data, facilityKey, historyRows])

  const historyEntries = useMemo(() => {
    return historyRows.map((row, index) => {
      const previous = historyRows[index - 1]
      if (!previous) {
        return {
          row,
          isFirst: true,
          nameChanged: false,
          descChanged: false,
          statusChanged: false,
        }
      }

      const nameDiff = diffWords(previous.tech_name || '', row.tech_name || '')
      const descDiff = diffWords(previous.tech_description || '', row.tech_description || '')

      return {
        row,
        previous,
        isFirst: false,
        nameDiff,
        descDiff,
        nameChanged: hasDiff(nameDiff),
        descChanged: hasDiff(descDiff),
        descRewrite: isMajorRewrite(descDiff),
        statusChanged: previous.status !== row.status,
      }
    }).reverse()
  }, [historyRows])

  const related = useMemo(() => {
    return data.crossMatches?.get(crossTechKey(sector.type, tech)) || null
  }, [data.crossMatches, sector.type, tech])

  const relatedItems = useMemo(() => {
    if (!related) return []

    const map = new Map()
    for (const item of [
      ...(related.exactMatches || []),
      ...(related.manualMatches || []),
      ...(related.similarMatches || []),
      ...(related.promotedMatches || []),
    ]) {
      if (!map.has(item._crossKey)) map.set(item._crossKey, item)
    }
    return Array.from(map.values())
  }, [related])

  const relatedCount = relatedItems.length
  const hasRelated = relatedCount > 0 || related?.promoted

  const { prevTech, nextTech } = useMemo(() => {
    const ordered = getOrderedTechs(data[techKey], sector, controls)
    const currentKey = techRowKey(tech)
    let list = ordered
    let index = ordered.findIndex((row) => techRowKey(row) === currentKey)
    if (index === -1) {
      const compare = compareTechs(controls?.sortBy || 'statute')
      const insertAt = ordered.findIndex((row) => compare(tech, row) < 0)
      const merged = ordered.slice()
      if (insertAt === -1) merged.push(tech)
      else merged.splice(insertAt, 0, tech)
      list = merged
      index = insertAt === -1 ? merged.length - 1 : insertAt
    }
    return {
      prevTech: index > 0 ? list[index - 1] : null,
      nextTech: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
    }
  }, [data, techKey, sector, controls, tech])

  return (
    <div className="drill-view">
      <div className="drill-header">
        <button className="back-btn" onClick={onBack}>
          <span>←</span>
          <span className="back-btn-icon" aria-hidden="true">{sectorIcon(sector.sectorKey)}</span>
          <span>{sector.name} 기술 목록</span>
        </button>
        <div className="drill-title-wrap">
          <span className={`dataset-tag dataset-tag--${sector.type}`}>
            {sector.type === 'growth' ? '신성장' : '전략'}
          </span>
          <h2 className="drill-title">{tech.tech_name}</h2>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-heading-row">
          <h4 className="detail-heading">기술</h4>
          <button
            className="detail-history-button"
            type="button"
            aria-expanded={techHistoryOpen}
            aria-controls="tech-history-panel"
            onClick={toggleTechHistory}
          >
            {techHistoryOpen ? '연혁 닫기' : '연혁 보기'}
          </button>
        </div>
        <div className="detail-body">
          <p className="detail-body-text">{tech.tech_description || '(설명 없음)'}</p>
          <span className="detail-body-meta">
            적용시기 {techApplyDate?.slice(0, 7)}
            {techElapsedMonths != null && (
              <span className="elapsed-badge">({formatElapsed(techElapsedMonths)})</span>
            )}
          </span>
        </div>

        <div
          id="tech-history-panel"
          className={`toggle-section-body collapsible-history ${techHistoryOpen ? 'is-open' : ''}`}
          aria-hidden={!techHistoryOpen}
        >
          <div className="history-timeline">
            {historyEntries.map((entry, index) => {
              const { row } = entry
              const noContentChange = !entry.isFirst && !entry.nameChanged && !entry.descChanged && !entry.statusChanged

              return (
                <article key={`${row.version}-${row.apply_date}-${index}`} className="history-entry">
                  <div className="history-marker" aria-hidden="true">
                    <span className="history-dot" />
                    {index < historyEntries.length - 1 && <span className="history-line" />}
                  </div>
                  <div className="history-content">
                    <div className="history-meta">
                      <span className="history-date">{formatMonth(row.apply_date)}</span>
                      <span className={`history-status ${statusClass(row.status)}`}>{statusLabel(row.status)}</span>
                      {!entry.isFirst && entry.descRewrite && (
                        <span className="history-status history-status--rewrite">전면개정</span>
                      )}
                      <span className="history-version">{formatVersion(row.version)}</span>
                    </div>

                    {row.status === '삭제' ? null : entry.isFirst ? (
                      <div className="history-block">
                        <p className="history-tech-name">{row.tech_name}</p>
                        <p className="history-description">{row.tech_description || '(설명 없음)'}</p>
                      </div>
                    ) : (
                      <div className="history-block">
                        {entry.nameChanged ? (
                          <DiffDisplay parts={entry.nameDiff} className="history-tech-name" />
                        ) : (
                          <p className="history-tech-name">{row.tech_name}</p>
                        )}
                        {entry.descChanged && (
                          entry.descRewrite
                            ? <p className="history-description">{row.tech_description || '(설명 없음)'}</p>
                            : <DiffDisplay parts={entry.descDiff} />
                        )}
                        {noContentChange && (
                          <p className="history-empty">내용 변경 없음</p>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </div>

        {hasRelated && (
          <div className="related-subsection">
            <button
              className="history-toggle"
              type="button"
              aria-expanded={relatedOpen}
              onClick={() => setRelatedOpen((open) => !open)}
            >
              <span className={`history-chevron ${relatedOpen ? 'is-open' : ''}`}>›</span>
              <span>{relatedTitle(sector.type)}</span>
              <CountBadge count={relatedCount} />
            </button>

            {relatedOpen && (
              <div className="toggle-section-body related-section-body">
                {related?.promoted && (
                  <div className="promoted-note">{promotedMessage(sector.type)}</div>
                )}
                <div className="related-list">
                  {relatedItems.map((item) => (
                    <button
                      key={item._crossKey}
                      type="button"
                      className={`related-item related-item--${item._type}`}
                      onClick={() => onRelatedTechSelect(item, item._type)}
                    >
                      <span className={`dataset-tag dataset-tag--${item._type} related-item-tag`}>
                        {datasetLabel(item._type)}
                      </span>
                      <span className="related-item-body">
                        <span className="related-item-name-row">
                          <span className="related-item-name">
                            <HighlightedSimilarity text={item.tech_name} reference={tech.tech_name} />
                          </span>
                        </span>
                        {item.tech_description && (
                          <span className="related-item-desc">
                            <HighlightedSimilarity text={item.tech_description} reference={tech.tech_description || ''} />
                          </span>
                        )}
                        <span className="related-item-sector">
                          <span className="related-sector-icon" aria-hidden="true">{sectorIcon(item.sector_key)}</span>
                          <span>{relatedSectorLabel(item)}</span>
                        </span>
                      </span>
                      <span className="related-item-arrow">›</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="detail-section">
        <div className="detail-heading-row">
          <h4 className="detail-heading">
            사업화 시설 <CountBadge count={facilities.length} />
          </h4>
          {facilityHistoryGroups.length > 0 && (
            <button
              className="detail-history-button"
              type="button"
              aria-expanded={facilityHistoryOpen}
              aria-controls="facility-history-panel"
              onClick={toggleFacilityHistory}
            >
              {facilityHistoryOpen ? '연혁 닫기' : '연혁 보기'}
            </button>
          )}
        </div>
        {facilities.length === 0 ? (
          <div className="empty-msg small">이 기술에 매칭되는 현행 사업화시설이 없습니다.</div>
        ) : (
          <ul className="facility-list">
            {facilities.map((f, i) => (
              <li key={i} className="facility-item">
                <p className="facility-desc">{f.facility_description}</p>
                <span className="facility-meta">
                  적용시기 {f.apply_date?.slice(0, 7)}
                  {f.elapsed_months != null && (
                    <span className="elapsed-badge">({formatElapsed(f.elapsed_months)})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {facilityHistoryGroups.length > 0 && (
          <div
            id="facility-history-panel"
            className={`facility-history collapsible-history ${facilityHistoryOpen ? 'is-open' : ''}`}
            aria-hidden={!facilityHistoryOpen}
          >
            <div className="facility-history-groups">
              {facilityHistoryGroups.map((group) => (
                <section key={group.key} className="facility-history-group">
                  {facilityHistoryGroups.length > 1 && (
                    <h5 className="facility-history-title">{group.title}</h5>
                  )}
                  <div className="history-timeline">
                    {group.entries.map((entry, index) => {
                      const { row } = entry
                      const noContentChange = !entry.isFirst && !entry.descChanged && !entry.statusChanged

                      return (
                        <article key={`${row.version}-${row.apply_date}-${index}`} className="history-entry">
                          <div className="history-marker" aria-hidden="true">
                            <span className="history-dot" />
                            {index < group.entries.length - 1 && <span className="history-line" />}
                          </div>
                          <div className="history-content">
                            <div className="history-meta">
                              <span className="history-date">{formatMonth(row.apply_date)}</span>
                              <span className={`history-status ${statusClass(row.status)}`}>{statusLabel(row.status)}</span>
                              {!entry.isFirst && entry.descRewrite && (
                                <span className="history-status history-status--rewrite">전면개정</span>
                              )}
                              <span className="history-version">{formatVersion(row.version)}</span>
                            </div>

                            {row.status === '삭제' ? null : entry.isFirst ? (
                              <div className="history-block">
                                <p className="history-description">{row.facility_description || '(시설 설명 없음)'}</p>
                              </div>
                            ) : (
                              <div className="history-block">
                                {entry.descChanged && (
                                  entry.descRewrite
                                    ? <p className="history-description">{row.facility_description || '(시설 설명 없음)'}</p>
                                    : <DiffDisplay parts={entry.descDiff} />
                                )}
                                {noContentChange && (
                                  <p className="history-empty">내용 변경 없음</p>
                                )}
                              </div>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      <nav className="detail-pager" aria-label="기술 탐색">
        <button
          type="button"
          className="detail-pager-btn detail-pager-btn--prev"
          disabled={!prevTech}
          onClick={() => prevTech && onNavigateTech(prevTech)}
        >
          <span className="detail-pager-arrow" aria-hidden="true">‹</span>
          <span className="detail-pager-text">
            <span className="detail-pager-direction">이전 기술</span>
            <span className="detail-pager-name">{prevTech?.tech_name || '없음'}</span>
          </span>
        </button>
        <button
          type="button"
          className="detail-pager-btn detail-pager-btn--next"
          disabled={!nextTech}
          onClick={() => nextTech && onNavigateTech(nextTech)}
        >
          <span className="detail-pager-text">
            <span className="detail-pager-direction">다음 기술</span>
            <span className="detail-pager-name">{nextTech?.tech_name || '없음'}</span>
          </span>
          <span className="detail-pager-arrow" aria-hidden="true">›</span>
        </button>
      </nav>
    </div>
  )
}
