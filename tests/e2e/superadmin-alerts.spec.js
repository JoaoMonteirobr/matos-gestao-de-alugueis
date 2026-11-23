import { expect, test } from '@playwright/test';

const UID='00000000-0000-4000-8000-000000000111';
const ALERT_A={
 id:'00000000-0000-4000-8000-000000000021',
 tipo:'cobranca_vencendo',titulo:'Aluguel prestes a vencer',
 mensagem:'Cobrança de imóvel de teste.',prioridade:'alta',
 data_evento:'2026-11-22',created_at:'2026-11-22T20:00:00Z',resolvido:false,
};
const ALERT_B={...ALERT_A,id:'00000000-0000-4000-8000-000000000022',
 tipo:'contrato_vencendo',titulo:'Contrato de teste próximo do vencimento',
};
const LOGIN={...ALERT_A,id:'00000000-0000-4000-8000-000000000023',
 tipo:'login',titulo:'Novo acesso ao sistema',mensagem:'Acesso privado de gestor.',
};
async function openRole(page,role){
 test.skip(process.env.MATOS_E2E_EXTERNAL==='1','Fluxos autenticados apenas com backend simulado local.');
 const seen=new Set(),requests=[];
 await page.addInitScript(id=>{
  localStorage.setItem('matos_session',JSON.stringify({
   access_token:'mocked-token',user:{id,email:'example@example.invalid'}
  }));
 },UID);
 await page.route('https://behmmbgbrsesxthsczdl.supabase.co/**',async route=>{
  const u=new URL(route.request().url()),pathname=u.pathname;
  const reply=(obj,code=200)=>route.fulfill({status:code,contentType:'application/json',
   headers:{'access-control-allow-origin':'*'},body:JSON.stringify(obj)});
  requests.push(pathname);
  if(pathname==='/auth/v1/user')return reply({id:UID,email:'example@example.invalid'});
  if(pathname==='/rest/v1/perfis')return reply([{user_id:UID,nome:'Conta simulada',role}]);
  if(pathname==='/rest/v1/alertas'){
   if(u.searchParams.get('tipo')==='eq.login')return reply(role==='superadmin'?[LOGIN]:[]);
   if(u.searchParams.get('tipo')==='neq.login')return reply([ALERT_A,ALERT_B]);
   return reply(role==='superadmin'?[ALERT_A,ALERT_B,LOGIN]:[ALERT_A,ALERT_B]);
  }
  if(pathname==='/rest/v1/alertas_leituras'){
   return reply([...seen].map(alerta_id=>({alerta_id})));
  }
  if(pathname==='/rest/v1/rpc/gerar_alertas_operacionais')return reply(0);
  if(pathname==='/rest/v1/rpc/contar_alertas_nao_lidos')return reply([ALERT_A,ALERT_B].filter(a=>!seen.has(a.id)).length);
  if(pathname==='/rest/v1/rpc/listar_alertas_nao_lidos')return reply([ALERT_A,ALERT_B].filter(a=>!seen.has(a.id)));
  if(pathname==='/rest/v1/rpc/marcar_alertas_como_lidos'){
   const body=route.request().postDataJSON();
   (body.p_ids||[ALERT_A.id,ALERT_B.id]).forEach(id=>{seen.add(id)});
   return reply(seen.size);
  }
  if(pathname==='/functions/v1/push-dispatch')return reply({ok:true,configured:true,provider:'firebase'});
  if(pathname==='/functions/v1/telegram-channel')return reply({ok:true,configured:false,linked:false,enabled:false});
  if(pathname==='/rest/v1/push_dispositivos')return reply([]);
  if(pathname==='/rest/v1/alertas_lidos')return reply([]);
  if(pathname==='/rest/v1/configuracoes')return reply([{id:1,nome_administradora:'Casa Matos'}]);
  if(pathname==='/functions/v1/admin-create-user')return reply({ok:true,items:[]});
  return reply([]);
 });
 await page.goto('/');
 await expect(page.locator('#notify_bell')).toBeVisible();
 await expect(page.locator('#notify_count')).toHaveText('2');
 return {seen,requests};
}

