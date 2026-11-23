/**
 * Empacota APENAS recursos públicos da interface do Matos para Cloudflare Pages.
 * Não publica testes, migrações SQL, funções servidoras, configurações internas ou segredos.
 * Sem dependências de build. O backend continua no Supabase.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'dist');
const safeRootExtensions = new Set([
  '.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.gif',
  '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.webmanifest', '.txt', '.xml',
]);
const safeAssetExtensions = new Set([...safeRootExtensions, '.json', '.pdf', '.wasm']);
const publicAssetDirectories = [
  'public', 'assets', 'images', 'img', 'icons', 'fonts', 'media', 'static', 'vendor', 'lib', 'libs',
];
const excludedRootFiles = new Set([
  'vitest.config.js', 'playwright.config.js', 'jest.config.js', 'babel.config.js',
  'webpack.config.js', 'rollup.config.js', 'vite.config.js', 'postcss.config.js',
  'tailwind.config.js', 'eslint.config.js', 'next.config.js',
]);
let copied = 0;

function safeFile(source, target) {
  if (lstatSync(source).isSymbolicLink()) throw new Error('Link simbólico não permitido: ' + source);
  mkdirSync(resolve(target, '..'), { recursive: true });
  cpSync(source, target);
  copied += 1;
}

function copyPublicTree(sourceDirectory, destinationDirectory) {
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const source = join(sourceDirectory, entry.name);
    const destination = join(destinationDirectory, entry.name);
    if (entry.isDirectory()) {
      copyPublicTree(source, destination);
    } else if (entry.isFile() && safeAssetExtensions.has(extname(entry.name).toLowerCase())) {
      safeFile(source, destination);
    }
  }
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile() || entry.name.startsWith('.') || excludedRootFiles.has(entry.name)) continue;
  if (!safeRootExtensions.has(extname(entry.name).toLowerCase())) continue;
  if (/\.(?:test|spec)\.js$/i.test(entry.name)) continue;
  safeFile(join(root, entry.name), join(output, entry.name));
}

for (const directory of publicAssetDirectories) {
  const source = join(root, directory);
  if (existsSync(source) && lstatSync(source).isDirectory()) {
    // Em "public", os caminhos ficam na raiz; nas demais pastas, preserva-se o nome.
    copyPublicTree(source, directory === 'public' ? output : join(output, directory));
  }
}

if (!existsSync(join(output, 'index.html'))) throw new Error('Falta index.html na pasta de publicação.');
const html = readFileSync(join(output, 'index.html'), 'utf8');
const references = [...html.matchAll(/(?:src|href)=(["'])(\/[^"'#?]+)(?:[?#][^"']*)?\1/g)];
for (const [, , path] of references) {
  if (!existsSync(join(output, path.slice(1)))) throw new Error('Recurso referenciado e ausente: ' + path);
}
if (!existsSync(join(output, 'sw.js'))) throw new Error('Falta sw.js para o aplicativo/notificações.');
if (!existsSync(join(output, 'manifest.webmanifest'))) throw new Error('Falta manifest.webmanifest.');
writeFileSync(join(output, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  X-Frame-Options: DENY',
  '/index.html',
  '  Cache-Control: no-cache',
  '/sw.js',
  '  Cache-Control: no-cache',
  '/manifest.webmanifest',
  '  Cache-Control: no-cache',
  '',
].join('\n'));
for (const forbidden of ['package.json', 'architecture.contract.json', 'supabase', 'tests', 'scripts', 'AGENTS.md']) {
  if (existsSync(join(output, forbidden))) throw new Error('Arquivo interno indevidamente publicado: ' + forbidden);
}
console.log('Cloudflare Pages: ' + copied + ' arquivos públicos preparados em dist/.');
