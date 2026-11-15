import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const fonts = [
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter.woff2'],
  ['@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', 'mono.woff2'],
];

// Builds the console into `outdir`: app.js (esbuild), app.css (Tailwind), theme.css (tokens) and fonts.
// `transform` post-processes the JavaScript bundle.
export async function buildUI({ outdir = join(root, 'web'), transform = code => code, logLevel = 'info' } = {}) {
  await mkdir(join(outdir, 'fonts'), { recursive: true });
  const result = await build({ absWorkingDir: root, entryPoints: ['ui/main.tsx'], outfile: join(outdir, 'app.js'),
    bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', target: ['es2022'], jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', logLevel });
  for (const file of result.outputFiles) await writeFile(file.path, file.path.endsWith('.js') ? transform(file.text) : file.contents);
  const tailwind = join(dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
  await promisify(execFile)(process.execPath, [tailwind, '--input', 'ui/styles.css', '--output', join(outdir, 'app.css'), '--minify'], { cwd: root });
  // Design tokens are served on their own (/theme.css) so both pages paint the right theme before the bundle loads.
  await copyFile(join(root, 'ui/theme.css'), join(outdir, 'theme.css'));
  for (const [source, name] of fonts) await copyFile(require.resolve(source), join(outdir, 'fonts', name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildUI();
