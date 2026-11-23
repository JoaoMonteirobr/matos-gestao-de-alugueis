import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('rótulo do cadastro de IPTU', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'app2.js'), 'utf8');

  it('preserva a sigla IPTU nos botões e títulos do formulário', () => {
    expect(source).toContain("function singularLabel(p){return p==='IPTU'?'IPTU':p.slice(0,-1)}");
    expect(source).toContain('esc(singularLabel(page))');
    expect(source).toContain('esc(singularLabel(p))');
  });
});
