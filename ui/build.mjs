import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
// Blockly loads its sprites and cursors from a media folder; point it at /blockly-media/ (see src/webui.mjs) instead of the default CDN.
const blocklyMedia = ['sprites.png', 'handopen.cur', 'handclosed.cur', 'handdelete.cur', 'delete-icon.svg', 'dropdown-arrow.svg', 'foldout-icon.svg', 'resize-handle.svg', '1x1.gif', 'pilcrow.png', 'quote0.png', 'quote1.png'];
const fonts = [
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter.woff2'],
  ['@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', 'mono.woff2'],
];

// Builds the console into `outdir`: app.js (esbuild), blocks.js (the Blockly block editor, loaded on demand by the Bot page),
// app.css (Tailwind), theme.css (tokens) and fonts. `transform` post-processes the JavaScript bundles.
export async function buildUI({ outdir = join(root, 'web'), transform = code => code, logLevel = 'info' } = {}) {
  await mkdir(join(outdir, 'fonts'), { recursive: true });
  const result = await build({ absWorkingDir: root, entryPoints: ['ui/main.tsx'], outfile: join(outdir, 'app.js'),
    bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', target: ['es2022'], jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', logLevel });
  // The block editor is a separate bundle: Blockly is large and only the Bot page needs it. Everything is bundled locally (no CDN).
  const editor = await build({ absWorkingDir: root, entryPoints: ['ui/blocks/editor.ts'], outfile: join(outdir, 'blocks.js'),
    bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', target: ['es2022'],
    define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel });
  for (const file of [...result.outputFiles, ...editor.outputFiles]) await writeFile(file.path, file.path.endsWith('.js') ? transform(file.text) : file.contents);
  const tailwind = join(dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
  await promisify(execFile)(process.execPath, [tailwind, '--input', 'ui/styles.css', '--output', join(outdir, 'app.css'), '--minify'], { cwd: root });
  // Design tokens are served on their own (/theme.css) so both pages paint the right theme before the bundle loads.
  await copyFile(join(root, 'ui/theme.css'), join(outdir, 'theme.css'));
  for (const [source, name] of fonts) await copyFile(require.resolve(source), join(outdir, 'fonts', name));
  await mkdir(join(outdir, 'blockly-media'), { recursive: true });
  const blocklyDir = join(dirname(require.resolve('blockly')), 'media');
  for (const name of blocklyMedia) await copyFile(join(blocklyDir, name), join(outdir, 'blockly-media', name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildUI();
