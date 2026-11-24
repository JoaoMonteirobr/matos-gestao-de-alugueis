import { describe, expect, it } from 'vitest';
import { normalize, searchIndex } from '../../search-engine.js';

function item(kind, title, subtitle, extra = '') {
  return {
    id: title,
    key: kind + ':' + title,
    kind,
    title,
    subtitle,
    searchText: normalize([kind, title, subtitle, extra].join(' ')),
  };
}

describe('Motor de busca compilado do TypeScript', () => {
  it('normaliza palavras com acento, caixa alta e sinais', () => {
    expect(normalize('  GESTÃO   — ÁLUGUÉIS  ')).toBe('gestao alugueis');
    expect(normalize(null)).toBe('');
    expect(normalize('11/2026')).toBe('11 2026');
  });

  it('encontra nomes compostos e ordena correspondências relevantes', () => {
    const items = [
      item('imoveis', 'Outro imóvel', 'Coronel Brandão'),
      item('imoveis', 'Coronel Brandão', '101'),
      item('cobrancas', 'Pagamento · Novembro/2026', 'Coronel Brandão', 'pago'),
    ];
    const hits = searchIndex(items, 'Coronel Brandão', 'todos');
    expect(hits).toHaveLength(3);
    expect(hits[0].title).toBe('Coronel Brandão');
    expect(hits.every((hit) => hit.searchText.includes('coronel brandao'))).toBe(true);
  });

  it('não mistura categorias e limita o volume apresentado por tipo', () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      item('contratos', 'Contrato ' + i, 'Loja 12'));
    expect(searchIndex(items, 'loja', 'todos')).toHaveLength(8);
    expect(searchIndex(items, 'loja', 'contratos')).toHaveLength(30);
    expect(searchIndex(items, 'loja', 'manutencoes')).toHaveLength(0);
    expect(searchIndex(items, '')).toEqual([]);
  });

  it('usa todos os termos na mesma linha antes de exibir', () => {
    const items = [
      item('inquilinos', 'Maria Silva', 'Galeria Matos'),
      item('inquilinos', 'Maria Santos', 'Coronel Alexandrino'),
    ];
    expect(searchIndex(items, 'Maria Matos').map((r) => r.title)).toEqual(['Maria Silva']);
  });
});
