import { expect, test } from '@playwright/test';

const USER_ID = '00000000-0000-4000-8000-000000000919';
const DB = {
  imoveis: [{
    id: '00000000-0000-4000-8000-000000000921', nome: 'Galeria Matos',
    tipo: 'loja', endereco: 'Coronel Alexandrino', numero: '646',
    bairro: 'Bosque', cidade: 'Rio Branco', status: 'ocupado',
    inquilino_id: '00000000-0000-4000-8000-000000000922',
  }],
  inquilinos: [{
    id: '00000000-0000-4000-8000-000000000922',
    nome: 'José da Silva', telefone: '68999999999', cpf_cnpj: '12345678901', status: 'ativo',
  }],
  contratos: [{
    id: '00000000-0000-4000-8000-000000000923',
    imovel_id: '00000000-0000-4000-8000-000000000921',
    inquilino_id: '00000000-0000-4000-8000-000000000922',
    data_inicio: '2026-01-01', data_fim: '2027-01-01', status: 'ativo', aluguel_atual: 3800,
  }],
  cobrancas: [{
    id: '00000000-0000-4000-8000-000000000924',
    contrato_id: '00000000-0000-4000-8000-000000000923',
    imovel_id: '00000000-0000-4000-8000-000000000921',
    inquilino_id: '00000000-0000-4000-8000-000000000922',
    competencia: '2026-11-01', vencimento: '2026-11-05',
    aluguel: 3800, valor_pago: 3800, status: 'pago',
  }],
  manutencoes: [{
    id: '00000000-0000-4000-8000-000000000925',
    imovel_id: '00000000-0000-4000-8000-000000000921',
    inquilino_id: '00000000-0000-4000-8000-000000000922',
    categoria: 'Hidráulica', descricao: 'Infiltração na calha',
    prioridade: 'alta', status: 'aberto', data_abertura: '2026-11-19',
  }],
};

async function openAccount(page, role, superadmin = false) {
  test.skip(process.env.MATOS_E2E_EXTERNAL === '1', 'O teste usa somente identidades e registros sintéticos.');
  await page.addInitScript((id) => {
    localStorage.setItem('matos_session', JSON.stringify({
      access_token: 'synthetic-search-token',
      user: { id, email: 'busca@example.invalid' },
    }));
  }, USER_ID);

  const requests = [];
  await page.route('https://behmmbgbrsesxthsczdl.supabase.co/**', async (route) => {
    const uri = new URL(route.request().url());
    const respond = (data) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(data),
    });
    if (uri.pathname === '/auth/v1/user') return respond({ id: USER_ID, email: 'busca@example.invalid' });
    if (uri.pathname === '/rest/v1/perfis') return respond([{ user_id: USER_ID, nome: 'Teste de busca', role }]);
    if (uri.pathname === '/rest/v1/rpc/matos_is_superadmin') return respond(superadmin);
    if (uri.pathname === '/rest/v1/rpc/matos_notificacoes_inbox') return respond({ total: 0, items: [] });
    if (uri.pathname === '/rest/v1/rpc/gerar_alertas_operacionais') return respond(0);
    const entity = uri.pathname.replace('/rest/v1/', '');
    if (Object.hasOwn(DB, entity)) {
      if (uri.searchParams.has('limit')) requests.push({ entity, auth: route.request().headers().authorization, order: uri.searchParams.get('order') });
      const offset = Number(uri.searchParams.get('offset') || 0);
      return respond(offset === 0 ? DB[entity] : []);
    }
    return respond([]);
  });
  await page.goto('/');
  await expect(page.locator('#notify_bell')).toBeVisible();
  return requests;
}

async function launchSearch(page) {
  if (test.info().project.name.includes('mobile')) {
    await page.locator('#matos_global_mobile').click();
  } else {
    await page.keyboard.press('Control+k');
  }
  await expect(page.locator('#matos_search_input')).toBeVisible();
}

test('administrador encontra registros de todas as categorias sem expor token', async ({ page }) => {
  const requests = await openAccount(page, 'admin');
  await launchSearch(page);
  await page.locator('#matos_search_input').fill('jose');
  await expect(page.locator('.matos-search-result')).toHaveCount(5);
  expect(requests.map((x) => x.entity).sort()).toEqual(Object.keys(DB).sort());
  expect(requests.every((r) => r.auth === 'Bearer synthetic-search-token')).toBe(true);
  expect(requests.every((r) => r.order === 'created_at.desc,id.desc')).toBe(true);

  await page.locator('[data-search-type="cobrancas"]').click();
  await expect(page.locator('.matos-search-result')).toHaveCount(1);
  await page.locator('.matos-search-result').click();
  await expect(page.locator('.matos-search-detail')).toContainText('R$');
  await expect(page.locator('[data-search-go="Pagamentos"]')).toBeVisible();
  await page.locator('[data-search-go="Pagamentos"]').click();
  await expect(page.locator('.pagehead h1')).toHaveText('Pagamentos');
  expect(await page.evaluate(() => window._simpleMonth)).toBe('2026-11');
});

