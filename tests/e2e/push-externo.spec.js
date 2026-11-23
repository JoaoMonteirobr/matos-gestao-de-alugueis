import { expect, test } from '@playwright/test';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const LOGIN_ALERT = {
  id: '00000000-0000-4000-8000-000000000002',
  tipo: 'login',
  titulo: 'Novo acesso ao sistema',
  mensagem: 'Admin entrou no sistema.',
  prioridade: 'media',
  data_evento: '2026-11-18',
  resolvido: false,
  created_at: '2026-11-18T23:00:00Z',
};
const OPERATIONAL_ALERT = {
  id: '00000000-0000-4000-8000-000000000003',
  tipo: 'contrato_vencendo',
  titulo: 'Contrato próximo do vencimento',
  mensagem: 'Contrato de teste vence em breve.',
  prioridade: 'alta',
  data_evento: '2026-11-30',
  resolvido: false,
  created_at: '2026-11-18T22:00:00Z',
};

async function openAdmin(page) {
  // No CI o app local contém dados simulados. Não tenta fazer login real.
  test.skip(process.env.MATOS_E2E_EXTERNAL === '1', 'Não simular uma sessão em produção.');

  await page.addInitScript((id) => {
    localStorage.setItem('matos_session', JSON.stringify({
      access_token: 'token-teste',
      user: { id, email: 'teste@example.invalid' },
    }));
    localStorage.setItem('matos_push_token', 'token-fcm-de-teste');
  }, USER_ID);

  const readByUser = new Set();
  await page.route('https://behmmbgbrsesxthsczdl.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    const respond = (data, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(data),
    });
    if (url.pathname === '/auth/v1/user') {
      return respond({ id: USER_ID, email: 'teste@example.invalid' });
    }
    if (url.pathname === '/rest/v1/perfis') {
      return respond([{ user_id: USER_ID, nome: 'Gestor de teste', role: 'superadmin' }]);
    }
    if (url.pathname === '/rest/v1/alertas') {
      if (url.searchParams.get('tipo') === 'neq.login') return respond([OPERATIONAL_ALERT]);
      if (url.searchParams.get('tipo') === 'eq.login') return respond([LOGIN_ALERT]);
      return respond([LOGIN_ALERT, OPERATIONAL_ALERT]);
    }
    if (url.pathname === '/rest/v1/rpc/contar_alertas_nao_lidos') {
      return respond(readByUser.has(OPERATIONAL_ALERT.id) ? 0 : 1);
    }
    if (url.pathname === '/rest/v1/rpc/listar_alertas_nao_lidos') {
      return respond(readByUser.has(OPERATIONAL_ALERT.id) ? [] : [OPERATIONAL_ALERT]);
    }
    if (url.pathname === '/rest/v1/alertas_leituras') {
      return respond([...readByUser].map((alerta_id) => ({ alerta_id })));
    }
    if (url.pathname === '/rest/v1/rpc/marcar_alertas_como_lidos') {
      const data = route.request().postDataJSON();
      const ids = data.p_ids || [LOGIN_ALERT.id, OPERATIONAL_ALERT.id];
      ids.forEach((id) => { readByUser.add(id); });
      return respond(ids.length);
    }
    if (url.pathname === '/rest/v1/push_dispositivos') {
      return respond([{ endpoint: 'token-fcm-de-teste', ativo: true }]);
    }
    if (url.pathname === '/functions/v1/push-dispatch') {
      const payload = route.request().postDataJSON();
      if (payload.action === 'diagnostic') {
        return respond({ ok: true, provider: 'firebase', configured: true });
      }
      expect(payload.action).toBe('test');
      expect(payload.device_token).toBe('token-fcm-de-teste');
      return respond({ ok: true, accepted_by_firebase: 1, failed: 0, devices: 1 });
    }
    return respond([]);
  });

  await page.goto('/');
  await expect(page.locator('#notify_bell')).toBeVisible();
}

test('sino: Ver todas abre Alertas e mostra configuração de push', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openAdmin(page);

  await page.locator('#notify_bell').click();
  await expect(page.locator('#notify_all')).toBeVisible();
  await expect(page.locator('#notify_count')).toHaveText('1');
  await expect(page.locator('#notify_list')).not.toContainText('Novo acesso ao sistema');
  await expect(page.locator('#notify_list')).toContainText('Contrato próximo do vencimento');

  await page.locator('#notify_all').click();
  await expect(page.getByRole('heading', { name: 'Alertas', exact: true })).toBeVisible();
  await expect(page.locator('#push_test_remote')).toBeVisible();
  await expect(page.locator('#push_server_status')).toHaveText('Firebase conectado');
  await expect(page.locator('.side [data-page="Alertas"]')).toHaveCount(1);
  await expect(page.locator('#alerts_stat_unread')).toHaveText('1');
  await expect(page.locator('#alerts_stat_active')).toHaveText('1');
  await expect(page.locator('#alerts_list')).toContainText('Contrato próximo do vencimento');
  await expect(page.locator('#alerts_list')).not.toContainText('Novo acesso ao sistema');

  await page.locator('[data-alert-filter="acessos"]').click();
  await expect(page.locator('#alerts_list')).toContainText('Novo acesso ao sistema');
  await page.locator('[data-alert-filter="pendencias"]').click();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Alertas', exact: true })).toBeVisible();
  await expect(page.locator('#push_test_remote')).toBeVisible();
  expect(errors).toEqual([]);
});

