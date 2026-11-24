import { Fragment, type ReactNode } from 'react';
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

let activeRoot: Root | null = null;
let activeContainer: HTMLElement | null = null;
let watcher: MutationObserver | null = null;

function cleanup(): void {
  const root = activeRoot;
  activeRoot = null;
  activeContainer = null;
  if (root) root.unmount();
}

function watchRemovedNodes(): void {
  if (watcher || typeof MutationObserver === 'undefined') return;
  watcher = new MutationObserver(() => {
    if (activeContainer && !activeContainer.isConnected) cleanup();
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
  if (activeContainer && activeContainer !== container) cleanup();

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
    cleanup();
    return false;
  }
}

declare global {
  interface Window {
    MatosReactPortfolio?: {
      mountStats: typeof mountStats;
      cleanup: typeof cleanup;
    };
  }
}

window.MatosReactPortfolio = { mountStats, cleanup };

export { PortfolioStats, formatValue, mountStats, cleanup };
