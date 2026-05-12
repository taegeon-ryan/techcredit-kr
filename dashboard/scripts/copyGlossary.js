import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const dashboardDir = resolve(scriptDir, '..')
const source = resolve(dashboardDir, '../input/glossary_source.json')
const target = resolve(dashboardDir, 'public/data/glossary.json')

mkdirSync(dirname(target), { recursive: true })
if (existsSync(source)) {
  copyFileSync(source, target)
  console.log(`copied ${source} -> ${target}`)
} else {
  writeFileSync(target, '[]\n', 'utf8')
  console.log(`no glossary source yet; wrote empty array -> ${target}`)
}
