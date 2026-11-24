/**
 * Núcleo de pesquisa tipado. Esta lógica não consulta o banco nem conhece tokens.
 * O navegador usa o JavaScript compilado; o TypeScript nunca é carregado como script.
 */
export type SearchKind = 'imoveis' | 'inquilinos' | 'cobrancas' | 'contratos' | 'manutencoes';
export type SearchFilter = SearchKind | 'todos';

export interface SearchItem {
  readonly id: string;
  readonly key: string;
  readonly kind: SearchKind;
  readonly title: string;
  readonly subtitle: string;
  readonly searchText: string;
  readonly status?: string;
  readonly details?: ReadonlyArray<readonly [string, string]>;
  readonly period?: string;
}

/**
 * Leitura tipada dos registros do Supabase usados na pesquisa.
 * Campos são opcionais/nulos porque os vínculos podem estar ausentes e a RLS
 * pode limitar o conjunto de dados permitido ao usuário autenticado.
 */
export type Maybe<T> = T | null | undefined;

export interface PropertyRecord {
  readonly id: string;
  readonly nome?: Maybe<string>;
  readonly tipo?: Maybe<string>;
  readonly endereco?: Maybe<string>;
  readonly numero?: Maybe<string>;
  readonly complemento?: Maybe<string>;
  readonly bairro?: Maybe<string>;
  readonly cidade?: Maybe<string>;
  readonly inquilino_id?: Maybe<string>;
  readonly status?: Maybe<string>;
}

export interface TenantRecord {
  readonly id: string;
  readonly nome?: Maybe<string>;
  readonly telefone?: Maybe<string>;
  readonly email?: Maybe<string>;
  readonly cpf_cnpj?: Maybe<string>;
  readonly status?: Maybe<string>;
}

export interface ContractRecord {
  readonly id: string;
  readonly imovel_id?: Maybe<string>;
  readonly inquilino_id?: Maybe<string>;
  readonly data_inicio?: Maybe<string>;
  readonly data_fim?: Maybe<string>;
  readonly aluguel_atual?: Maybe<number | string>;
  readonly status?: Maybe<string>;
}

export interface ChargeRecord {
  readonly id: string;
  readonly contrato_id?: Maybe<string>;
  readonly imovel_id?: Maybe<string>;
  readonly inquilino_id?: Maybe<string>;
  readonly competencia?: Maybe<string>;
  readonly vencimento?: Maybe<string>;
  readonly aluguel?: Maybe<number | string>;
  readonly outros_encargos?: Maybe<number | string>;
  readonly valor_pago?: Maybe<number | string>;
  readonly data_pagamento?: Maybe<string>;
  readonly status?: Maybe<string>;
}

export interface MaintenanceRecord {
  readonly id: string;
  readonly imovel_id?: Maybe<string>;
  readonly inquilino_id?: Maybe<string>;
  readonly categoria?: Maybe<string>;
  readonly descricao?: Maybe<string>;
  readonly prioridade?: Maybe<string>;
  readonly data_abertura?: Maybe<string>;
  readonly status?: Maybe<string>;
}

export interface SearchDataset {
  readonly imoveis?: Maybe<readonly PropertyRecord[]>;
  readonly inquilinos?: Maybe<readonly TenantRecord[]>;
  readonly contratos?: Maybe<readonly ContractRecord[]>;
  readonly cobrancas?: Maybe<readonly ChargeRecord[]>;
  readonly manutencoes?: Maybe<readonly MaintenanceRecord[]>;
}

/**
 * Associa os registros em O(P + I + C), sem realizar novas consultas.
 * A prioridade da associação é a mesma do código legado: imóvel vinculado
 * diretamente ao inquilino, ou primeiro contrato da lista como alternativa.
 */
export function linkCatalog(data: SearchDataset) {
  const properties = data.imoveis ?? [];
  const tenants = data.inquilinos ?? [];
  const contracts = data.contratos ?? [];

  const propertiesById = new Map(properties.map((row) => [row.id, row]));
  const tenantsById = new Map(tenants.map((row) => [row.id, row]));
  const contractsById = new Map(contracts.map((row) => [row.id, row]));
  const directPropertyByTenant = new Map<string, PropertyRecord>();
  const firstContractByTenant = new Map<string, ContractRecord>();

  for (const property of properties) {
    const tenantId = property.inquilino_id;
    if (tenantId && !directPropertyByTenant.has(tenantId)) {
      directPropertyByTenant.set(tenantId, property);
    }
  }
  for (const contract of contracts) {
    const tenantId = contract.inquilino_id;
    if (tenantId && !firstContractByTenant.has(tenantId)) {
      firstContractByTenant.set(tenantId, contract);
    }
  }

  return {
    propertiesById,
    tenantsById,
    contractsById,
    homeForTenant(tenantId: Maybe<string>): PropertyRecord | undefined {
      if (!tenantId) return undefined;
      const direct = directPropertyByTenant.get(tenantId);
      if (direct) return direct;
      const contract = firstContractByTenant.get(tenantId);
      return contract?.imovel_id ? propertiesById.get(contract.imovel_id) : undefined;
    },
  };
}

const MAX_PER_TYPE = 8;
const DEFAULT_LIMIT = 30;

export function normalize(value: unknown): string {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function searchIndex<T extends SearchItem>(
  items: readonly T[],
  query: string,
  kind: SearchFilter = 'todos',
  limit: number = DEFAULT_LIMIT,
): T[] {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const matches = items.filter(
    (item) =>
      (kind === 'todos' || kind === item.kind) &&
      tokens.every((term) => item.searchText.indexOf(term) >= 0),
  );
  const full = normalize(query);
  const rank = (item: T): number => {
    const title = normalize(item.title);
    const subtitle = normalize(item.subtitle);
    if (title === full) return 0;
    if (title.startsWith(full)) return 1;
    if (title.includes(full)) return 2;
    if (subtitle.includes(full)) return 3;
    return 4;
  };
  matches.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.kind.localeCompare(b.kind) ||
      a.title.localeCompare(b.title, 'pt-BR'),
  );
  const countByType: Partial<Record<SearchKind, number>> = {};
  const output: T[] = [];
  for (const item of matches) {
    if (output.length >= (limit || DEFAULT_LIMIT)) break;
    const count = countByType[item.kind] || 0;
    if (kind !== 'todos' || count < MAX_PER_TYPE) {
      output.push(item);
      countByType[item.kind] = count + 1;
    }
  }
  return output;
}

declare global {
  interface Window {
    MatosSearchCore: {
      normalize: typeof normalize;
      searchIndex: typeof searchIndex;
      linkCatalog: typeof linkCatalog;
    };
  }
}

if (typeof window !== 'undefined') {
  window.MatosSearchCore = { normalize, searchIndex, linkCatalog };
}
