import { Fragment, useState, type ChangeEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

interface StatItem {
  readonly label: string;
  readonly value: number;
  readonly hint?: string;
}

interface StatsProps {
  readonly items: readonly StatItem[];
}

function formatValue(value: number): string {
  return Number.isFinite(value)
    ? Math.max(0, Math.trunc(value)).toLocaleString('pt-BR')
    : '—';
}

function PortfolioStats({ items }: StatsProps): ReactNode {
  return (
    <Fragment>
      {items.map((item, index) => (
        <div className="portfolio-stat" key={index}>
          <span>{item.label}</span>
          <strong>{formatValue(item.value)}</strong>
          {item.hint ? <small>{item.hint}</small> : null}
        </div>
      ))}
    </Fragment>
  );
}

interface FilterResult {
  readonly visible: number;
  readonly total: number;
}

interface FilterProps {
  readonly id: string;
  readonly placeholder: string;
  readonly noun: string;
  readonly total: number;
  readonly onFilter: (query: string) => FilterResult;
}

// Somente o filtro e o contador são responsabilidade do React.
// Os registros continuam sendo exibidos e filtrados pelo código autorizado existente.
function PortfolioFilter({ id, placeholder, noun, total, onFilter }: FilterProps): ReactNode {
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(total);
  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.currentTarget.value;
    setQuery(value);
    setVisible(onFilter(value).visible);
  }
  return (
    <Fragment>
      <label className="portfolio-filterlabel" htmlFor={id}>
        <span className="portfolio-filtericon" aria-hidden="true">⌕</span>
        <input
          type="search"
          id={id}
          className="inp portfolio-filterinput"
          autoComplete="off"
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          onChange={handleChange}
        />
      </label>
      <span className="portfolio-result-count" id={id + '_count'} role="status" aria-live="polite">
        {visible} de {total} {noun}
      </span>
      <span className="portfolio-filter-hint">Filtro nesta página · {noun}</span>
    </Fragment>
  );
}

let activeRoot: Root | null = null;
let activeContainer: HTMLElement | null = null;
let filterRoot: Root | null = null;
let filterContainer: HTMLElement | null = null;
let watcher: MutationObserver | null = null;

function cleanupStats(): void {
  const root = activeRoot;
  activeRoot = null;
  activeContainer = null;
  if (root) root.unmount();
}

function cleanupFilter(): void {
  const root = filterRoot;
  filterRoot = null;
  filterContainer = null;
  if (root) root.unmount();
}

function cleanup(): void {
  cleanupStats();
  cleanupFilter();
}

function watchRemovedNodes(): void {
  if (watcher || typeof MutationObserver === 'undefined') return;
  watcher = new MutationObserver(() => {
    if (activeContainer && !activeContainer.isConnected) cleanupStats();
    if (filterContainer && !filterContainer.isConnected) cleanupFilter();
  });
  watcher.observe(document.body, { childList: true, subtree: true });
}

function mountStats(
  container: HTMLElement | null,
  items: readonly StatItem[],
  title = 'Resumo de imóveis',
): boolean {
  if (!container || !container.isConnected || !Array.isArray(items)) return false;

  // O restante da aplicação continua em JS legado. React controla apenas esta ilha.
  if (activeContainer && activeContainer !== container) cleanupStats();

  try {
    if (!activeRoot) {
      activeRoot = createRoot(container);
      activeContainer = container;
    }
    activeRoot.render(<PortfolioStats items={items} />);
    container.setAttribute('data-react-portfolio', 'mounted');
    container.setAttribute('aria-label', title);
    watchRemovedNodes();
    return true;
  } catch {
    // Em falhas síncronas, mantemos o HTML original como fallback.
    cleanupStats();
    return false;
  }
}

function mountFilter(
  container: HTMLElement | null,
  total: number,
  onFilter: (query: string) => FilterResult,
): boolean {
  if (!container || !container.isConnected || !Number.isFinite(total) || typeof onFilter !== 'function') {
    return false;
  }
  if (filterContainer && filterContainer !== container) cleanupFilter();
  try {
    if (!filterRoot) {
      filterRoot = createRoot(container);
      filterContainer = container;
    }
    filterRoot.render(
      <PortfolioFilter
        id="portfolio_properties_filter"
        placeholder="Filtrar por imóvel, endereço ou inquilino"
        noun="imóveis"
        total={Math.max(0, Math.trunc(total))}
        onFilter={onFilter}
      />,
    );
    container.setAttribute('data-react-filter', 'mounted');
    watchRemovedNodes();
    return true;
  } catch {
    cleanupFilter();
    return false;
  }
}

declare global {
  interface Window {
    MatosReactPortfolio?: {
      mountStats: typeof mountStats;
      mountFilter: typeof mountFilter;
      cleanup: typeof cleanup;
    };
  }
}

window.MatosReactPortfolio = { mountStats, mountFilter, cleanup };

export { PortfolioStats, PortfolioFilter, formatValue, mountStats, mountFilter, cleanup };
