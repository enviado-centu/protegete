// Bundles the extension's content scripts as classic IIFEs into
// dist-extension/, run AFTER `vite build --config vite.extension.config.ts`
// (see package.json's build:ext). Vite/Rollup can't cleanly emit IIFE for
// independent entry points alongside the existing ESM background/sidepanel
// build in one config, so this uses esbuild's JS API directly instead.
//
// Runs second (after vite, which owns emptyOutDir), so it only adds files
// to the already-created dist-extension/ and never wipes it.

import * as esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))

const entries = [
  { in: 'src/extension/page-probe-main.ts', out: 'dist-extension/page-probe-main.js' },
  { in: 'src/extension/page-probe.ts', out: 'dist-extension/page-probe.js' },
]

for (const entry of entries) {
  await esbuild.build({
    entryPoints: [path.join(root, entry.in)],
    outfile: path.join(root, entry.out),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
  })
  console.log(`built ${entry.out}`)
}
