import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const originCloudflare = 'https://matos-gestao-de-alugueis.joao-monteiro-0fb.workers.dev';
const originVercel = 'https://gestao-alugueis-jp.vercel.app';
const sources = [
  'supabase/functions/secure-login/http.ts',
  'supabase/functions/_shared/http.ts',
];

// A função real roda em Deno. Executamos apenas o trecho de CORS, preservando
// a implementação de produção e isolando o acesso às variáveis de ambiente.
function corsFromSource(file, extraOrigins = '') {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  const start = source.indexOf('const DEFAULT_ORIGINS = [');
  const end = source.indexOf('export function json(', start);
  if (start < 0 || end < 0) throw new Error('Trecho CORS ausente: ' + file);
  const excerpt = source.slice(start, end);
  const compiled = ts.transpileModule(excerpt, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    exports: {},
    Deno: { env: { get: (key) => key === 'ALLOWED_ORIGINS' ? extraOrigins : undefined } },
  };
  vm.runInNewContext(compiled, context, { timeout: 1000 });
  return (origin) => context.exports.corsHeaders({
    headers: { get: (key) => key === 'origin' ? origin : null },
  });
}

describe('CORS da autenticação Supabase na Cloudflare', () => {
  for (const file of sources) {
    it('permite somente Cloudflare, Vercel e origens configuradas: ' + file, () => {
      const headers = corsFromSource(file);
      expect(headers(originCloudflare)['Access-Control-Allow-Origin']).toBe(originCloudflare);
      expect(headers(originVercel)['Access-Control-Allow-Origin']).toBe(originVercel);
      expect(headers('https://outro-site.example')['Access-Control-Allow-Origin']).toBeUndefined();
      expect(headers(originCloudflare + '.malicioso.example')['Access-Control-Allow-Origin']).toBeUndefined();
      expect(headers('http://matos-gestao-de-alugueis.joao-monteiro-0fb.workers.dev')['Access-Control-Allow-Origin']).toBeUndefined();
      expect(headers(originCloudflare + '/')['Access-Control-Allow-Origin']).toBeUndefined();
      expect(headers(originCloudflare)['Access-Control-Allow-Methods']).toContain('OPTIONS');
      expect(headers(originCloudflare)['Access-Control-Allow-Headers']).toContain('apikey');
      expect(headers(originCloudflare).Vary).toBe('Origin');

      const withExtra = corsFromSource(file, 'https://outro-dominio-autorizado.example');
      expect(withExtra('https://outro-dominio-autorizado.example')['Access-Control-Allow-Origin']).toBe('https://outro-dominio-autorizado.example');
      expect(withExtra(originCloudflare)['Access-Control-Allow-Origin']).toBe(originCloudflare);
      expect(withExtra('https://invasor.example')['Access-Control-Allow-Origin']).toBeUndefined();
    });
  }
});
