/**
 * Bundle build wrapper. Runs the local `tsdown` CLI after switching the
 * process code page to UTF-8 on Windows locales whose ANSI code page is not
 * UTF-8 (e.g. CP936 on zh-CN systems), where tsdown/rolldown reads source
 * files honoring the code page and would otherwise corrupt UTF-8 Chinese
 * product copy in the emitted bundles. No-op on POSIX, where the locale is
 * already UTF-8.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

if (platform() === 'win32') {
  spawnSync('chcp', ['65001'], { stdio: 'ignore' })
}

const require = createRequire(import.meta.url)
const cliPath = join(dirname(require.resolve('tsdown/package.json')), 'dist/run.mjs')

const result = spawnSync(process.execPath, [cliPath], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
