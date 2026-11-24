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
    };
  }
}

if (typeof window !== 'undefined') {
  window.MatosSearchCore = { normalize, searchIndex };
}
