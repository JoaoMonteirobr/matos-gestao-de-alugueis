import { expect, test } from '@playwright/test';

const USER_ID = '00000000-0000-4000-8000-000000000111';
const CODE = 'mt_' + 'A'.repeat(32);

async function openAdmin(page, configured=true) {
  test.skip(process.env.MATOS_E2E_EXTERNAL === '1', 'Teste do fluxo autenticado simulado roda apenas localmente.');
  await page.addInitScript((id) => {
    localStorage.setItem('matos_session', JSON.stringify({
      access_token: 'token-simulado',
      user: { id, email: 'telegram-test@example.invalid' },
    }));
  }, USER_ID);
  let linked=false, tested=false, enabled=false;
  let autoDispatchCalls=0,manualTestCalls=0;
  await page.route('https://behmmbgbrsesxthsczdl.supabase.co/**', async (route) => {
    const url=new URL(route.request().url());
    const respond=(data,status=200)=>route.fulfill({
      status,contentType:'application/json',
      headers:{'access-control-allow-origin':'*'},
      body:JSON.stringify(data),
    });
    if(url.pathname==='/auth/v1/user')return respond({id:USER_ID,email:'telegram-test@example.invalid'});
    if(url.pathname==='/rest/v1/perfis')return respond([{user_id:USER_ID,nome:'Administrador',role:'admin'}]);
    if(url.pathname==='/rest/v1/alertas')return respond([]);
    if(url.pathname==='/rest/v1/alertas_leituras')return respond([]);
    if(url.pathname==='/rest/v1/push_dispositivos')return respond([]);
    if(url.pathname==='/functions/v1/push-dispatch')return respond({ok:true,provider:'firebase',configured:true});
    if(url.pathname==='/functions/v1/telegram-channel'){
      const data=route.request().postDataJSON();
      if(data.action==='dispatch')autoDispatchCalls++;
      if(data.action==='status'){
        return respond({
          ok:true,configured,bot_healthy:configured,
          bot_username:configured?'MatosPilotBot':undefined,
          linked,enabled,tested,
        });
      }
      expect(configured).toBe(true);
      if(data.action==='pair'){
        return respond({ok:true,code:CODE,link:'https://t.me/MatosPilotBot?start='+CODE,expires_minutes:15});
      }
      if(data.action==='verify'){
        expect(data.code).toBe(CODE);linked=true;
        return respond({ok:true,linked:true,enabled:false});
      }
      if(data.action==='test'){
        expect(linked).toBe(true);tested=true;manualTestCalls++;
        return respond({ok:true,accepted_by_telegram:true});
      }
      if(data.action==='enable'){
        expect(tested).toBe(true);enabled=true;
        return respond({ok:true,enabled:true});
      }
      if(data.action==='disable'){enabled=false;return respond({ok:true,enabled:false});}
      if(data.action==='disconnect'){
        enabled=false;linked=false;tested=false;
        return respond({ok:true,linked:false});
      }
      throw new Error('Unexpected Telegram action: '+data.action);
    }
    return respond([]);
  });
  await page.goto('/');
  await expect(page.locator('#notify_bell')).toBeVisible();
  await page.locator('#notify_bell').click();
  await page.locator('#notify_all').click();
  await expect(page.getByRole('heading',{name:'Alertas',exact:true})).toBeVisible();
  await expect(page.locator('#telegram_panel')).toBeVisible();
  return {
    stats:()=>({autoDispatchCalls,manualTestCalls,linked,enabled,tested}),
  };
}

test('sem bot configurado: mostra instruções, sem ativar envios',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const control=await openAdmin(page,false);
  await expect(page.locator('#telegram_panel')).toContainText('criar seu bot gratuito');
  await expect(page.locator('#telegram_panel')).toContainText('MATOS_TELEGRAM_BOT_TOKEN');
  await expect(page.locator('#telegram_badge')).toContainText('Desligado');
  await expect(page.locator('#telegram_panel')).not.toContainText('Enviar mensagem de teste');
  expect(control.stats().autoDispatchCalls).toBe(0);
  expect(errors).toEqual([]);
});

test('vincula bot, testa mensagem e só ativa por confirmação explícita',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const control=await openAdmin(page,true);
  await expect(page.locator('#telegram_badge')).toHaveText('Desligado');
  await page.getByRole('button',{name:'Gerar link de vinculação'}).click();
  await expect(page.locator('#telegram_open_link')).toHaveAttribute('href','https://t.me/MatosPilotBot?start='+CODE);
  expect(control.stats().enabled).toBe(false);

  await page.getByRole('button',{name:'Verificar vínculo'}).click();
  await expect(page.locator('#telegram_panel')).toContainText('Conectado · envio automático desligado');
  expect(control.stats().enabled).toBe(false);
  expect(control.stats().autoDispatchCalls).toBe(0);

  await page.getByRole('button',{name:'Enviar mensagem de teste'}).click();
  await expect(page.locator('#telegram_msg')).toContainText('O Telegram aceitou a mensagem de teste');
  await expect(page.getByRole('button',{name:'Recebi o teste — ativar avisos'})).toBeVisible();
  expect(control.stats().manualTestCalls).toBe(1);
  expect(control.stats().enabled).toBe(false);

  await page.getByRole('button',{name:'Recebi o teste — ativar avisos'}).click();
  await expect(page.locator('#telegram_badge')).toHaveText('Ativo');
  expect(control.stats().enabled).toBe(true);
  await page.getByRole('button',{name:'Desativar avisos'}).click();
  await expect(page.locator('#telegram_badge')).toHaveText('Conectado · desligado');
  expect(control.stats().enabled).toBe(false);
  expect(control.stats().autoDispatchCalls).toBe(0);
  expect(errors).toEqual([]);
});
