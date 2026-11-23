import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read=(p)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
const sql=read('supabase/migrations/20261122_superadmin_operacional_alertas.sql');
const app=read('app1.js');
const simple=read('simple-ui.js');
const bell=read('notification-session.js');
const alerts=read('alerts.js');
const auth=read('supabase/functions/_shared/http.ts');
const recover=read('supabase/functions/superadmin-recovery/index.ts');
const access=read('access-management.js');
const telegram=read('telegram-integration.js');
const push=read('pwa.js');
const profile=read('meu-perfil.js');
const theme=read('theme-led.js');
const index=read('index.html');

describe('superadministrador exclusivo e privilégios mínimos',()=>{
 it('promove uma única conta confirmada, preservando administrador e proprietária',()=>{
  expect(sql).toContain("p.nome='João Paulo' AND p.role='admin'");
  expect(sql).toContain('IF n<>1 THEN');
  expect(sql).toContain("nome='Ney Freitas' AND role='admin'");
  expect(sql).toContain("nome='Maria Gorette Buzanello Matos' AND role='proprietario_consulta'");
  expect(sql).toContain("UPDATE public.perfis SET role='superadmin'");
  expect(sql).toContain("p.role='superadmin'");
  expect(sql).toContain("p.role IN ('superadmin','admin')");
  expect(sql).not.toMatch(/UPDATE\s+public\.(?:cobrancas|contratos|imoveis|financeiro|iptu)/i);
 });
 it('restringe RLS de escrita para operador às três áreas de cadastro',()=>{
  for(const table of ['imoveis','inquilinos','cobrancas']){
   expect(sql).toContain('matos_operador_'+table+'_select');
   expect(sql).toContain('matos_operador_'+table+'_insert');
   expect(sql).toContain('matos_operador_'+table+'_update');
   expect(sql).not.toContain('matos_operador_'+table+'_delete');
  }
  for(const table of ['contratos','proprietarios','iptu','financeiro','gastos','manutencoes','repasses']){
   expect(sql).toContain("'"+table+"'");
  }
  expect(sql).toMatch(/ALTER TABLE public\.perfis\s+ADD CONSTRAINT perfis_role_check/);
  expect(sql).toContain('USING(public.is_admin())');
  expect(sql).toContain("configuracoes_auth_select");
  expect(sql).toContain('admins_read_login_auditoria');
  expect(sql).toContain("a.tipo<>'login'");
 });
 it('autorizações das Edge Functions dependem do papel interno real, não do frontend',()=>{
  expect(auth).toContain("profile.data?.role !== 'superadmin'");
  expect(auth).toContain('client.auth.getUser(token)');
  expect(auth).not.toContain('user_metadata.role');
  for(const file of ['admin-create-user','telegram-channel','push-dispatch']){
   expect(read('supabase/functions/'+file+'/index.ts')).toContain('requireAdmin');
  }
  expect(access).toContain('isMatosSuper()');
  expect(telegram).toContain('isMatosSuper()');
  expect(push).toContain('isMatosSuper()');
 });
 it('menu operacional não mostra ajustes, acessos, notificações externas ou exclusão financeira',()=>{
  expect(app).toContain("var operadorMenus=['Dashboard','Cadastros','Inquilinos','Pagamentos','Relatórios','Alertas','Meu perfil']");
  expect(app).toContain("menus=isMatosSuper()?adminMenus:");
  expect(app).toContain("function canMatosEditSection(p)");
  expect(simple).toContain("var admin=isMatosSuper(),api=window.MatosContractFiles");
  expect(simple).toContain("if(page==='Configurações'&&isMatosSuper())");
  expect(read('app2.js')).toContain("if(!canMatosEditSection(p))return");
  expect(read('app2.js')).toContain("if(!isMatosSuper())return");
  expect(read('contract-pdfs.js')).toContain("if(!isMatosSuper())");
  expect(profile).toContain("isMatosSuper()&&a.length<12");
  expect(simple).toContain('Minha senha');
 });
});

describe('recuperação protegida do gestor',()=>{
 it('solicita reset somente para e-mail confirmado do superadmin',()=>{
  expect(recover).toContain(".eq('role','superadmin').maybeSingle()");
  expect(recover).toContain('getUserById(profile.data.user_id)');
  expect(recover).toContain("!user.email_confirmed_at");
  expect(recover).toContain('resetPasswordForEmail(email,{redirectTo:SITE})');
  expect(recover).toContain("matos_pode_recuperar_senha");
  expect(sql).toContain("interval '10 minutes'");
  expect(recover).toContain('const GENERIC=');
  expect(recover).not.toContain('console.log(email)');
 });
 it('não permite recuperação direta para qualquer e-mail como o login antigo',()=>{
  expect(app).toContain("'/functions/v1/superadmin-recovery'");
  expect(app).not.toContain("'/auth/v1/recover?redirect_to='");
  expect(app).toContain("hash.get('type')!=='recovery'");
  expect(app).toContain('history.replaceState');
  expect(app).toContain('Salvar nova senha');
  expect(theme).toContain("&&!(window.session&&session.access_token)&&!matosRecoveryToken");
  expect(app).toContain("headers:authHeaders(matosRecoveryToken)");
  expect(app).not.toContain('matos_recovery_token');
 });
});

describe('notificações internas e contadores por usuário',()=>{
 it('usa RPC exata e prévia sob RLS, sem contar logins no sino',()=>{
  expect(sql).toContain('FUNCTION public.contar_alertas_nao_lidos()');
  expect(sql).toContain('FUNCTION public.listar_alertas_nao_lidos(');
  expect(sql).toContain('SECURITY INVOKER');
  expect(sql).toContain("a.tipo<>'login'");
  expect(sql).toContain('l.user_id=(SELECT auth.uid())');
  expect(bell).toContain("'/rest/v1/rpc/contar_alertas_nao_lidos'");
  expect(bell).toContain("'/rest/v1/rpc/listar_alertas_nao_lidos'");
  expect(bell).toContain("unread>99?'99+':String(unread)");
  expect(bell).not.toContain('resolvido=eq.false&tipo=neq.login&order=created_at.desc&limit=200');
 });
 it('mostra sino em todos os perfis sem expor configuração técnica aos demais',()=>{
  expect(bell).toContain("tools.innerHTML=bellMarkup()+(canMatosOperate()?'':timerMarkup())");
  expect(bell).toContain("isMatosSuper()?'<div class=\"notify-footer\"");
  expect(simple).toContain("var tenantMain=['Dashboard','Pagamentos','IPTU','Chamados','Alertas']");
  expect(app).toContain("'Relatórios','Alertas'];");
  expect(alerts).toContain("(isMatosSuper()?pushPanel():'')");
  expect(alerts).toContain("isMatosSuper()&&window.matosTelegramPanel");
  expect(alerts).toContain('window._alertsUnreadTotal');
  expect(alerts).toContain('tipo=neq.login');
  expect(alerts).toContain('tipo=eq.login');
  expect(alerts).toContain('markAllAlertsReadUI');
  expect(bell).toContain('session.user.id!==userId');
 });
 it('fornece versões atualizadas para evitar cache de papéis antigos',()=>{
  expect(index).toContain('/app1.js?v=20261122-1');
  expect(index).toContain('/simple-ui.js?v=22');
  expect(index).toContain('/notification-session.js?v=4');
  expect(index).toContain('/alerts.js?v=20261122-1');
  expect(index).toContain('/meu-perfil.js?v=3');
 });
});
