import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read=(file)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
const identity=read('supabase/migrations/20261122_master_identity_private.sql');
const permissions=read('supabase/migrations/20261122_master_permissions_notifications.sql');
const auth=read('supabase/functions/_shared/http.ts');
const shell=read('app1.js');
const menus=read('simple-ui.js');
const alerts=read('alerts.js');
const bell=read('notification-session.js');
const security=read('master-security.js');
const access=read('access-management.js');
const telegram=read('telegram-integration.js');
const index=read('index.html');

describe('conta principal e permissões por papel',()=>{
 it('guarda titular em esquema não exposto, sem UID ou e-mail embutidos',()=>{
  expect(identity).toContain('CREATE SCHEMA IF NOT EXISTS matos_private');
  expect(identity).toContain('REVOKE ALL ON SCHEMA matos_private FROM PUBLIC,anon,authenticated');
  expect(identity).toContain('matos_private.superadmin');
  expect(identity).toContain('ENABLE ROW LEVEL SECURITY');
  expect(identity).toContain('SECURITY DEFINER');
  expect(identity).not.toContain('João Paulo');
  expect(identity).not.toMatch(/@[a-z0-9-]+\.[a-z]+/i);
  expect(permissions).toContain('IF n<>1 THEN');
  expect(permissions).toContain('trg_matos_preservar_conta_principal');
  expect(permissions).not.toMatch(/INSERT INTO matos_private\.superadmin.*[0-9a-f-]{36}/i);
 });
 it('protege escrita estrutural e leitura da auditoria por RLS',()=>{
  expect(permissions).toContain('ALTER POLICY perfis_admin_all');
  expect(permissions).toContain('ALTER POLICY configuracoes_admin_all');
  expect(permissions).toContain('ALTER POLICY auditoria_admin_select');
  expect(permissions).toContain('ALTER POLICY admins_read_login_auditoria');
  for(const table of ['contratos','documentos','financeiro','iptu','gastos','proprietarios','repasses','vistorias','manutencoes']){
   expect(permissions).toContain("'"+table+"'");
  }
  expect(permissions).toContain("FOREACH tab IN ARRAY ARRAY['proprietarios','gastos'");
  expect(permissions).toContain("matos_operador_consulta");
  expect(permissions).toContain('documentos_imoveis_admin_delete');
  expect(permissions).toContain('public.gerar_repasses_mes(date)');
  expect(permissions).toContain('public.gerar_cobrancas_mes(date)');
  expect(permissions).toContain('public.gerar_alertas_operacionais()');
  expect(permissions).toContain('if not public.matos_is_superadmin() then');
  expect(permissions).toContain('gastos_notas_admin_insert');
 });
 it('operador mantém imóveis, inquilinos, pagamentos e relatórios, sem configurações',()=>{
  expect(shell).toContain("var operatorMenus=['Dashboard','Cadastros','Inquilinos','Pagamentos','Relatórios','Alertas']");
  expect(shell).toContain('matosIsSuperAdmin?adminMenus:operatorMenus');
  expect(shell).toContain("currentRole==='admin'");
  expect(menus).toContain("if(page==='Configurações'&&matosIsSuperAdmin)");
  expect(menus).toContain("if(!matosIsSuperAdmin||settingsSections.indexOf(section)<0)return");
  expect(access).toContain('if(!matosIsSuperAdmin)');
  expect(auth).toContain("client.rpc('matos_is_superadmin')");
  expect(auth).toContain("owner.data !== true");
 });
 it('notificações por usuário: contador total, proteção de logins e leitura persistente',()=>{
  expect(permissions).toContain('SECURITY INVOKER');
  expect(permissions).toContain('matos_notificacoes_inbox');
  expect(permissions).toContain("a.tipo <> 'login' OR public.matos_is_superadmin()");
  expect(permissions).toContain("a.resolvido=false");
  expect(permissions).toContain('(SELECT count(*) FROM visible)');
  expect(permissions).toContain('LIMIT 8');
  expect(permissions).toContain("tipo <> 'login' AND (public.is_admin() OR public.eh_consulta_geral())");
  expect(bell).toContain("'/rest/v1/rpc/matos_notificacoes_inbox'");
  expect(bell).toContain('renderBellRows(data&&data.items||[],data&&data.total||0)');
  expect(bell).toContain('generation!==bellRefreshGeneration');
  expect(bell).toContain("setInterval(refreshBell,30000)");
  expect(bell).toContain('tools.innerHTML=bellMarkup()');
  expect(bell).toContain('footer.hidden=!matosIsSuperAdmin');
  expect(alerts).toContain('if(matosIsSuperAdmin){refreshMatosPushStatusUI()');
  expect(alerts).toContain("window.refreshMatosBell()");
  expect(menus).toContain("'Relatórios','Alertas'");
  expect(telegram).toContain('if(!matosIsSuperAdmin)');
 });
 it('a conta principal altera senha com confirmação e validação de recuperação server-side',()=>{
  expect(security).toContain('function validPassword(value)');
  expect(security).toContain("method:'PUT'");
  expect(security).toContain("'/auth/v1/token?grant_type=password'");
  expect(security).toContain("hash.get('type')==='recovery'");
  expect(security).toContain("'/rest/v1/rpc/matos_is_superadmin'");
  expect(security).toContain("history.replaceState(null,'',location.pathname+location.search)");
  expect(security).not.toContain('localStorage.setItem');
  expect(security).not.toContain('console.log');
  expect(shell).toContain('MatosMasterSecurity.recoverIfPresent()');
  expect(menus).toContain("section==='Minha senha'");
  expect(index).toContain('/master-security.js?v=2');
 });
});
