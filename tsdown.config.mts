import { defineConfig } from 'tsdown';
import type { UserConfig } from 'tsdown';

const shared: UserConfig = {
    format: ['esm', 'cjs'],
    target: 'es2022',
    outDir: 'dist',
    // Two configs write to dist, so neither clears it; `npm run build` does that first.
    clean: false,
    // Pin extensions so `exports` cannot drift: .cjs = CommonJS, .mjs = ESM.
    outExtensions: ({ format }) =>
        format === 'cjs' ? { js: '.cjs', dts: '.d.cts' } : { js: '.mjs', dts: '.d.mts' },
    dts: true,
    sourcemap: true,
    treeshake: true,
    unbundle: false,
};

export default defineConfig([
    {
        ...shared,
        entry: ['src/index.ts'],
        // Universal: no Node built-ins are used, so the same output runs in
        // Node, browsers, Deno, Bun and edge runtimes.
        platform: 'neutral',
    },
    {
        ...shared,
        // The one Node-only entry: a source that reads an install folder with node:fs.
        entry: ['src/node.ts'],
        platform: 'node',
    },
]);
