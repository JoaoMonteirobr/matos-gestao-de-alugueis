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
      requests.push({ entity, auth: route.request().headers().authorization });
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
  await page.locator('#logout').click();
  await expect(page.locator('#matos_global_search')).toHaveCount(0);
  await expect(page.locator('#matos_global_mobile')).toHaveCount(0);
});
