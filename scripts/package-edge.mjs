import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const distDir = resolve(rootDir, 'dist')
const outputDir = resolve(rootDir, 'artifacts', 'edge')
const packageJson = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'))
const version = packageJson.version

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  throw new Error('Missing dist/ directory. Run `npm run build` before packaging.')
}

mkdirSync(outputDir, { recursive: true })

const archiveName = `actioncap-edge-v${version}.zip`
const archivePath = resolve(outputDir, archiveName)
const checksumPath = `${archivePath}.sha256`

rmSync(archivePath, { force: true })
rmSync(checksumPath, { force: true })

const zip = spawnSync('zip', ['-qr', archivePath, '.', '-x', '.DS_Store', '**/.DS_Store'], {
  cwd: distDir,
  encoding: 'utf8',
})

if (zip.status !== 0) {
  const stderr = zip.stderr?.trim()
  const stdout = zip.stdout?.trim()
  throw new Error(`zip failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`)
}

const archiveBuffer = readFileSync(archivePath)
const checksum = createHash('sha256').update(archiveBuffer).digest('hex')
writeFileSync(checksumPath, `${checksum}  ${archiveName}\n`)

console.log(`Created ${archivePath}`)
console.log(`Wrote ${checksumPath}`)
