import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import * as searchCore from '../../search-engine.js';

const source = fs.readFileSync(path.join(process.cwd(), 'global-search.js'), 'utf8');
const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const assets = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cloudflare/public-assets.json'), 'utf8'));

function catalog() {
  return {
    imoveis: [{
      id: 'property-1', nome: 'Galeria Matos', endereco: 'Coronel Alexandrino',
      numero: '646', bairro: 'Bosque', tipo: 'loja', status: 'ocupado', inquilino_id: 'tenant-1',
    }],
    inquilinos: [{
      id: 'tenant-1', nome: 'José da Silva', cpf_cnpj: '00011122233',
      telefone: '68999123456', email: 'jose@example.invalid', status: 'ativo',
    }],
    contratos: [{
      id: 'contract-1', imovel_id: 'property-1', inquilino_id: 'tenant-1',
      data_inicio: '2026-01-01', data_fim: '2027-01-01', aluguel_atual: 3800, status: 'ativo',
    }],
    cobrancas: [{
      id: 'charge-1', contrato_id: 'contract-1', imovel_id: 'property-1',
      inquilino_id: 'tenant-1', competencia: '2026-11-01', vencimento: '2026-11-05',
      aluguel: 3800, valor_pago: 3800, data_pagamento: '2026-11-05', status: 'pago',
    }],
    manutencoes: [{
      id: 'call-1', imovel_id: 'property-1', inquilino_id: 'tenant-1', categoria: 'Hidráulica',
      descricao: 'Infiltração na calha', prioridade: 'alta', status: 'aberto',
      data_abertura: '2026-11-19',
    }],
  };
}

function harness() {
  const dom = new JSDOM('<div class="appbar"><div class="app-search"><input class="inp"></div><div class="user"></div></div><aside class="side"><button data-page="Dashboard"></button><button data-page="Pagamentos"></button><button data-page="Relatórios"></button></aside>', { url: 'https://matos.example.invalid' });
  dom.window.MatosSearchCore = searchCore;
  const context = {
    window: dom.window,
    document: dom.window.document,
    shell: vi.fn(),
    saveSession: vi.fn(),
    goQuick: vi.fn(),
    request: vi.fn(),
    authHeaders: vi.fn(),
    session: { access_token: 'synthetic-token', user: { id: 'synthetic-user' } },
    currentRole: 'admin',
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    Map, Date, Number, String, Array,
  };
  vm.runInNewContext(source, context);
  return { ...context, dom, api: dom.window.MatosGlobalSearch };
}

describe('Busca global do Matos', () => {
  it('indexa as cinco entidades e vincula pagamento, contrato e chamado ao inquilino e imóvel', () => {
    const { api } = harness();
    const items = api.buildIndex(catalog());
    expect(items).toHaveLength(5);
    const matched = api.searchIndex(items, 'jose', 'todos');
    expect([...matched.map((x) => x.kind)].sort()).toEqual([
      'cobrancas', 'contratos', 'imoveis', 'inquilinos', 'manutencoes',
    ]);
    expect(items.find((x) => x.kind === 'contratos').subtitle).toContain('José da Silva');
    expect(items.find((x) => x.kind === 'cobrancas').period).toBe('2026-11');
  });

  it('ignora acentos, encontra competência e valores e permite filtrar por tipo', () => {
    const { api } = harness();
    const items = api.buildIndex(catalog());
    expect(api.normalize('ÁlUGUÉL — João')).toBe('aluguel joao');
    expect(api.searchIndex(items, 'coronel alexandrino', 'imoveis')).toHaveLength(1);
    expect(api.searchIndex(items, 'infiltracao', 'manutencoes')).toHaveLength(1);
    expect(api.searchIndex(items, '11/2026', 'cobrancas')).toHaveLength(1);
    expect(api.searchIndex(items, '3800', 'cobrancas')).toHaveLength(1);
    expect(api.searchIndex(items, 'jose', 'imoveis')).toHaveLength(1);
    expect(api.searchIndex(items, 'jose', 'cobrancas')).toHaveLength(1);
    expect(api.searchIndex(items, 'desconhecido', 'todos')).toHaveLength(0);
  });

  it('respeita o limite de resultados e não retorna categorias que foram filtradas', () => {
    const { api } = harness();
    const items = Array.from({ length: 35 }, (_, i) => ({
      key: 'imoveis:' + i, kind: 'imoveis', id: String(i),
      title: 'Loja ' + i, subtitle: 'Coronel Alexandrino', status: 'ocupado',
      details: [], searchText: 'loja coronel alexandrino',
    }));
    expect(api.searchIndex(items, 'loja', 'todos')).toHaveLength(8);
    expect(api.searchIndex(items, 'loja', 'imoveis')).toHaveLength(30);
    expect(api.searchIndex(items, 'loja', 'contratos')).toHaveLength(0);
  });

  it('escapa dados externos e mantém sua própria camada', () => {
    const x = harness();
    const data = catalog();
    data.imoveis[0].nome = '<img src=x onerror=alert(1)>';
    const entries = x.api.buildIndex(data);
    expect(entries.some((e) => e.title.includes('<img'))).toBe(true);
    expect(source).toContain('safe(item.title)');
    expect(source).toContain('safe(pair[1])');
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).toContain('authHeaders(token)');
  });

  it('inclui CSS e JavaScript na página e na cópia Cloudflare', () => {
    expect(html).toContain('/global-search.css?v=1');
    expect(html).toContain('/global-search.js?v=2');
    expect(html).toContain('<script type="module" src="/search-engine.js?v=1"></script><script type="module" src="/global-search.js?v=2"></script>');
    expect(assets).toContain('global-search.css');
    expect(assets).toContain('global-search.js');
  });
});
