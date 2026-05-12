import { useMemo } from 'react'
import { sectorIcon } from '../utils/sectorIcons'

const SHORT_NAME = {
  '차세대소프트웨어(SW) 및 보안': '차세대SW 및 보안',
  '차세대SW(소프트웨어) 및 보안': '차세대SW 및 보안',
}

function displayName(name) {
  return SHORT_NAME[name] ?? name
}

function aggregateSectors(data) {
  const map = new Map()

  function add(rows, type) {
    const active = rows.filter((r) => r.current && r.status !== '삭제')
    for (const r of active) {
      const key = `${type}::${r.sector_key}`
      if (!map.has(key)) {
        map.set(key, {
          key,
          type,
          name: r.sector_name,
          sectorKey: r.sector_key,
          sectorNumber: parseInt(r.sector_number, 10) || 999,
          techCount: 0,
          facilityCount: 0,
          firstApplyDate: r.first_apply_date || r.apply_date || '',
        })
      }
      const sector = map.get(key)
      sector.techCount++
      const firstDate = r.first_apply_date || r.apply_date || ''
      if (firstDate && (!sector.firstApplyDate || firstDate < sector.firstApplyDate)) {
        sector.firstApplyDate = firstDate
      }
    }
  }

  function addFacility(rows, type) {
    const active = rows.filter((r) => r.current && r.status !== '삭제')
    for (const r of active) {
      const key = `${type}::${r.sector_key}`
      if (map.has(key)) map.get(key).facilityCount++
    }
  }

  add(data.growth_tech, 'growth')
  add(data.strategic_tech, 'strategic')
  addFacility(data.growth_facility, 'growth')
  addFacility(data.strategic_facility, 'strategic')

  return Array.from(map.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'strategic' ? -1 : 1
    return a.sectorNumber - b.sectorNumber
  })
}

export default function SectorCards({ data, filter, onSelect }) {
  const sectors = useMemo(() => aggregateSectors(data), [data])
  const filtered = sectors.filter((s) => s.type === filter)

  return (
    <div className="sector-grid">
      {filtered.map((s, i) => (
        <button
          key={s.key}
          className={`sector-card sector-card--${s.type}`}
          onClick={() => onSelect(s)}
        >
          <div className="sector-card-top">
            <span className="sector-icon">{sectorIcon(s.sectorKey)}</span>
            <span className="sector-card-meta">
              <span className={`dataset-tag dataset-tag--${s.type}`}>
                {s.type === 'growth' ? '신성장' : '전략'}
              </span>
              {s.firstApplyDate && <span className="sector-year">{s.firstApplyDate.slice(0, 4)}</span>}
            </span>
          </div>
          <div className="sector-card-body">
            <h3 className="sector-card-name">
              <span className="sector-card-num">{i + 1}.</span> {displayName(s.name)}
            </h3>
            <div className="sector-stat sector-stat--primary">
              <span className="sector-stat-num">{s.techCount}</span>
              <span className="sector-stat-label">기술</span>
            </div>
          </div>
        </button>
      ))}
      {filtered.length === 0 && <div className="empty-msg">해당 조건의 분야가 없습니다.</div>}
    </div>
  )
}
