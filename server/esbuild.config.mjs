// Bundles the server into ONE file, dist/index.js, before `mapps code:push`.
// Why: monday code only receives the server/ folder, so the shared game rules in ../src
// must be copied into the bundle. npm packages stay external: the buildpack installs them
// from package.json on monday code.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external', // only npm packages; our own ../src files (and @app/*) are bundled
  sourcemap: true,
  tsconfig: 'tsconfig.json', // makes esbuild honour the @app/* path alias
  logLevel: 'info',
})