test('consulta por endereço, mês e chamado com filtro e teclas', async ({ page }) => {
  await openAccount(page, 'admin', true);
  await launchSearch(page);
  const input = page.locator('#matos_search_input');

  await input.fill('coronel alexandrino');
  await expect(page.locator('.matos-search-result')).toHaveCount(5);
  await page.locator('[data-search-type="imoveis"]').click();
  await expect(page.locator('.matos-search-result')).toHaveCount(1);
  await page.locator('.matos-search-result').click();
  await expect(page.locator('.matos-search-detail')).toContainText('Galeria Matos');
  await expect(page.locator('[data-search-go="Cadastros"]')).toBeVisible();
  await page.locator('[data-search-back]').click();

  await input.fill('infiltracao');
  await page.locator('[data-search-type="manutencoes"]').click();
  await expect(page.locator('.matos-search-result')).toHaveCount(1);
  await input.press('Escape');
  await expect(page.locator('#matos_global_search')).toHaveCount(0);

  await launchSearch(page);
  await page.locator('#matos_search_input').fill('11/2026');
  await page.locator('[data-search-type="cobrancas"]').click();
  await expect(page.locator('.matos-search-result')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#matos_global_search')).toHaveCount(0);
});

test('proprietário consulta detalhes sem acessar módulos proibidos', async ({ page }) => {
  await openAccount(page, 'proprietario_consulta');
  await launchSearch(page);
  await page.locator('#matos_search_input').fill('infiltracao');
  await page.locator('[data-search-type="manutencoes"]').click();
  await expect(page.locator('.matos-search-result')).toHaveCount(1);
  await page.locator('.matos-search-result').click();
  await expect(page.locator('.matos-search-detail')).toContainText('Infiltração na calha');
  await expect(page.locator('[data-search-go="Relatórios"]')).toBeVisible();
  await expect(page.locator('[data-search-go="Chamados"]')).toHaveCount(0);
  await page.locator('[data-search-go="Relatórios"]').click();
  await expect(page.locator('.pagehead h1')).toHaveText('Relatórios');
  await expect(page.locator('.side [data-page="Chamados"]')).toHaveCount(0);
});

test('busca encerra ao sair, não persiste resultados ou dados entre sessões', async ({ page }) => {
  await openAccount(page, 'admin');
  await launchSearch(page);
  await page.locator('#matos_search_input').fill('jose');
  await expect(page.locator('.matos-search-result')).toHaveCount(5);
  await page.evaluate(() => document.getElementById('logout').click());
  await expect(page.locator('#matos_global_search')).toHaveCount(0);
  await expect(page.locator('#matos_global_mobile')).toHaveCount(0);
});

test('carteira de imóveis mostra indicadores e filtra endereços sem alterar cadastros', async ({ page }) => {
  await openAccount(page, 'admin', true);
  await page.evaluate(() => window.goQuick('Cadastros'));
  await expect(page.locator('.matos-portfolio-properties')).toBeVisible();
  await expect(page.locator('.matos-portfolio-properties .portfolio-stat')).toHaveCount(4);
  await expect(page.locator('.property-address-group')).toHaveCount(1);
  const filter = page.locator('#portfolio_properties_filter');
  await filter.fill('coronel alexandrino');
  await expect(page.locator('.property-address-group:visible')).toHaveCount(1);
  await expect(page.locator('#portfolio_properties_filter_count')).toContainText('1 de 1 imóveis');
  await filter.fill('endereço inexistente');
  await expect(page.locator('#portfolio_properties_filter_empty')).toBeVisible();
  await filter.fill('');
  await expect(page.locator('#newProperty')).toBeVisible();
  await page.locator('#newProperty').click();
  await expect(page.locator('#modal.matos-portfolio-dialog')).toBeVisible();
  await page.locator('#cancelmodal').click();
  await expect(page.locator('#modal')).toHaveCount(0);
});

test('inquilinos mantém busca e formulário com o novo layout', async ({ page }) => {
  await openAccount(page, 'admin', true);
  await page.evaluate(() => window.goQuick('Inquilinos'));
  await expect(page.locator('.matos-portfolio-tenants')).toBeVisible();
  await expect(page.locator('.matos-portfolio-tenants .portfolio-stat')).toHaveCount(4);
  await page.locator('#search').fill('desconhecido');
  await expect(page.locator('#portfolio_tenants_count')).toContainText('0 de 1');
  await page.locator('#search').fill('jose');
  await expect(page.locator('#portfolio_tenants_count')).toContainText('1 de 1');
  await expect(page.locator('#newrec')).toBeVisible();
  await page.locator('#newrec').click();
  await expect(page.locator('#modal.matos-portfolio-dialog')).toBeVisible();
  await page.locator('#cancelmodal').click();
});

test('contratos mostram prazos e o filtro preserva controles de PDF', async ({ page }) => {
  await openAccount(page, 'admin', true);
  await page.evaluate(() => window.goQuick('Contratos'));
  await expect(page.locator('.matos-portfolio-contracts')).toBeVisible();
  await expect(page.locator('.matos-portfolio-contracts .portfolio-stat')).toHaveCount(4);
  await expect(page.locator('[data-contract-attach]')).toBeVisible();
  const filter = page.locator('#portfolio_contracts_filter');
  await filter.fill('galeria matos');
  await expect(page.locator('#portfolio_contracts_filter_count')).toContainText('1 de 1');
  await expect(page.locator('[data-contract-attach]')).toBeVisible();
  await filter.fill('sem correspondência');
  await expect(page.locator('#portfolio_contracts_filter_empty')).toBeVisible();
  await filter.fill('');
  await expect(page.locator('[data-contract-attach]')).toBeVisible();
});

test('ilha React renderiza os cartões de imóveis e preserva navegação e filtros', async ({ page }) => {
  await openAccount(page, 'admin', true);
  await page.evaluate(() => window.goQuick('Cadastros'));
  const island = page.locator('.matos-portfolio-properties .portfolio-stats[data-react-portfolio="mounted"]');
  await expect(island).toBeVisible();
  await expect(island.locator('.portfolio-stat')).toHaveCount(4);
  await expect(island).toContainText('Imóveis cadastrados');
  await expect(island).toContainText('Ocupados');
  await expect(island).toContainText('Endereços');
  const filterIsland = page.locator('.matos-portfolio-properties .portfolio-filterbar[data-react-filter="mounted"]');
  await expect(filterIsland).toBeVisible();
  const search = filterIsland.locator('#portfolio_properties_filter');
  await search.fill('coronel alexandrino');
  await expect(page.locator('#portfolio_properties_filter_count')).toContainText('1 de 1 imóveis');
  await search.fill('JOSE');
  await expect(page.locator('#portfolio_properties_filter_count')).toContainText('1 de 1 imóveis');
  await search.fill('sem resultado');
  await expect(page.locator('#portfolio_properties_filter_count')).toContainText('0 de 1 imóveis');
  await expect(page.locator('#portfolio_properties_filter_empty')).toBeVisible();
  await search.fill('');
  await expect(page.locator('#portfolio_properties_filter_empty')).toBeHidden();
  await page.locator('#newProperty').click();
  await expect(page.locator('#modal.matos-portfolio-dialog')).toBeVisible();
  await page.locator('#cancelmodal').click();
  await page.evaluate(() => window.goQuick('Contratos'));
  await expect(page.locator('.matos-portfolio-contracts')).toBeVisible();
  await expect(page.locator('[data-react-portfolio]')).toHaveCount(0);
  await page.evaluate(() => window.goQuick('Cadastros'));
  await expect(page.locator('.matos-portfolio-properties .portfolio-stats[data-react-portfolio="mounted"]')).toBeVisible();
  await expect(page.locator('.matos-portfolio-properties .portfolio-filterbar[data-react-filter="mounted"]')).toBeVisible();
  await expect(page.locator('.matos-portfolio-properties .portfolio-stat')).toHaveCount(4);
});

test('falha opcional no bundle React preserva cartões HTML e ações', async ({ page }) => {
  await page.route('**/portfolio-react.js*', async (route) => route.abort());
  await openAccount(page, 'admin', true);
  await page.evaluate(() => window.goQuick('Cadastros'));
  const fallback = page.locator('.matos-portfolio-properties .portfolio-stats');
  await expect(fallback).toBeVisible();
  await expect(fallback.locator('.portfolio-stat')).toHaveCount(4);
  await expect(fallback).not.toHaveAttribute('data-react-portfolio', 'mounted');
  await expect(page.locator('.matos-portfolio-properties .portfolio-filterbar')).not.toHaveAttribute('data-react-filter', 'mounted');
  const legacyFilter = page.locator('#portfolio_properties_filter');
  await legacyFilter.fill('coronel');
  await expect(page.locator('#portfolio_properties_filter_count')).toContainText('1 de 1 imóveis');
  await legacyFilter.fill('inexistente');
  await expect(page.locator('#portfolio_properties_filter_empty')).toBeVisible();
  await legacyFilter.fill('');
  await expect(page.locator('#portfolio_properties_filter_empty')).toBeHidden();
  await page.locator('#newProperty').click();
  await expect(page.locator('#modal.matos-portfolio-dialog')).toBeVisible();
  await page.locator('#cancelmodal').click();
});
