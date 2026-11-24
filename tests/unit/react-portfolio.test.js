import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'src/react/portfolio-stats.tsx'), 'utf8');
const bundle = fs.readFileSync(path.join(root, 'portfolio-react.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const simple = fs.readFileSync(path.join(root, 'simple-ui.js'), 'utf8');
const list = JSON.parse(fs.readFileSync(path.join(root, 'cloudflare/public-assets.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('Primeira ilha React da carteira Matos', () => {
  it('usa React compilado localmente e mantém fallback HTML', () => {
    expect(src).toContain("from 'react'");
    expect(src).toContain("from 'react-dom/client'");
    expect(src).toContain('createRoot(container)');
    expect(src).toContain('root.unmount()');
    expect(src).toContain('function mountFilter(');
    expect(bundle).toContain('MatosReactPortfolio');
    expect(src).toContain('PortfolioFilter');
    expect(bundle).not.toContain('React.createElement');
    expect(index).toContain('/portfolio-react.js?v=3');
    expect(index).toContain('/simple-ui.js?v=27');
    expect(list).toContain('portfolio-react.js');
    expect(pkg.dependencies.react).toBe('19.3.1');
    expect(pkg.dependencies['react-dom']).toBe('19.3.1');
    expect(pkg.scripts['verify:react-build']).toContain('git diff --exit-code');
    expect(simple).toContain('ui.statsHTML(summaryItems');
    expect(simple).toContain('react.mountStats(');
    expect(simple).toContain('react.mountFilter(');
    expect(simple).toContain('ui.filterRows(');
  });

  it('monta o filtro React sem acessar o banco ou recriar as linhas de imóveis', async () => {
    const dom = new JSDOM('<main><div id="filter" class="portfolio-filterbar">Filtro anterior</div></main>', {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      url: 'https://matos.example.invalid',
    });
    try {
      dom.window.eval(bundle);
      const api = dom.window.MatosReactPortfolio;
      const target = dom.window.document.querySelector('#filter');
      const onFilter = vi.fn(() => ({ visible: 2, total: 3 }));
      expect(api.mountFilter(target, 3, onFilter)).toBe(true);
      await vi.waitFor(() => {
        expect(target.querySelector('#portfolio_properties_filter')).toBeTruthy();
      }, { timeout: 2500 });
      expect(target.querySelector('#portfolio_properties_filter_count').textContent).toContain('3 de 3 imóveis');
      expect(target.getAttribute('data-react-filter')).toBe('mounted');
      expect(target.querySelector('input').getAttribute('aria-label')).toContain('Filtrar por imóvel');
      expect(onFilter).not.toHaveBeenCalled();
      expect(api.mountFilter(null, 3, onFilter)).toBe(false);
      api.cleanup();
    } finally {
      dom.window.close();
    }
  });

  it('monta um componente React real com rótulos escapados e números válidos', async () => {
    const dom = new JSDOM('<main><div id="stats" class="portfolio-stats">Cartões antigos</div></main>', {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      url: 'https://matos.example.invalid',
    });
    try {
      dom.window.eval(bundle);
      const api = dom.window.MatosReactPortfolio;
      expect(api).toBeDefined();
      const target = dom.window.document.querySelector('#stats');
      const result = api.mountStats(target, [
        { label: 'Total <script>', value: 21 },
        { label: 'Disponíveis', value: 0 },
        { label: 'Inválidos', value: Number.NaN },
      ], 'Resumo de testes');
      expect(result).toBe(true);
      expect(target.getAttribute('data-react-portfolio')).toBe('mounted');
      await vi.waitFor(() => {
        expect(target.querySelectorAll('.portfolio-stat')).toHaveLength(3);
      }, { timeout: 2500 });
      expect(target.textContent).toContain('Total <script>');
      expect(target.querySelector('script')).toBeNull();
      expect(target.textContent).toContain('21');
      expect(target.textContent).toContain('—');
      api.cleanup();
    } finally {
      dom.window.close();
    }
  });
});
