import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read=(file)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
const migration=read('supabase/migrations/20261120_telegram_alertas_de_login.sql');
const initialMigration=read('supabase/migrations/20261120_telegram_canal_piloto.sql');
const login=read('supabase/functions/secure-login/index.ts');
const sender=read('supabase/functions/telegram-channel/index.ts');
const ui=read('telegram-integration.js');
const styles=read('telegram-ui.css');
const html=read('index.html');

describe('avisos de acesso seguros pelo Telegram',()=>{
  it('habilita opção somente para vínculo ativo já existente; novos vínculos desligados',()=>{
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS notificar_logins boolean NOT NULL DEFAULT false');
    expect(migration).toContain('WHERE ativo=true AND notificar_logins=false');
    expect(migration).not.toMatch(/UPDATE\s+public\.(?:cobrancas|imoveis|contratos|iptu)/i);
  });
  it('enfileira somente novos logins opt-in e não repete alertas antigos',()=>{
    expect(initialMigration).toContain('AFTER INSERT');
    expect(migration).toContain("WHERE v.ativo AND (NEW.tipo<>'login' OR v.notificar_logins)");
    expect(migration).toContain('ON CONFLICT(alerta_id,user_id) DO NOTHING');
    expect(migration).toContain("AND (a.tipo<>'login' OR v.notificar_logins)");
    expect(migration).toContain("f.created_at < now()-interval '24 hours'");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.alertas/i);
  });
  it('relaciona o alerta a um login auditado específico sem IP explícito na mensagem',()=>{
    expect(login).toContain("db.from('login_auditoria').insert(");
    expect(login).toContain("}).select('id').maybeSingle()");
    expect(login).toContain('login_audit:');
    expect(login).toContain('auditInsert.data.id');
    expect(login).toContain("tipo: 'login'");
    expect(login).not.toContain('IP:');
  });
  it('gera alerta com nome, localização aproximada, dispositivo, navegador e hora local',()=>{
    expect(sender).toContain("async function loginNotification(");
    expect(sender).toContain("db.from('login_auditoria')");
    expect(sender).toContain("db.from('perfis').select('nome')");
    expect(sender).toContain('Localização aproximada: ');
    expect(sender).toContain('Dispositivo: ');
    expect(sender).toContain('Navegador: ');
    expect(sender).toContain('Data e horário: ');
    expect(sender).toContain("timeZone:'America/Rio_Branco'");
    expect(sender).toContain("alert.data.tipo==='login'");
    expect(sender).toContain('await loginNotification(db,alert.data)');
  });
  it('consulta geolocalização HTTPS apenas de IP público e não expõe IP cru no Telegram',()=>{
    expect(sender).toContain('https://ipwho.is/');
    expect(sender).toContain('AbortSignal.timeout(3500)');
    expect(sender).toContain("if(!publicIp)return 'Não identificada'");
    expect(sender).toContain('a===10||a===127');
    expect(sender).toContain("const location=await approximateLocation(audit?.ip)");
    const senderText=sender.slice(sender.indexOf('async function loginNotification('),sender.indexOf('async function internalDispatch('));
    expect(senderText).not.toContain("audit?.ip +");
    expect(senderText).not.toContain("'IP: '");
    expect(senderText).toContain('não pelo GPS.');
  });
  it('permite ligar/desligar logins por usuário administrador, mantendo outros eventos',()=>{
    expect(sender).toContain("action === 'set_login_notifications'");
    expect(sender).toContain('await requireAdmin(req)');
    expect(sender).toContain(".eq('user_id',userId)");
    expect(sender).toContain("notificar_logins:body.enabled");
    expect(sender).toContain("link.data.notificar_logins");
    expect(sender).toContain("eq('tipo','login')");
    expect(sender).toContain("status:'descartado'");
    expect(ui).toContain("await callTelegram('set_login_notifications',{enabled})");
    expect(ui).toContain('Desativar avisos de login');
    expect(ui).toContain('Ativar avisos de login');
    expect(html).toContain('/telegram-integration.js?v=2');
    expect(styles).toContain('.telegram-security-setting');
  });
});
