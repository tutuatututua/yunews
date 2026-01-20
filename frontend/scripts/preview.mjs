import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = join(here, '..')

const port = process.env.PORT ?? '5173'
const host = '0.0.0.0'

const viteBin = process.platform === 'win32' ? 'vite.cmd' : 'vite'
const vitePath = join(rootDir, 'node_modules', '.bin', viteBin)

const args = ['preview', '--host', host, '--port', port]

const child =
  process.platform === 'win32'
    ? spawn(vitePath, args, {
        cwd: rootDir,
        stdio: 'inherit',
        env: process.env,
        shell: true,
      })
    : spawn(vitePath, args, {
        cwd: rootDir,
        stdio: 'inherit',
        env: process.env,
      })

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
