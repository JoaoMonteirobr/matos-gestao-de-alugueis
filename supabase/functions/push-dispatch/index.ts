import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { GoogleAuth } from 'npm:google-auth-library@9.15.1';
import { requireAdmin } from '../_shared/http.ts';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function adminDb() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function localUrl(value: unknown) {
  const raw = typeof value === 'string' ? value : '';
  return /^\/(?!\/)[\w\-/?=&.%]*$/.test(raw) ? raw : '/?pagina=Alertas';
}

function formatMessage(title: string, body: string, url: string, tag: string, projectId: string) {
  const target = localUrl(url);
  return {
    message: {
      data: { title: title.slice(0, 100), body: body.slice(0, 220), url: target, tag },
      webpush: {
        headers: { Urgency: 'high', TTL: '3600' },
        fcm_options: { link: 'https://gestao-alugueis-jp.vercel.app' + target },
      },
    },
    projectId,
  };
}

async function firebaseAuthorization() {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!raw) return null;
  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(raw); } catch { return null; }
  if (typeof credentials.project_id !== 'string' || !credentials.project_id) return null;
  try {
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    const token = await (await auth.getClient()).getAccessToken();
    const accessToken = typeof token === 'string' ? token : token?.token;
    return accessToken ? { accessToken, projectId: credentials.project_id } : null;
  } catch {
    console.error('push_firebase_auth_failed');
    return null;
  }
}

async function sendToFirebase(
  firebase: { accessToken: string; projectId: string },
  endpoint: string,
  title: string,
  body: string,
  url: string,
  tag: string,
) {
  const message = formatMessage(title, body, url, tag, firebase.projectId).message;
  const payload = { message: { token: endpoint, ...message } };
  try {
    const response = await fetch(
      'https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(firebase.projectId) + '/messages:send',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + firebase.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (response.ok) return { ok: true, retry: false, expired: false, reason: '' };
    let apiError: { error?: { status?: string; details?: { errorCode?: string }[] } } = {};
    try { apiError = await response.json(); } catch { /* A mensagem remota não é confiável. */ }
    const code = apiError.error?.status || '';
    const details = apiError.error?.details || [];
    const expired = code === 'UNREGISTERED' ||
      details.some((x) => x.errorCode === 'UNREGISTERED');
    const retry = response.status === 429 || response.status >= 500;
    return {
      ok: false,
      retry,
      expired,
      reason: expired ? 'Dispositivo inválido' : 'Firebase HTTP ' + response.status,
    };
  } catch {
    return { ok: false, retry: true, expired: false, reason: 'Firebase temporariamente indisponível' };
  }
}

async function runDeviceTest(req: Request) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return json({ error: auth.error }, auth.error === 'unauthenticated' ? 401 : 403);
  const db = adminDb();
  if (!db) return json({ error: 'push_server_not_configured' }, 503);
  const devices = await db.from('push_dispositivos')
    .select('id,endpoint,ultimo_teste_em')
    .eq('user_id', auth.user.id).eq('ativo', true)
    .order('ultimo_uso', { ascending: false }).limit(3);
  if (devices.error) return json({ error: 'device_lookup_failed' }, 503);
  if (!devices.data?.length) return json({ error: 'no_active_devices' }, 409);

  // Rate limit por usuário, persistente entre instâncias da função.
  const now = Date.now();
  if (devices.data.some((device) => device.ultimo_teste_em &&
    now - new Date(device.ultimo_teste_em).getTime() < 60000)) {
    return json({ error: 'test_cooldown', retry_after_seconds: 60 }, 429);
  }
  const firebase = await firebaseAuthorization();
  if (!firebase) return json({ error: 'firebase_credentials_not_configured' }, 503);
  let accepted = 0;
  let failed = 0;
  for (const device of devices.data) {
    const result = await sendToFirebase(
      firebase, device.endpoint,
      'Teste remoto | Casa Matos',
      'Esta mensagem foi enviada pelo servidor mesmo sem o sistema estar aberto.',
      '/?pagina=Alertas', 'matos-push-teste',
    );
    await db.from('push_dispositivos').update({
      ultimo_teste_em: new Date().toISOString(),
      ...(result.expired ? { ativo: false } : {}),
    }).eq('id', device.id).eq('user_id', auth.user.id);
    if (result.ok) accepted++;
    else failed++;
  }
  return json({ ok: accepted > 0, accepted_by_firebase: accepted, failed, devices: devices.data.length },
    accepted ? 200 : 502);
}

async function dispatch(req: Request, action: unknown) {
  // Bloquear chamadas públicas antes de consultar qualquer credencial de servidor.
  const supplied = req.headers.get('x-push-dispatch-secret') || '';
  if (supplied.length < 64) return json({ error: 'unauthorized' }, 401);
  const db = adminDb();
  if (!db) return json({ error: 'push_server_not_configured' }, 503);
  const verified = await db.rpc('validar_chave_dispatch_push', { p_chave: supplied });
  if (verified.error) return json({ error: 'push_auth_not_configured' }, 503);
  if (verified.data !== true) return json({ error: 'unauthorized' }, 401);
  const firebase = await firebaseAuthorization();
  if (!firebase) return json({ error: 'firebase_credentials_not_configured' }, 503);

  if (action === 'status') return json({ ok: true, provider: 'firebase', authenticated: true });
  const claim = await db.rpc('claim_push_fila', { p_limit: 5 });
  if (claim.error) return json({ error: 'queue_claim_failed' }, 500);
  if (!claim.data?.length) return json({ ok: true, processados: 0, enviados: 0, erros: 0 });

  let sent = 0;
  let failed = 0;
  let retried = 0;
  for (const item of claim.data) {
    const devices = await db.from('push_dispositivos')
      .select('id,endpoint').eq('user_id', item.user_id).eq('ativo', true);
    let success = false;
    let retry = Boolean(devices.error);
    let lastError = devices.error ? 'Falha na consulta dos dispositivos' : 'Nenhum dispositivo ativo';
    for (const device of devices.data || []) {
      const result = await sendToFirebase(
        firebase, device.endpoint, item.titulo, item.mensagem, item.url,
        'matos-alerta-' + item.alerta_id,
      );
      if (result.ok) success = true;
      else {
        lastError = result.reason;
        retry = retry || result.retry;
        if (result.expired) {
          await db.from('push_dispositivos').update({ ativo: false }).eq('id', device.id);
        }
      }
    }
    if (success) {
      await db.from('push_fila').update({
        status: 'enviado', enviado_em: new Date().toISOString(),
        ultimo_erro: null, proxima_tentativa_em: null, processando_em: null,
      }).eq('id', item.id);
      sent++;
    } else {
      const willRetry = retry && Number(item.tentativas) < 5;
      const delayMinutes = Math.min(60, 2 ** Math.max(1, Number(item.tentativas)));
      await db.from('push_fila').update({
        status: willRetry ? 'pendente' : 'erro',
        ultimo_erro: lastError, processando_em: null,
        proxima_tentativa_em: willRetry
          ? new Date(Date.now() + delayMinutes * 60000).toISOString() : null,
      }).eq('id', item.id);
      if (willRetry) retried++;
      else failed++;
    }
  }
  return json({ ok: true, processados: claim.data.length, enviados: sent, erros: failed, reagendados: retried });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  // O teste é uma operação de usuário autenticado; dispatch é reservado ao cron.
  const body = await req.json().catch(() => ({}));
  if (body?.action === 'test') return runDeviceTest(req);
  return dispatch(req, body?.action);
});
