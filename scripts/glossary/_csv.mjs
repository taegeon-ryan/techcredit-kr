// 최소 CSV 파서/생성기 — 따옴표 이스케이프(""), 멀티라인 필드, BOM 처리
export function parseCsv(text) {
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
  if (!rows.length) return { header: [], rows: [] }
  const header = rows.shift()
  const data = rows
    .filter(r => r.some(x => x && x.length > 0))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
  return { header, rows: data }
}

function quote(v) {
  const s = v == null ? '' : String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function writeCsv(header, rows) {
  const lines = [header.map(quote).join(',')]
  for (const r of rows) {
    lines.push(header.map(h => quote(r[h])).join(','))
  }
  return lines.join('\n') + '\n'
}
