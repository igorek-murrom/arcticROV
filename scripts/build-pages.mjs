import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function buildPages(output = new URL('../dist/', import.meta.url)) {
  const root = new URL('../', import.meta.url);
  await mkdir(output, { recursive: true });
  await cp(new URL('public/', root), output, { recursive: true });
  await cp(new URL('shared/', root), new URL('shared/', output), { recursive: true });
  const html = (await readFile(new URL('public/index.html', root), 'utf8'))
    .replaceAll('href="/"', 'href="./"').replaceAll('href="/styles.css"', 'href="./styles.css"')
    .replaceAll('src="/app.mjs"', 'src="./app.mjs"')
    .replace('</head>', '<link rel="stylesheet" href="./demo.css"></head>')
    .replace('v0.1.1', 'v0.2.0 · WEB-ДЕМО');
  await writeFile(new URL('index.html', output), html);
  await writeFile(new URL('runtime.mjs', output), 'export const demoMode = true;\n');
  await writeFile(new URL('.nojekyll', output), '');
  return fileURLToPath(output);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log('GitHub Pages demo:', await buildPages());
