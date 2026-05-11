import { useMemo } from 'react'
import { getRelatedSectors } from '../utils/crossCategoryMap'
import { sectorIcon } from '../utils/sectorIcons'
import { AGE_FILTERS, SORT_OPTIONS, compareTechs, techRowKey } from '../utils/techOrdering'
import { getSectorsByType, sectorDisplayName } from '../utils/sectorOrdering'

function datasetFullLabel(type) {
  return type === 'growth' ? '신성장' : '전략'
}

function collectSectors(rows) {
  const map = new Map()
  for (const row of rows) {
    if (!row.current || row.status === '삭제') continue
    if (!map.has(row.sector_key)) {
      map.set(row.sector_key, {
        key: row.sector_key,
        name: row.sector_name,
        sectorKey: row.sector_key,
        sectorNumber: parseInt(row.sector_number, 10) || 999,
      })
    }
  }
  return map
}

function ageTag(row) {
  const label = row.first_apply_date ? row.first_apply_date.slice(0, 7) : ''
  if (!label) return null
  if (row.introduced_elapsed_months >= 60) return { label, level: '5y' }
  if (row.introduced_elapsed_months >= 36) return { label, level: '3y' }
  return { label, level: 'recent' }
}

export default function TechList({ data, sector, controls, onControlsChange, onBack, onSelect, onRelatedSectorSelect, onNavigateSector }) {
  const { ageFilter, includeDeleted, sortBy } = controls
  const key = sector.type === 'growth' ? 'growth_tech' : 'strategic_tech'
  const rows = data[key]
  const relatedType = sector.type === 'growth' ? 'strategic' : 'growth'

  const filteredRows = useMemo(() => {
    const targetSectorKey = sector.key.split('::')[1]
    const selectedAge = AGE_FILTERS.find((f) => f.value === ageFilter)
    const minMonths = selectedAge?.minMonths || 0

    return rows
      .filter((r) => r.current && r.sector_key === targetSectorKey)
      .filter((r) => !r.renumbered_deletion)
      .filter((r) => minMonths === 0 || r.introduced_elapsed_months >= minMonths)
  }, [rows, sector, ageFilter])

  const counts = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        if (row.status === '삭제') acc.deleted += 1
        else acc.active += 1
        return acc
      },
      { active: 0, deleted: 0 }
    )
  }, [filteredRows])

  const techs = useMemo(() => {
    return filteredRows
      .filter((r) => includeDeleted || r.status !== '삭제')
      .sort(compareTechs(sortBy))
  }, [filteredRows, includeDeleted, sortBy])

  const groups = useMemo(() => {
    if (sector.type !== 'growth' || sortBy !== 'statute') return null
    // 같은 prefix(가./나./...)는 한 그룹으로 합치고, 가장 최신 apply_date의 표기를 대표 이름으로 사용
    const map = new Map()
    for (const t of techs) {
      const sub = t.subsector || ''
      const match = sub.match(/^([가-힣])\./)
      const prefix = match ? match[1] : sub
      const date = t.apply_date || ''
      if (!map.has(prefix)) {
        map.set(prefix, { label: sub, labelDate: date, items: [t] })
      } else {
        const g = map.get(prefix)
        g.items.push(t)
        if (date > g.labelDate) { g.label = sub; g.labelDate = date }
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'ko'))
      .map(([, g]) => [g.label, g.items])
  }, [techs, sector.type, sortBy])

  const { prevSector, nextSector } = useMemo(() => {
    const siblings = getSectorsByType(data, sector.type)
    const index = siblings.findIndex((s) => s.sectorKey === sector.sectorKey)
    return {
      prevSector: index > 0 ? siblings[index - 1] : null,
      nextSector: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null,
    }
  }, [data, sector.type, sector.sectorKey])

  const relatedSectors = useMemo(() => {
    const relatedRows = relatedType === 'growth' ? data.growth_tech : data.strategic_tech
    const sectorMap = collectSectors(relatedRows)
    return getRelatedSectors(sector.sectorKey, sector.type)
      .map((sectorKey) => sectorMap.get(sectorKey))
      .filter(Boolean)
      .map((related) => ({
        ...related,
        key: `${relatedType}::${related.sectorKey}`,
        type: relatedType,
      }))
      .sort((a, b) => a.sectorNumber - b.sectorNumber)
  }, [data, relatedType, sector.sectorKey, sector.type])

  const renderTech = (t, i) => {
    const tag = ageTag(t)
    const deleted = t.status === '삭제'

    return (
      <button
        key={techRowKey(t)}
        className={`tech-item tech-item--${sector.type}${deleted ? ' tech-item--deleted' : ''}`}
        style={{ '--item-delay': `${Math.min(i * 12, 120)}ms` }}
        onClick={() => onSelect(t)}
      >
        <span className="tech-item-index">{i + 1}.</span>
        <span className="tech-item-main">
          <span className="tech-item-name">{t.tech_name}</span>
          <span className="tech-item-badges">
            {tag && <span className={`tech-age-badge tech-age-badge--${tag.level}`}>{tag.label}</span>}
            {deleted && <span className="tech-status-badge">폐지</span>}
          </span>
        </span>
        <span className="tech-item-arrow">›</span>
      </button>
    )
  }

  return (
    <div className="drill-view">
      <div className="drill-header">
        <button className="back-btn" onClick={onBack}>← 분야 목록</button>
        <div className="drill-title-wrap">
          <span className={`dataset-tag dataset-tag--${sector.type}`}>
            {sector.type === 'growth' ? '신성장' : '전략'}
          </span>
          <h2 className="drill-title drill-title--with-icon">
            <span className="drill-title-icon" aria-hidden="true">{sectorIcon(sector.sectorKey)}</span>
            <span>{sector.name}</span>
          </h2>
          <span className="drill-count">
            <span>{counts.active}건</span>
            <span className="drill-deleted-count">폐지 {counts.deleted}건</span>
          </span>
          {relatedSectors.length > 0 && (
            <div className="tech-list-related">
              <span className="tech-list-related-label" aria-label="연관 분야" />
              <span className={`dataset-tag dataset-tag--${relatedType}`}>
                {datasetFullLabel(relatedType)}
              </span>
              <span className="tech-list-related-sectors">
                {relatedSectors.map((related) => (
                  <button
                    key={related.key}
                    type="button"
                    className={`tech-list-related-sector tech-list-related-sector--${related.type}`}
                    onClick={() => onRelatedSectorSelect(related)}
                  >
                    <span className="tech-list-related-icon" aria-hidden="true">{sectorIcon(related.sectorKey)}</span>
                    <span>{related.name}</span>
                  </button>
                ))}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="tech-controls">
        <div
          className="tech-filter-group"
          aria-label="도입 기간 필터"
          style={{
            '--filter-index': AGE_FILTERS.findIndex((f) => f.value === ageFilter),
            '--filter-color': ageFilter === '3y' ? '#dbeafe' : ageFilter === '5y' ? '#fef3c7' : '#f8fafc',
            '--filter-text': ageFilter === '3y' ? '#1d4ed8' : ageFilter === '5y' ? '#92400e' : 'var(--text)',
          }}
        >
          {AGE_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`tech-filter-btn tech-filter-btn--${f.value}${ageFilter === f.value ? ' active' : ''}`}
              onClick={() => onControlsChange({ ageFilter: f.value })}
            >
              {f.label}
            </button>
          ))}
        </div>

        <label className="deleted-toggle">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => onControlsChange({ includeDeleted: e.target.checked })}
          />
          <span className="deleted-toggle-box" aria-hidden="true" />
          <span>폐지 포함</span>
        </label>

        <label className="sort-control">
          <span>정렬</span>
          <select value={sortBy} onChange={(e) => onControlsChange({ sortBy: e.target.value })}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div key={`${ageFilter}-${includeDeleted}-${sortBy}`} className="tech-list">
        {groups ? (
          groups.map(([subsector, items]) => (
            <div key={subsector} className="subsector-group">
              {subsector && <div className="subsector-heading">{subsector}</div>}
              {items.map(renderTech)}
            </div>
          ))
        ) : (
          techs.map(renderTech)
        )}
        {techs.length === 0 && <div className="empty-msg">해당 조건의 기술이 없습니다.</div>}
      </div>

      <nav className="detail-pager" aria-label="분야 탐색">
        <button
          type="button"
          className="detail-pager-btn detail-pager-btn--prev"
          disabled={!prevSector}
          onClick={() => prevSector && onNavigateSector(prevSector)}
        >
          <span className="detail-pager-arrow" aria-hidden="true">‹</span>
          <span className="detail-pager-text">
            <span className="detail-pager-direction">이전 분야</span>
            <span className="detail-pager-name">
              {prevSector
                ? `${sectorIcon(prevSector.sectorKey)} ${sectorDisplayName(prevSector.name)}`
                : '없음'}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="detail-pager-btn detail-pager-btn--next"
          disabled={!nextSector}
          onClick={() => nextSector && onNavigateSector(nextSector)}
        >
          <span className="detail-pager-text">
            <span className="detail-pager-direction">다음 분야</span>
            <span className="detail-pager-name">
              {nextSector
                ? `${sectorIcon(nextSector.sectorKey)} ${sectorDisplayName(nextSector.name)}`
                : '없음'}
            </span>
          </span>
          <span className="detail-pager-arrow" aria-hidden="true">›</span>
        </button>
      </nav>
    </div>
  )
}
