import { describe, expect, it } from 'vitest';
import { linkCatalog, normalize, searchIndex } from '../../search-engine.js';

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

describe('Vínculos tipados da carteira imobiliária', () => {
  it('liga imóvel, inquilino e contrato sem depender da ordem das consultas', () => {
    const tenant = { id: 't1', nome: 'Maria' };
    const property = { id: 'p1', nome: 'Loja 101', inquilino_id: 't1' };
    const contract = { id: 'c1', inquilino_id: 't1', imovel_id: 'p1' };
    const links = linkCatalog({
      imoveis: [property], inquilinos: [tenant], contratos: [contract],
    });
    expect(links.homeForTenant('t1')).toBe(property);
    expect(links.propertiesById.get('p1')).toBe(property);
    expect(links.tenantsById.get('t1')).toBe(tenant);
    expect(links.contractsById.get('c1')).toBe(contract);
  });

  it('prioriza o vínculo direto e usa o primeiro contrato apenas como alternativa', () => {
    const direct = { id: 'p1', inquilino_id: 't1' };
    const contracted = { id: 'p2' };
    const others = { id: 'p3' };
    const links = linkCatalog({
      imoveis: [direct, contracted, others],
      contratos: [
        { id: 'c1', inquilino_id: 't1', imovel_id: 'p2' },
        { id: 'c2', inquilino_id: 't2', imovel_id: 'p2' },
        { id: 'c3', inquilino_id: 't2', imovel_id: 'p3' },
      ],
    });
    expect(links.homeForTenant('t1')).toBe(direct);
    expect(links.homeForTenant('t2')).toBe(contracted);
  });

  it('trata vínculos incompletos ou ocultos pela RLS sem tentar consultar outras contas', () => {
    const links = linkCatalog({
      imoveis: [{ id: 'p1', inquilino_id: null }],
      inquilinos: [{ id: 't1' }],
      contratos: [{ id: 'c1', inquilino_id: 't1', imovel_id: 'p99' }],
    });
    expect(links.homeForTenant('t1')).toBeUndefined();
    expect(links.homeForTenant(null)).toBeUndefined();
    expect(linkCatalog({}).homeForTenant('t1')).toBeUndefined();
    expect(links.propertiesById).toBeInstanceOf(Map);
  });

  it('suporta grande volume de registros e mantém o primeiro vínculo por inquilino', () => {
    const properties = Array.from({ length: 1500 }, (_, i) => ({
      id: 'p' + i,
      inquilino_id: i % 2 === 0 ? 't' + i : null,
    }));
    const contracts = Array.from({ length: 1500 }, (_, i) => ({
      id: 'c' + i, inquilino_id: 't' + i, imovel_id: 'p' + i,
    }));
    const links = linkCatalog({ imoveis: properties, contratos: contracts });
    expect(links.homeForTenant('t0')).toBe(properties[0]);
    expect(links.homeForTenant('t1499')).toBe(properties[1499]);
    expect(links.propertiesById.size).toBe(1500);
  });
});
