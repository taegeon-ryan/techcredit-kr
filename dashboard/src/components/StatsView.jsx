import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ReferenceLine,
} from 'recharts'
import { sectorIcon } from '../utils/sectorIcons'

const COLORS = { growth: 'var(--growth)', strategic: 'var(--strategic)' }
const CHART_TEXT = 'var(--text-muted)'
const CHART_BORDER = 'var(--border)'
const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  boxShadow: 'var(--shadow-sm)',
}
const TOOLTIP_LABEL_STYLE = { color: 'var(--text)' }

function CustomYTick({ x, y, payload, sectorData }) {
  const entry = sectorData.find((d) => d.name === payload.value)
  const icon = entry ? sectorIcon(entry.sectorKey) : '📦'
  const label = payload.value?.length > 12 ? payload.value.slice(0, 11) + '…' : payload.value
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={-4} y={0} textAnchor="end" dominantBaseline="middle" fontSize={12} fill={CHART_TEXT}>
        {icon} {label}
      </text>
    </g>
  )
}

function korPrefix(s) {
  const m = (s || '').match(/^[\uAC00-\uD7A3]/)
  return m ? m[0] : ''
}

export default function StatsView({ data, filter }) {
  const color = COLORS[filter]
  const label = filter === 'strategic' ? '국가전략기술' : '신성장·원천기술'

  const sectorChart = useMemo(() => {
    const key = filter === 'strategic' ? 'strategic_tech' : 'growth_tech'
    const active = data[key].filter((r) => r.current && r.status !== '삭제')
    const map = new Map()
    active.forEach((r) => {
      if (!map.has(r.sector_key)) {
        map.set(r.sector_key, {
          name: r.sector_name,
          sectorKey: r.sector_key,
          sectorNumber: parseInt(r.sector_number, 10) || 999,
          count: 0,
        })
      }
      map.get(r.sector_key).count++
    })
    return Array.from(map.values()).sort((a, b) => a.sectorNumber - b.sectorNumber)
  }, [data, filter])

  const timelineChart = useMemo(() => {
    const isStrategic = filter === 'strategic'
    const key = isStrategic ? 'strategic_tech' : 'growth_tech'
    const rows = data[key]

    const techId = (r) =>
      isStrategic
        ? `${r.sector_number}|${r.item_no}`
        : `${r.sector_number}|${korPrefix(r.subsector)}|${r.item_no}`

    // 각 version마다 스냅샷 기술 수 계산 후 version연도(20YY)로 그룹화
    const versions = [...new Set(rows.map((r) => r.version))].sort()
    const byYear = new Map()

    versions.forEach((v) => {
      const byId = new Map()
      rows.forEach((r) => {
        if (r.version <= v) {
          const id = techId(r)
          if (!byId.has(id) || r.version > byId.get(id).version) byId.set(id, r)
        }
      })
      const count = [...byId.values()].filter((r) => r.status !== '삭제').length
      const year = '20' + v.slice(0, 2)
      if (!byYear.has(year) || v > byYear.get(year).version) {
        byYear.set(year, { version: v, count })
      }
    })

    const years = [...byYear.keys()].sort()
    if (years.length === 0) return []
    const minY = parseInt(years[0], 10)
    const maxY = parseInt(years[years.length - 1], 10)

    let lastCount = 0
    const result = []
    for (let y = minY; y <= maxY; y++) {
      const ys = String(y)
      if (byYear.has(ys)) lastCount = byYear.get(ys).count
      result.push({ year: ys, 기술수: lastCount })
    }
    return result
  }, [data, filter])

  const barHeight = Math.max(320, sectorChart.length * 40)

  const timelineMin = useMemo(() => {
    if (timelineChart.length === 0) return 0
    const min = Math.min(...timelineChart.map((d) => d['기술수']))
    return Math.floor(min * 0.88)
  }, [timelineChart])

  const yAxisTicks = filter === 'growth' ? [100, 150, 200, 250, 300] : undefined
  const yAxisDomain = filter === 'growth' ? [80, 320] : [timelineMin, 'auto']

  return (
    <div className="stats-view">
      <div className="chart-card">
        <h3 className="chart-title">분야별 기술 수 — {label}</h3>
        <ResponsiveContainer width="100%" height={barHeight}>
          <BarChart data={sectorChart} layout="vertical" margin={{ top: 4, right: 30, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_BORDER} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: CHART_TEXT }} />
            <YAxis
              type="category"
              dataKey="name"
              width={180}
              tick={(props) => <CustomYTick {...props} sectorData={sectorChart} />}
            />
            <Tooltip
              formatter={(v) => [`${v}개 기술`, '']}
              separator=""
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
            />
            <Bar dataKey="count" fill={color} radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3 className="chart-title">연도별 기술 수 — {label}</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={timelineChart} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="fillCum" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_BORDER} />
            <XAxis dataKey="year" tick={{ fontSize: 12, fill: CHART_TEXT }} />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12, fill: CHART_TEXT }}
              domain={yAxisDomain}
              ticks={yAxisTicks}
              tickFormatter={filter === 'growth' ? undefined : (v) => v === timelineMin ? '≈' : String(v)}
            />
            <Tooltip
              formatter={(v) => [`${v}개 기술`, '']}
              labelFormatter={(l) => `${l}년`}
              separator=""
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
            />
            {timelineChart.map((d) => (
              <ReferenceLine key={d.year} x={d.year} stroke={CHART_BORDER} strokeDasharray="3 3" />
            ))}
            <Area
              type="monotone"
              dataKey="기술수"
              stroke={color}
              strokeWidth={2.5}
              fill="url(#fillCum)"
              dot={{ r: 3, fill: color }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