test('gestor tem ajustes exclusivos, logins separados e troca de senha',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const {requests}=await openRole(page,'superadmin');
 await expect(page.locator('.side [data-page="Configurações"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Acessos"]')).toHaveCount(1);
 await page.locator('#notify_bell').click();
 await expect(page.locator('#notify_push')).toBeVisible();
 await expect(page.locator('#notify_list')).not.toContainText('Acesso privado de gestor');
 await page.locator('#notify_all').click();
 await expect(page.locator('#push_test_remote')).toBeVisible();
 await expect(page.locator('#telegram_panel')).toBeVisible();
 await expect(page.locator('[data-alert-filter="acessos"]')).toBeVisible();
 await expect(page.locator('#alerts_stat_unread')).toHaveText('2');
 await page.locator('[data-alert-filter="acessos"]').click();
 await expect(page.locator('#alerts_list')).toContainText('Novo acesso ao sistema');

 await page.evaluate(()=>goQuick('Configurações'));
 await expect(page.getByRole('button',{name:'Abrir Minha senha'})).toBeVisible();
 await page.getByRole('button',{name:'Abrir Minha senha'}).click();
 await expect(page.locator('#pw_save')).toBeVisible();
 await expect(page.locator('#pw_new')).toBeVisible();
 expect(requests.filter(x=>x==='/rest/v1/rpc/gerar_alertas_operacionais').length).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});

test('administrador operacional recebe alertas, mas não gerencia sistema',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const {seen}=await openRole(page,'admin');
 await expect(page.locator('.side [data-page="Configurações"]')).toHaveCount(0);
 await expect(page.locator('.side [data-page="Acessos"]')).toHaveCount(0);
 await expect(page.locator('.side [data-page="Cadastros"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Pagamentos"]')).toHaveCount(1);
 await page.locator('#notify_bell').click();
 await expect(page.locator('#notify_push')).toHaveCount(0);
 await expect(page.locator('#notify_list')).toContainText('Aluguel prestes a vencer');
 await page.locator('#notify_all').click();
 await expect(page.locator('#telegram_panel')).toHaveCount(0);
 await expect(page.locator('#push_test_remote')).toHaveCount(0);
 await expect(page.locator('[data-alert-filter="acessos"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Marcar todas como lidas'}).click();
 await expect(page.locator('#alerts_stat_unread')).toHaveText('0');
 await expect(page.locator('#notify_count')).toBeHidden();
 expect(seen.has(ALERT_A.id)&&seen.has(ALERT_B.id)).toBe(true);
 expect(errors).toEqual([]);
});

test('proprietária vê notificações e relatórios sem escrita ou configuração',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openRole(page,'proprietario_consulta');
 await expect(page.locator('.side [data-page="Relatórios"]')).toHaveCount(1);
 await expect(page.locator('.side [data-page="Alertas"]')).toHaveCount(1);
 await expect(page.locator('#session_timer')).toBeVisible();
 await page.locator('#notify_bell').click();
 await expect(page.locator('#notify_count')).toHaveText('2');
 await page.locator('#notify_all').click();
 await expect(page.locator('#alerts_mark_all')).toBeEnabled();
 await expect(page.locator('#push_test_remote')).toHaveCount(0);
 await expect(page.locator('#telegram_panel')).toHaveCount(0);
 await expect(page.locator('[data-alert-filter="acessos"]')).toHaveCount(0);
 await expect(page.locator('.side [data-page="Configurações"]')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('link de recuperação remove credencial da URL e permite trocar senha',async({page})=>{
 let updates=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://behmmbgbrsesxthsczdl.supabase.co/**',async route=>{
  const url=new URL(route.request().url()),method=route.request().method();
  if(url.pathname==='/auth/v1/user'&&method==='PUT'){
   const data=route.request().postDataJSON();expect(data.password).toBe('SenhaNovaMuitoForte2026!');
   expect(route.request().headers().authorization).toBe('Bearer token-temporario');
   updates++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:UID})});
  }
  return route.fulfill({status:200,contentType:'application/json',body:'[]'});
 });
 await page.goto('/#access_token=token-temporario&type=recovery');
 await expect(page.locator('#recover_pw')).toBeVisible();
 await expect(page).not.toHaveURL(/token-temporario/);
 await page.locator('#recover_pw').fill('SenhaNovaMuitoForte2026!');
 await page.locator('#recover_confirm').fill('SenhaNovaMuitoForte2026!');
 await page.locator('#recover_save').click();
 await expect(page.locator('#signin')).toBeVisible();
 expect(updates).toBe(1);expect(errors).toEqual([]);
});
