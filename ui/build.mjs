import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await build({ absWorkingDir: root, entryPoints: ['ui/main.jsx'], outfile: 'web/app.js',
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: ['es2022'], jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', logLevel: 'info' });
// Design tokens are served on their own (/theme.css) so both pages paint the right theme before the bundle loads.
await copyFile(new URL('theme.css', import.meta.url), new URL('../web/theme.css', import.meta.url));
