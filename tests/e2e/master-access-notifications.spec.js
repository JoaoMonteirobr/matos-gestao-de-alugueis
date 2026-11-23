import { expect,test } from '@playwright/test';

const UID='00000000-0000-4000-8000-000000000111';
const ALERT='00000000-0000-4000-8000-000000000120';
const LOGIN='00000000-0000-4000-8000-000000000121';

async function openRole(page,role='admin',master=false){
 test.skip(process.env.MATOS_E2E_EXTERNAL==='1','Sessões e alertas sintéticos somente em ambiente local.');
 await page.addInitScript(id=>{
  localStorage.setItem('matos_session',JSON.stringify({
   access_token:'simulated-token',user:{id,email:'localtest@example.invalid'}
  }))
 },UID);
 const reads=new Set();
 let resetSends=0;
 const operational={id:ALERT,tipo:'contrato_vencendo',titulo:'Contrato a vencer',mensagem:'Aviso operacional',
  prioridade:'alta',resolvido:false,created_at:'2026-11-21T12:00:00Z'};
 const access={id:LOGIN,tipo:'login',titulo:'Novo acesso ao sistema',mensagem:'Acesso protegido',
  prioridade:'media',resolvido:false,created_at:'2026-11-21T13:00:00Z'};
 await page.route('https://behmmbgbrsesxthsczdl.supabase.co/**',async route=>{
  const url=new URL(route.request().url());
  const action=route.request().method();
  const respond=(data,status=200)=>route.fulfill({
   status,contentType:'application/json',
   headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)
  });
  if(url.pathname==='/auth/v1/user')return respond({id:UID,email:'localtest@example.invalid'});
  if(url.pathname==='/rest/v1/perfis')return respond([{user_id:UID,role,nome:'Usuário de Teste'}]);
  if(url.pathname==='/rest/v1/rpc/matos_is_superadmin')return respond(master);
  if(url.pathname==='/rest/v1/rpc/matos_notificacoes_inbox'){
   const all=master?[access,operational]:[operational];
   const unread=all.filter(a=>!reads.has(a.id));
   return respond({total:reads.size?0:master?125:1,items:unread});
  }
  if(url.pathname==='/rest/v1/alertas')return respond(master?[access,operational]:[operational]);
  if(url.pathname==='/rest/v1/alertas_leituras')return respond([...reads].map(alerta_id=>({alerta_id})));
  if(url.pathname==='/rest/v1/rpc/marcar_alertas_como_lidos'){
   const payload=route.request().postDataJSON();
   for(const id of payload.p_ids||[ALERT,LOGIN])reads.add(id);
   return respond(reads.size);
  }
  if(url.pathname==='/rest/v1/rpc/gerar_alertas_operacionais')return respond(0);
  if(url.pathname==='/functions/v1/push-dispatch')return respond({ok:true,configured:true});
  if(url.pathname==='/functions/v1/telegram-channel')return respond({ok:true,configured:false,linked:false,enabled:false});
  if(url.pathname==='/auth/v1/token'&&action==='POST')return respond({access_token:'temporary-token'});
  if(url.pathname==='/auth/v1/recover'){
   resetSends++;
   return respond({});
  }
  if(url.pathname==='/rest/v1/configuracoes')return respond([]);
  if(url.pathname.startsWith('/rest/v1/'))return respond([]);
  return respond({});
 });
 await page.goto('/');
 await expect(page.locator('#notify_bell')).toBeVisible();
 return {reads,getResets:()=>resetSends};
}

test('conta principal: configurações e senha exclusivas, contador completo e marcar todas',async({page})=>{
 const state=await openRole(page,'admin',true);
 await expect(page.locator('.side [data-page="Acessos"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Configurações"]')).toHaveCount(1);
 await expect(page.locator('#notify_count')).toHaveText('99+');
 await page.locator('#notify_bell').click();
 await expect(page.locator('#notify_list')).toContainText('Novo acesso ao sistema');
 await expect(page.locator('#notify_push')).toBeVisible();
 await page.locator('#notify_all').click();
 await expect(page.locator('#push_test_remote')).toBeVisible();
 await expect(page.locator('#alerts_stat_unread')).toHaveText('2');
 await page.locator('#alerts_mark_all').click();
 await expect(page.locator('#alerts_stat_unread')).toHaveText('0');
 await expect(page.locator('#notify_count')).toBeHidden();
 expect(state.reads.size).toBe(2);
 await page.evaluate(()=>goQuick('Configurações'));
 await page.locator('[data-config="Minha senha"]').click();
 await expect(page.locator('#master_pw_current')).toBeVisible();
 await expect(page.locator('#master_pw_new')).toBeVisible();
 await expect(page.locator('#master_pw_again')).toBeVisible();
});

test('administrador operacional: cadastro e pagamentos sem gerenciamento, logins privados',async({page})=>{
 await openRole(page,'admin',false);
 await expect(page.locator('.side [data-page="Cadastros"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Inquilinos"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Pagamentos"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Relatórios"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Acessos"]')).toHaveCount(0);
 await expect(page.locator('.side [data-page="Configurações"]')).toHaveCount(0);
 await expect(page.locator('.side [data-page="Contratos"]')).toHaveCount(0);
 await expect(page.locator('#notify_count')).toHaveText('1');
 await page.locator('#notify_bell').click();
 await expect(page.locator('#notify_push')).toBeHidden();
 await expect(page.locator('#notify_list')).not.toContainText('Novo acesso ao sistema');
 await page.locator('#notify_all').click();
 await expect(page.locator('#push_test_remote')).toHaveCount(0);
 await expect(page.locator('#telegram_panel')).toHaveCount(0);
 await expect(page.locator('#alerts_list')).not.toContainText('Acesso protegido');
 await expect(page.locator('#session_clock')).toBeVisible();
});

test('proprietário consulta relatórios e notificações, sem botões de gravação',async({page})=>{
 await openRole(page,'proprietario_consulta',false);
 await expect(page.locator('.side [data-page="Relatórios"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Alertas"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Configurações"]')).toHaveCount(0);
 await expect(page.locator('#notify_count')).toHaveText('1');
 await page.locator('#notify_bell').click();
 await page.locator('#notify_all').click();
 await expect(page.locator('#alerts_list')).toContainText('Contrato a vencer');
 await expect(page.locator('#push_test_remote')).toHaveCount(0);
 await expect(page.locator('#alerts_list')).not.toContainText('Novo acesso ao sistema');
 await expect(page.locator('#session_clock')).toBeVisible();
});
