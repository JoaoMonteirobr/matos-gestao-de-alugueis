import { expect, test } from '@playwright/test';

test('push remoto: interface distingue teste externo e mostra aceite pelo Firebase', async ({ page }) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'Teste funcional com respostas simuladas é executado apenas no build local.');
  const userId = '00000000-0000-4000-8000-000000000001';
  await page.addInitScript((id) => {
    localStorage.setItem('matos_session', JSON.stringify({
      access_token: 'token-teste',
      user: { id, email: 'teste@example.invalid' },
    }));
    localStorage.setItem('matos_push_token', 'token-fcm-de-teste');
  }, userId);

  await page.route('https://behmmbgbrsesxthsczdl.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    const respond = (data, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(data),
    });
    if (url.pathname === '/auth/v1/user') return respond({ id: userId, email: 'teste@example.invalid' });
    if (url.pathname === '/rest/v1/perfis') return respond([{ user_id: userId, nome: 'Admin de teste', role: 'admin' }]);
    if (url.pathname === '/rest/v1/alertas') return respond([]);
    if (url.pathname === '/rest/v1/push_dispositivos') return respond([
      { endpoint: 'token-fcm-de-teste', ativo: true },
    ]);
    if (url.pathname === '/functions/v1/push-dispatch') {
      const data = route.request().postDataJSON();
      if (data.action === 'diagnostic') return respond({ ok: true, provider: 'firebase', configured: false });
      expect(data.action).toBe('test');
      return respond({ ok: true, accepted_by_firebase: 1, failed: 0, devices: 1 });
    }
    return respond([]);
  });

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => window.goQuick('Alertas'));
  await expect(page.locator('#push_test_remote')).toBeVisible();
  await expect(page.locator('#content')).toContainText('Testar notificação local');
  await expect(page.locator('#content')).toContainText('Firebase');
  await expect(page.locator('#push_server_status')).toContainText('Credencial Firebase pendente');

  // A permissão real pertence ao usuário; somente este teste simula o diagnóstico.
  await page.evaluate(() => {
    window.getMatosPushDiagnostics = async () => ({
      active: true,
      permission: 'granted',
      serverRegistered: true,
      deviceCount: 1,
      ios: false,
      installed: true,
    });
  });

  await page.locator('#push_test_remote').click();
  await expect(page.locator('#push_msg')).toContainText('Firebase aceitou o envio para 1 aparelho');
  expect(errors).toEqual([]);
});
