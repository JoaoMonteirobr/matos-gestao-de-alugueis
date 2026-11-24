import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (name) => fs.readFileSync(path.join(process.cwd(), name), 'utf8');
const ui = source('app1.js');
const ownerUi = source('simple-ui.js');
const profile = source('meu-perfil.js');
const edge = source('supabase/functions/master-recovery/index.ts');
const sql = source('supabase/migrations/20261123123533_master_recovery_private_rate_limit.sql');

describe('recuperacao exclusiva e menus por permissao', () => {
  it('nunca solicita reset direto pelo navegador e mostra mensagem generica', () => {
    expect(ui).toContain("'/functions/v1/master-recovery'");
    expect(ui).not.toContain("'/auth/v1/recover?");
    expect(ui).toContain('Se esta conta estiver habilitada para recuperação');
    expect(ui).not.toContain('joaomonteiro2122');
  });

  it('restringe envio a dono privado, e faz throttling no banco', () => {
    expect(edge).toContain('matos_allow_master_recovery');
    expect(edge).toContain("if (await allowedResponse.json() !== true)");
    expect(edge).toContain('GENERIC');
    expect(edge).not.toContain('joaomonteiro2122');
    expect(sql).toContain('matos_private.superadmin');
    expect(sql).toContain('matos_private.master_recovery_throttle');
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.matos_allow_master_recovery(text) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.matos_allow_master_recovery(text) TO service_role');
    expect(sql).not.toContain('joaomonteiro2122');
  });

  it('mantem acesso principal e restringe o proprietario a consulta e alertas', () => {
    expect(ownerUi).toContain("var consultaMenus=['Dashboard','Relatórios','Alertas']");
    expect(ownerUi).toContain("var ownerMain=['Dashboard','Relatórios','Alertas']");
    expect(ownerUi).toContain('var dashboardActions=');
    expect(ownerUi).toContain('var adminMain=adminBaseMenus.concat');
    expect(ui).toContain("matosIsSuperAdmin?'Superadministrador':'Administrador'");
    expect(profile).toContain('master_pw_shortcut');
    expect(profile).toContain("window.MatosSettings.open('Minha senha')");
  });
});
