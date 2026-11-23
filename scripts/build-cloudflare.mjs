import { copyFile, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const assets = JSON.parse(await readFile(path.join(root, 'cloudflare/public-assets.json'), 'utf8'));
const allowedExtensions = new Set(['.html', '.css', '.js', '.png', '.svg', '.webmanifest']);

// A lista é revisada no Git: arquivos novos na raiz não se tornam públicos automaticamente.
for (const asset of assets) {
  if (
    typeof asset !== 'string' ||
    asset.split('/').some((part) => !part || part.startsWith('.')) ||
    asset.includes('\\') ||
    !allowedExtensions.has(path.extname(asset)) ||
    (asset.includes('/') && !/^(icons|vendor)\/[^/]+$/.test(asset))
  ) {
    throw new Error(`Arquivo público inválido: ${asset}`);
  }
  // Recusar links simbólicos, inclusive nos diretórios intermediários.
  let source = root;
  for (const part of asset.split('/')) {
    source = path.join(source, part);
    if ((await lstat(source)).isSymbolicLink()) throw new Error(`Link simbólico recusado: ${asset}`);
  }
  if (!(await lstat(source)).isFile()) throw new Error(`Arquivo público ausente: ${asset}`);
}

function requireAsset(rawPath) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(rawPath)) return;
  const asset = rawPath.split(/[?#]/, 1)[0].replace(/^\//, '');
  if (asset && !assets.includes(asset)) throw new Error(`Dependência ausente da lista pública: ${asset}`);
}

const index = await readFile(path.join(root, 'index.html'), 'utf8');
for (const match of index.matchAll(/(?:src|href)=["']([^"']+)["']/g)) requireAsset(match[1]);
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) requireAsset(icon.src);

await rm(output, { recursive: true, force: true });
for (const asset of assets) {
  const destination = path.join(output, asset);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, asset), destination);
}
await copyFile(path.join(root, 'cloudflare/_headers'), path.join(output, '_headers'));
console.log(`Cloudflare Pages: ${assets.length} arquivos públicos preparados em dist/.`);
