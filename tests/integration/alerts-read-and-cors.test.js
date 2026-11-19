import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(path.join(process.cwd(),file),'utf8');
const migration = read('supabase/migrations/20261119_alertas_leituras_individuais.sql');
const edge = read('supabase/functions/push-dispatch/index.ts');
const common = read('supabase/functions/_shared/http.ts');
const page = read('alerts.js');
const bell = read('notification-session.js');
const html = read('index.html');
const css = read('alerts-ui.css');

describe('alertas simples, leitura privada e push com CORS', () => {
  it('registra leitura por usuário sem resolver qualquer pendência financeira', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.alertas_leituras');
    expect(migration).toContain('PRIMARY KEY (user_id, alerta_id)');
    expect(migration).toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(migration).toContain('ALTER TABLE public.alertas_leituras ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('user_id = (SELECT auth.uid())');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('NOT a.resolvido');
    expect(migration).toContain('ON CONFLICT (user_id, alerta_id) DO NOTHING');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.marcar_alertas_como_lidos(uuid[]) TO authenticated');
    expect(migration).not.toMatch(/UPDATE\s+public\.(?:alertas|cobrancas|contratos|iptu)/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.alertas/i);
    expect(migration).not.toContain('SECURITY DEFINER');
  });
  it('mantém a resolução separada da leitura e oferece botão em massa e filtros', () => {
    expect(page).toContain('Marcar todas como lidas');
    expect(page).toContain('marcar_alertas_como_lidos');
    expect(page).toContain('p_ids:ids||null');
    expect(page).toContain('Não lidas');
    expect(page).toContain('Pendências');
    expect(page).toContain('Acessos');
    expect(page).toContain('Histórico completo');
    expect(page).toContain('if(!done&&operational(a)&&currentRole');
    expect(page).toContain("body:JSON.stringify({resolvido:true,resolvido_em:new Date().toISOString()})");
    expect(page).toContain('As pendências continuam abertas');
    expect(bell).toContain('/rest/v1/alertas_leituras?select=alerta_id');
    expect(bell).toContain('window.refreshMatosBell=refreshBell');
  });
  it('corrige preflight sem permitir CORS amplo nem remover autorização', () => {
    expect(edge).toContain("import { corsHeaders, requireAdmin } from '../_shared/http.ts'");
    expect(edge).toContain("req.method === 'OPTIONS'");
    expect(edge).toContain("headers: corsHeaders(req)");
    expect(edge).toContain("headers: { ...corsHeaders(req), 'Content-Type': 'application/json'");
    expect(edge).toContain("req.headers.get('x-push-dispatch-secret')");
    expect(edge).toContain("const auth = await requireAdmin(req)");
    expect(common).toContain("if (origin && allowedOrigins().has(origin))");
    expect(common).not.toContain("'Access-Control-Allow-Origin': '*'");
  });
  it('carrega layout compacto e mantém teste remoto acessível', () => {
    expect(html).toContain('/alerts-ui.css?v=2');
    expect(html).toContain('/alerts.js?v=20261119-2');
    expect(html).toContain('/notification-session.js?v=3');
    expect(css).toContain('@media(max-width:640px)');
    expect(css).toContain('.alerts-filter-bar');
    expect(page).toContain('id="push_test_remote"');
    expect(page).toContain('id="push_server_status"');
    expect(page).toContain('Ativar e configurar notificações');
  });
});
