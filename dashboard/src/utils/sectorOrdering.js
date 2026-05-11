const SHORT_NAME = {
  '차세대소프트웨어(SW) 및 보안': '차세대SW 및 보안',
  '차세대SW(소프트웨어) 및 보안': '차세대SW 및 보안',
}

export function sectorDisplayName(name) {
  return SHORT_NAME[name] ?? name
}

export function getSectorsByType(data, type) {
  const rows = type === 'growth' ? data.growth_tech : data.strategic_tech
  const map = new Map()
  for (const r of rows) {
    if (!r.current || r.status === '삭제') continue
    if (map.has(r.sector_key)) continue
    map.set(r.sector_key, {
      key: `${type}::${r.sector_key}`,
      type,
      name: r.sector_name,
      sectorKey: r.sector_key,
      sectorNumber: parseInt(r.sector_number, 10) || 999,
    })
  }
  return Array.from(map.values()).sort((a, b) => a.sectorNumber - b.sectorNumber)
}
