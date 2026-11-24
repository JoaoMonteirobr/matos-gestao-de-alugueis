import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const script = fs.readFileSync(path.join(root, 'portfolio-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'portfolio-ui.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'simple-ui.js'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'app2.js'), 'utf8');
const assets = JSON.parse(fs.readFileSync(path.join(root, 'cloudflare/public-assets.json'), 'utf8'));

function harness(html = '<main id="content"></main>') {
  const dom = new JSDOM(html);
  vm.runInNewContext(script, { window: dom.window, document: dom.window.document, Array, Number, String });
  return { dom, document: dom.window.document, api: dom.window.MatosPortfolioUI };
}

describe('Componentes visuais da carteira Matos', () => {
  it('cria estatísticas com conteúdo escapado e sem permitir valores inválidos', () => {
    const { api } = harness();
    const html = api.statsHTML([
      { label: 'Total <script>', value: 21, hint: 'Ativos & visíveis' },
      { label: 'Indefinidos', value: Number.NaN },
      { label: 'Negativos', value: -10 },
    ], 'Visão de "carteira"');
    expect(html).toContain('Total &lt;script&gt;');
    expect(html).toContain('Ativos &amp; visíveis');
    expect(html).toContain('Visão de &quot;carteira&quot;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('>21</strong>');
    expect(html).toContain('>0</strong>');
    expect(html).toContain('>—</strong>');
  });

  it('filtra imóveis pelo endereço do agrupamento, ignorando acentos', () => {
    const { api, dom, document } = harness();
    const root = document.getElementById('content');
    root.innerHTML = api.filterHTML('portfolio_properties_filter', 'Filtrar imóveis', 'imóveis') +
      '<section class="property-address-group"><div class="panel-title"><h3>Coronel Alexandrino</h3></div>' +
      '<div class="property-subgroup"><table class="portfolio-table"><tbody>' +
      '<tr><td>Loja 101</td><td>José</td></tr><tr><td>Loja 102</td><td>Maria</td></tr>' +
      '</tbody></table></div></section>' +
      '<section class="property-address-group"><div class="panel-title"><h3>Rua Major Salinas</h3></div>' +
      '<div class="property-subgroup"><table class="portfolio-table"><tbody>' +
      '<tr><td>Galpão</td><td>Daniel</td></tr></tbody></table></div></section>';
    const bound = api.bindFilter({ root, id: 'portfolio_properties_filter', rows: '.portfolio-table tbody tr',
      groups: '.property-address-group', sections: '.property-subgroup', noun: 'imóveis' });
    expect(bound).toBe(true);
    const input = document.getElementById('portfolio_properties_filter');
    expect(document.getElementById('portfolio_properties_filter_count').textContent).toBe('3 de 3 imóveis');

    input.value = 'coronel';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(root.querySelectorAll('.property-address-group[hidden]')).toHaveLength(1);
    expect(root.querySelectorAll('tr:not([hidden])')).toHaveLength(2);

    input.value = 'JOSE';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(root.querySelectorAll('tr:not([hidden])')).toHaveLength(1);

    input.value = 'nome inexistente';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(document.getElementById('portfolio_properties_filter_empty').hidden).toBe(false);

    input.value = '';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(root.querySelectorAll('tr:not([hidden])')).toHaveLength(3);
    expect(document.getElementById('portfolio_properties_filter_empty').hidden).toBe(true);
  });

  it('compartilha a mesma filtragem de imóveis entre React e listener legado', () => {
    const { api, document } = harness();
    const root = document.getElementById('content');
    root.innerHTML = api.filterHTML('portfolio_properties_filter', 'Filtrar imóveis', 'imóveis') +
      '<section class="property-address-group"><div class="panel-title"><h3>Coronel Alexandrino</h3></div>' +
      '<div class="property-subgroup"><table class="portfolio-table"><tbody>' +
      '<tr><td>Loja 101</td><td>José</td></tr><tr><td>Loja 102</td><td>Maria</td></tr>' +
      '</tbody></table></div></section>' +
      '<section class="property-address-group"><div class="panel-title"><h3>Major Salinas</h3></div>' +
      '<div class="property-subgroup"><table class="portfolio-table"><tbody>' +
      '<tr><td>Galpão</td><td>Daniel</td></tr></tbody></table></div></section>';
    const options = { root, id: 'portfolio_properties_filter', rows: '.portfolio-table tbody tr',
      groups: '.property-address-group', sections: '.property-subgroup', noun: 'imóveis' };
    expect(api.filterRows(options, 'CORONEL')).toEqual({ visible: 2, total: 3 });
    expect(root.querySelectorAll('tr[hidden]')).toHaveLength(1);
    expect(api.filterRows(options, 'jose')).toEqual({ visible: 1, total: 3 });
    expect(api.filterRows(options, 'inexistente')).toEqual({ visible: 0, total: 3 });
    expect(document.querySelector('#portfolio_properties_filter_empty').hidden).toBe(false);
    expect(api.filterRows(options, '')).toEqual({ visible: 3, total: 3 });
    expect(root.querySelectorAll('tr[hidden]')).toHaveLength(0);
    expect(document.querySelector('#portfolio_properties_filter_empty').hidden).toBe(true);
    expect(api.bindFilter(options)).toBe(true);
    expect(document.getElementById('portfolio_properties_filter_count').textContent).toBe('3 de 3 imóveis');
  });

  it('mantém botões e listeners operacionais ao filtrar contratos', () => {
    const { api, dom, document } = harness();
    const root = document.getElementById('content');
    root.innerHTML = api.filterHTML('portfolio_contracts_filter', 'Filtrar contratos', 'contratos') +
      '<table class="portfolio-table contracts-table"><tbody>' +
      '<tr><td>Galeria Matos</td><td>João</td><td><button id="editar" type="button">Editar</button></td></tr>' +
      '<tr><td>Major Salinas</td><td>Maria</td></tr></tbody></table>';
    const onEdit = vi.fn();
    document.getElementById('editar').addEventListener('click', onEdit);
    api.bindFilter({ root, id: 'portfolio_contracts_filter', rows: '.contracts-table tbody tr', noun: 'contratos' });
    const input = document.getElementById('portfolio_contracts_filter');
    input.value = 'galeria';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(root.querySelectorAll('tr:not([hidden])')).toHaveLength(1);
    document.getElementById('editar').click();
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('carrega o design exclusivamente nas áreas da carteira e na versão Cloudflare', () => {
    expect(index).toContain('/portfolio-ui.css?v=1');
    expect(index).toContain('/portfolio-ui.js?v=2');
    expect(index.indexOf('/theme-led.js?v=15')).toBeLessThan(index.indexOf('/portfolio-ui.js?v=2'));
    expect(assets).toContain('portfolio-ui.css');
    expect(assets).toContain('portfolio-ui.js');
    expect(source).toContain('matos-portfolio-properties');
    expect(source).toContain('matos-portfolio-contracts');
    expect(legacy).toContain('matos-portfolio-tenants');
    expect(css).toContain('.matos-portfolio .portfolio-stats');
    expect(css).toContain('#modal.matos-portfolio-dialog');
    expect(css).toContain('@media(max-width:680px)');
    expect(script).not.toContain('/rest/v1/');
  });
});