test('atalho do sino permite testar push remoto Firebase no celular e desktop', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openAdmin(page);

  await page.locator('#notify_bell').click();
  await page.locator('#notify_push').click();
  await expect(page.getByRole('heading', { name: 'Alertas', exact: true })).toBeVisible();
  await expect(page.locator('#push_test_remote')).toBeVisible();

  // O serviço de permissão do navegador e a conta são simulados: não emite push real.
  await page.evaluate(() => {
    window.getMatosPushDiagnostics = async () => ({
      active: true, permission: 'granted',
      serverRegistered: true, deviceCount: 1, ios: false, installed: true,
    });
  });
  await page.locator('#push_test_remote').click();
  await expect(page.locator('#push_msg')).toContainText('Firebase aceitou o envio para este aparelho');
  expect(errors).toEqual([]);
});

test('marcar todas como lidas não resolve contratos e mantém leitura após recarregar', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openAdmin(page);

  await page.locator('#notify_bell').click();
  await page.locator('#notify_all').click();
  await expect(page.locator('#alerts_stat_unread')).toHaveText('1');

  await page.locator('#alerts_mark_all').click();
  await expect(page.locator('#alerts_stat_unread')).toHaveText('0');
  await expect(page.locator('#alerts_stat_active')).toHaveText('1');
  await expect(page.locator('#alerts_msg')).toContainText('As pendências continuam abertas');
  await expect(page.locator('#alerts_list')).toContainText('Resolver pendência');
  await expect(page.locator('#notify_count')).toBeHidden();

  await page.locator('[data-alert-filter="nao_lidas"]').click();
  await expect(page.locator('#alerts_list')).toContainText('Tudo lido');
  await page.reload();
  await expect(page.locator('#alerts_stat_unread')).toHaveText('0');
  await expect(page.locator('#alerts_stat_active')).toHaveText('1');
  expect(errors).toEqual([]);
});


test('Android: falha do serviço push apresenta diagnóstico e não marca celular como ativo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openAdmin(page);
  await page.locator('#notify_bell').click();
  await page.locator('#notify_push').click();
  await expect(page.locator('#push_test_remote')).toBeVisible();
  await page.locator('#push_advanced').evaluate((element) => { element.open = true; });

  await page.evaluate(() => {
    localStorage.setItem('matos_push_last_error', 'push-service-error');
    window.enableRemotePush = async () => {
      throw new Error(window.MatosPushFailure.message(
        new Error('Registration failed - push service error'),
      ));
    };
    window.getMatosPushDiagnostics = async () => ({
      permission: 'granted',
      ios: false,
      installed: false,
      online: true,
      workerActive: true,
      pushSubscription: false,
      serverRegistered: true,
      deviceCount: 2,
      lastError: 'push-service-error',
      active: false,
    });
    window.diagnoseMatosPush = async () => ({
      permission: 'granted', online: true, workerActive: true,
      pushSubscription: false, serverRegistered: true, active: false,
      advice: 'O Chrome/Android recusou a inscrição. Verifique Chrome e Serviços do Google Play.',
    });
  });
  await page.evaluate(() => window.refreshMatosPushStatusUI());
  await expect(page.locator('#push_status')).toHaveText('Falha no serviço push do Android');
  await expect(page.locator('#push_device_hint')).toBeVisible();
  await page.getByRole('button', { name: 'Ativar notificações' }).click();
  await expect(page.locator('#push_msg')).toContainText('O serviço push do Chrome/Android recusou a inscrição');
  await expect(page.locator('#push_msg')).toContainText('Serviços do Google Play');

  await page.locator('#push_diagnose').click();
  await expect(page.locator('#push_msg')).toContainText('Inscrição push do navegador: não encontrada');
  await expect(page.locator('#push_msg')).toContainText('Verifique Chrome e Serviços do Google Play.');
  expect(errors).toEqual([]);
});


test('reparação: Chrome Android falha na inscrição nativa sem afirmar que Firebase falhou', async ({ page }) => {
  const errors=[];
  page.on('pageerror',(e)=>errors.push(e.message));
  await openAdmin(page);
  await page.locator('#notify_bell').click();
  await page.locator('#notify_push').click();
  await page.locator('#push_advanced').evaluate((el)=>{el.open=true});
  await expect(page.locator('#push_repair')).toBeVisible();

  await page.evaluate(()=>{
    window.repairMatosPush=async()=>({
      ok:false,stage:'browser',reason:'O Chrome/Android recusou a inscrição push.'
    });
  });
  await page.locator('#push_repair').click();
  await expect(page.locator('#push_msg')).toContainText('O serviço push do Chrome/Android recusou a inscrição');
  await expect(page.locator('#push_msg')).not.toContainText('Credencial Firebase pendente');
  await expect(page.locator('#push_repair')).toBeEnabled();

  await page.evaluate(()=>{
    window.repairMatosPush=async()=>({
      ok:true,stage:'done',reason:'Inscrição do navegador e registro do Firebase/Supabase confirmados neste celular.'
    });
  });
  await page.locator('#push_repair').click();
  await expect(page.locator('#push_msg')).toContainText('Inscrição do navegador e registro do Firebase/Supabase confirmados');
  expect(errors).toEqual([]);
});
