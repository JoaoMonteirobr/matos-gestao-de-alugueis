import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const source = (name) => fs.readFileSync(path.join(process.cwd(), name), 'utf8');

describe('Central de Alertas acessível após sobrescrita do menu', () => {
  test('menu moderno preserva Alertas ao reconstruir adminMenus e ownerMenus', () => {
    const main = source('simple-ui.js');
    expect(main).toContain("var adminMain=['Dashboard','Alertas']");
    expect(main).toContain("var ownerMain=['Dashboard','Alertas'");
    expect(main).toContain('adminMenus=adminMain; ownerMenus=ownerMain');
    expect(source('alerts.js')).toContain("if(page==='Alertas')return alertasPage()");
  });

  test('sino abre central e exibe atalho de configurações push', () => {
    const client = source('notification-session.js');
    const styles = source('notification-session.css');
    expect(client).toContain('id="notify_all"');
    expect(client).toContain('id="notify_push"');
    expect(client).toContain('window.openMatosPushSettings=openPushSettings');
    expect(client).toContain('window.matosScrollToPush=true;openAlerts()');
    expect(client).toContain("page='Alertas';rememberPage();shell()");
    expect(styles).toContain('.notify-footer');
    expect(source('alerts.js')).toContain("pushBtn.scrollIntoView({block:'center',behavior:'smooth'})");
  });

  test('login fica no histórico, mas não ocupa o badge do sino operacional', () => {
    const client = source('notification-session.js');
    const center = source('alerts.js');
    expect(client).toContain('&tipo=neq.login&order=created_at.desc');
    expect(center).toContain("if(a.tipo==='login')return");
    expect(center).toContain("Novo");
  });

  test('Playwright usa o servidor local com mocks em vez de pular testes', () => {
    const runner = source('scripts/run-e2e.mjs');
    const spec = source('tests/e2e/push-externo.spec.js');
    expect(runner).toContain("MATOS_E2E_EXTERNAL: process.env.PLAYWRIGHT_BASE_URL ? '1' : '0'");
    expect(spec).toContain("process.env.MATOS_E2E_EXTERNAL === '1'");
    expect(spec).toContain("page.locator('#notify_all').click()");
    expect(spec).toContain("page.locator('#notify_push').click()");
    expect(spec).toContain("page.locator('#push_test_remote').click()");
  });
});
