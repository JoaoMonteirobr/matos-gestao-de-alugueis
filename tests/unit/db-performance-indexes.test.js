import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const filename = '20261124224228_indexar_relacionamentos_carteira_matos.sql';
const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', filename), 'utf8');

const indexes = [
  ['imoveis', 'proprietario_id'],
  ['contratos', 'imovel_id'],
  ['contratos', 'inquilino_id'],
  ['cobrancas', 'imovel_id'],
  ['cobrancas', 'inquilino_id'],
  ['manutencoes', 'imovel_id'],
  ['manutencoes', 'inquilino_id'],
];

describe('Migração de índices de relacionamentos da carteira', () => {
  it('contém os sete índices esperados, idempotentes e no esquema público', () => {
    for (const [table, column] of indexes) {
      expect(sql).toContain(
        `CREATE INDEX IF NOT EXISTS idx_${table}_${column} ON public.${table} USING btree (${column});`,
      );
    }
    expect((sql.match(/CREATE INDEX IF NOT EXISTS/g) || [])).toHaveLength(indexes.length);
  });

  it('não modifica dados, privilégios, RLS ou chaves primárias', () => {
    const statements = sql.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|GRANT|REVOKE|SECURITY DEFINER)\b/i);
  });
});
