import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const dashboardDir = resolve(scriptDir, '..')
const source = resolve(dashboardDir, '../input/manual_relations.csv')
const target = resolve(dashboardDir, 'public/data/manual_relations.csv')

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)

console.log(`copied ${source} -> ${target}`)
