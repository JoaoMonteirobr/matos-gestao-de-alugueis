import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const sql = read('supabase/migrations/20261118_push_externo_seguro_e_confiavel.sql');
const edge = read('supabase/functions/push-dispatch/index.ts');
const client = read('pwa.js');
const sw = read('sw.js');
const alerts = read('alerts.js');
const index = read('index.html');

describe('push externo seguro e confiável', () => {
  it('programa o cron com chave em Vault, sem segredos no repositório', () => {
    expect(sql).toContain("vault.create_secret(");
    expect(sql).toContain("encode(extensions.gen_random_bytes(32),'hex')");
    expect(sql).toContain("name='push_dispatch_secret'");
    expect(sql).toContain("'x-push-dispatch-secret'");
    expect(sql).toContain("create or replace function public.validar_chave_dispatch_push");
    expect(sql).toContain("revoke all on function public.validar_chave_dispatch_push(text)");
    expect(sql).toContain("grant execute on function public.validar_chave_dispatch_push(text) to service_role");
    expect(sql).not.toMatch(/x-push-dispatch-secret['"]?\s*[:,]\s*['"][a-zA-Z0-9]{64}/i);
  });

  it('não inicia dispatch sem chave e autoriza teste somente por admin', () => {
    expect(edge).toContain("req.headers.get('x-push-dispatch-secret')");
    expect(edge).toContain("db.rpc('validar_chave_dispatch_push'");
    expect(edge).toContain('const auth = await requireAdmin(req)');
    expect(edge).toContain(".eq('user_id', auth.user.id)");
    expect(edge).toContain("body?.action === 'test'");
    expect(edge).toContain("accepted_by_firebase:");
    expect(edge).toContain("if (action === 'status') return json({ ok: true, provider: 'firebase', authenticated: true });");
    expect(edge).toContain('retry_after_seconds: 60');
    expect(edge.indexOf("if (supplied.length < 64)")).toBeLessThan(edge.indexOf("const db = adminDb();", edge.indexOf('async function dispatch(')));
    expect(edge).not.toContain('FIREBASE_SERVICE_ACCOUNT_JSON='); // credencial só em ambiente
  });

  it('não envia backlog antigo ou alertas de login, preservando histórico', () => {
    expect(sql).toContain("f.created_at < now()-interval '24 hours'");
    expect(sql).toContain("a.resolvido or a.tipo='login'");
    expect(sql).toContain("ultimo_erro='Não entregue:");
    expect(sql).toContain("and a.tipo <> 'login'");
    expect(sql).toContain('for update of f skip locked');
    expect(sql).toContain("limit least(greatest(coalesce(p_limit,5),1),5)");
    expect(sql).not.toMatch(/delete\s+from\s+public\.push_fila/i);
    expect(sql).not.toMatch(/truncate\s+public\.push_fila/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.alertas/i);
    expect(sql).not.toMatch(/update\s+public\.(cobrancas|imoveis|iptu)\b/i);
  });

  it('trata falha transitória e token inválido sem falsificar sucesso', () => {
    expect(sql).toContain('proxima_tentativa_em timestamptz');
    expect(edge).toContain('result.retry');
    expect(edge).toContain('const willRetry = retry && Number(item.tentativas) < 5');
    expect(edge).toContain('result.expired');
    expect(edge).toContain("status: willRetry ? 'pendente' : 'erro'");
    expect(edge).toContain("status: 'enviado'");
    expect(edge).toContain("status: 'enviado', enviado_em: new Date().toISOString()");
  });

  it('envia apenas payload data, com um único toast do service worker', () => {
    expect(edge).toContain("data: { title:");
    expect(edge).toContain("fcm_options: { link: 'https://gestao-alugueis-jp.vercel.app'");
    expect(edge).not.toContain('notification: { title: item.titulo');
    expect(sw).toContain("notification.title || data.title || 'Matos – Gestão de Aluguéis'");
    expect(sw).toContain('messaging.onBackgroundMessage');
    expect(sw).toContain('safeNotificationUrl(data.url)');
  });

  it('mantém inscrição do aparelho, checa servidor e distingue teste local e remoto', () => {
    expect(client).toContain('await registerSW()');
    expect(client).not.toContain('registerSW(true)');
    expect(client).not.toContain('getRegistrations()');
    expect(client).toContain('window.testMatosRemotePush=async function()');
    expect(client).toContain("body:JSON.stringify({action:'test'})");
    expect(client).toContain('window.getMatosPushDiagnostics=async function()');
    expect(client).toContain("const devices=await request('/rest/v1/push_dispositivos");
    expect(client).toContain('isIos()&&!isInstalled()');
    expect(client).toContain('window.matchMedia');
    expect(alerts).toContain('Testar push remoto (Firebase)');
    expect(alerts).toContain('testRemotePushUI()');
    expect(alerts).toContain('refreshMatosPushStatusUI()');
    expect(index).toContain('/pwa.js?v=4');
    expect(index).toContain('/alerts.js?v=20261118-1');
  });
});
