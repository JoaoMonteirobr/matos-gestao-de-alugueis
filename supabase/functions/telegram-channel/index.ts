import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders, json, readJson, requireAdmin } from '../_shared/http.ts';

type TelegramResponse = {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

const HOME = 'https://gestao-alugueis-jp.vercel.app/?pagina=Alertas';
const BOT_URL = 'https://api.telegram.org/bot';
const MAX_QUEUE = 5;

function dbClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return url && key ? createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) : null;
}
function botToken() {
  const key = Deno.env.get('MATOS_TELEGRAM_BOT_TOKEN') || '';
  return /^\d{5,16}:[A-Za-z0-9_-]{25,}$/.test(key) ? key : null;
}
function errorCode(result: TelegramResponse, fallback = 'telegram_unavailable') {
  if (result.error_code === 409) return 'telegram_webhook_conflict';
  if (result.error_code === 401 || result.error_code === 404) return 'telegram_invalid_token';
  if (result.error_code === 403) return 'telegram_chat_blocked';
  if (result.error_code === 429) return 'telegram_rate_limited';
  return fallback;
}
async function botApi(method: string, body: unknown, token: string): Promise<TelegramResponse> {
  try {
    const result = await fetch(BOT_URL + token + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const payload = await result.json().catch(() => ({}));
    if (!payload || typeof payload !== 'object') return { ok: false, error_code: result.status };
    return payload as TelegramResponse;
  } catch {
    return { ok: false, description: 'network_unavailable' };
  }
}
async function findBot(token: string) {
  const result = await botApi('getMe', {}, token);
  const data = result.result as { username?: unknown } | undefined;
  const username = typeof data?.username === 'string' ? data.username : '';
  if (!result.ok || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
  return username;
}
async function sha256(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return 'mt_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function privateChatId(chat: unknown): string | null {
  if (!chat || typeof chat !== 'object') return null;
  const info = chat as { id?: unknown; type?: unknown };
  if (info.type !== 'private') return null;
  const value = info.id;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return String(value);
}
async function sendMessage(token: string, chatId: string, message: string) {
  return botApi('sendMessage', {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: 'Abrir Casa Matos', url: HOME }]] },
  }, token);
}
function category(kind: unknown) {
  const labels: Record<string, string> = {
    cobranca_atrasada: 'Aluguel em atraso',
    cobranca_vencendo: 'Aluguel a vencer',
    contrato_vencido: 'Contrato vencido',
    contrato_vencendo: 'Contrato a vencer',
    documento_vencendo: 'Documento a vencer',
  };
  return typeof kind === 'string' ? labels[kind] || 'Pendência de gestão' : 'Pendência de gestão';
}

// Cidade/estado/país aproximados pela rede; não é localização GPS.
// Usa apenas IP do registro de auditoria quando alertas de acesso estão
// habilitados. O endereço completo nunca integra o texto do Telegram.
function safeText(value: unknown, limit=100) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,limit) : '';
}
function remoteIp(ip: unknown) {
  const input=safeText(ip,45);
  if(!input || !/^[0-9a-fA-F:.]{3,45}$/.test(input))return null;
  if(input.includes(':')){
    if(input.toLowerCase().startsWith('fe80:')||input==='::1'||input.toLowerCase().startsWith('fc')||
       input.toLowerCase().startsWith('fd'))return null;
    return input;
  }
  const parts=input.split('.');
  if(parts.length!==4||parts.some(x=>!/^\d{1,3}$/.test(x)||Number(x)>255))return null;
  const [a,b]=parts.map(Number);
  if(a===0||a===10||a===127||a>=224||
    (a===172&&b>=16&&b<=31)||(a===192&&b===168)||
    (a===169&&b===254)||(a===100&&b>=64&&b<=127))return null;
  return input;
}
async function approximateLocation(ip: unknown) {
  const publicIp=remoteIp(ip);
  if(!publicIp)return 'Não identificada';
  try{
    const response=await fetch('https://ipwho.is/'+encodeURIComponent(publicIp)+
      '?fields=success,city,region,country', {signal:AbortSignal.timeout(3500)});
    if(!response.ok)return 'Não identificada';
    const result=await response.json() as {
      success?:boolean;city?:unknown;region?:unknown;country?:unknown
    };
    if(!result.success)return 'Não identificada';
    const location=[result.city,result.region,result.country]
      .map(x=>safeText(x,60)).filter(Boolean);
    return location.length?location.join(', '):'Não identificada';
  }catch{return 'Não identificada';}
}
function deviceDetails(userAgent: unknown) {
  const ua=safeText(userAgent,700);
  const os=/Android/i.test(ua)?'Android':/iPhone/i.test(ua)?'iPhone':
    /iPad/i.test(ua)?'iPad':/Windows/i.test(ua)?'Windows':
    /Macintosh|Mac OS X/i.test(ua)?'Mac':/Linux/i.test(ua)?'Linux':'Não identificado';
  const browser=/Edg\//i.test(ua)?'Microsoft Edge':/OPR\//i.test(ua)?'Opera':
    /Firefox\//i.test(ua)?'Firefox':/Chrome\//i.test(ua)?'Chrome':
    /Safari\//i.test(ua)?'Safari':'Não identificado';
  return {os,browser};
}
function loginDate(value: unknown) {
  const date=new Date(typeof value==='string'?value:'');
  if(Number.isNaN(date.getTime()))return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR',{
    timeZone:'America/Rio_Branco',day:'2-digit',month:'2-digit',year:'numeric',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,
  }).format(date)+' (Rio Branco/AC)';
}
async function loginNotification(db: ReturnType<typeof createClient>, alert: {
  referencia_key?:unknown; mensagem?:unknown;created_at?:unknown
}) {
  const auditId=typeof alert.referencia_key==='string' &&
    /^login_audit:[a-f0-9-]{36}$/i.test(alert.referencia_key)
    ?alert.referencia_key.slice('login_audit:'.length):null;
  let audit: {user_id?:string;ip?:string;user_agent?:string;created_at?:string}|null=null;
  if(auditId){
    const result=await db.from('login_auditoria')
      .select('user_id,ip,user_agent,created_at')
      .eq('id',auditId).eq('sucesso',true).maybeSingle();
    if(!result.error)audit=result.data;
  }
  let name='Usuário';
  if(audit?.user_id){
    const profile=await db.from('perfis').select('nome')
      .eq('user_id',audit.user_id).maybeSingle();
    if(!profile.error && profile.data?.nome)name=safeText(profile.data.nome,85);
  }
  if(name==='Usuário'){
    const match=/^(.{1,90}?) entrou no sistema em /i.exec(safeText(alert.mensagem,500));
    if(match)name=safeText(match[1],85);
  }
  const device=deviceDetails(audit?.user_agent);
  if(device.os==='Não identificado'){
    const old=/Dispositivo:\s*([^.]*)/i.exec(safeText(alert.mensagem,500));
    if(old)device.os=safeText(old[1],80);
  }
  const location=await approximateLocation(audit?.ip);
  return 'MATOS | Novo acesso ao sistema' +
    '\nUsuário: '+name +
    '\nLocalização aproximada: '+location +
    '\nDispositivo: '+device.os +
    '\nNavegador: '+device.browser +
    '\nData e horário: '+loginDate(audit?.created_at||alert.created_at) +
    '\n\nA localização é estimada pelo IP, não pelo GPS.' +
    '\nSe não reconhecer o acesso, revise as contas na Casa Matos.';
}

async function internalDispatch(req: Request) {
  const supplied = req.headers.get('x-matos-telegram-secret') || '';
  if (supplied.length !== 64) return json(req, { error: 'unauthorized' }, 401);
  const db = dbClient();
  if (!db) return json(req, { error: 'server_not_configured' }, 503);
  const valid = await db.rpc('validar_chave_telegram_dispatch', { p_chave: supplied });
  if (valid.error) return json(req, { error: 'dispatch_auth_unavailable' }, 503);
  if (valid.data !== true) return json(req, { error: 'unauthorized' }, 401);
  const token = botToken();
  if (!token) return json(req, { error: 'bot_not_configured' }, 503);
  const batch = await db.rpc('claim_telegram_fila', { p_limit: MAX_QUEUE });
  if (batch.error) return json(req, { error: 'queue_unavailable' }, 503);
  let sent = 0, retried = 0, failed = 0;
  for (const item of batch.data || []) {
    const [link, alert] = await Promise.all([
      db.from('telegram_vinculos').select('chat_id,ativo,notificar_logins').eq('user_id', item.user_id).maybeSingle(),
      db.from('alertas').select('tipo,resolvido,referencia_key,mensagem,created_at').eq('id', item.alerta_id).maybeSingle(),
    ]);
    let status = 'erro', reason = 'telegram_link_unavailable', retryAt: string | null = null;
    let telegramFailure: TelegramResponse | null = null;
    if (!link.error && link.data?.ativo && !alert.error && alert.data && !alert.data.resolvido &&
      (alert.data.tipo !== 'login' || link.data.notificar_logins)) {
      const priority = item.prioridade === 'urgente' ? 'Urgente' :
        item.prioridade === 'alta' ? 'Alta' : 'Normal';
      const message = alert.data.tipo==='login'
        ?await loginNotification(db,alert.data)
        :'MATOS | ' + category(alert.data.tipo) +
          '\nPrioridade: ' + priority +
          '\nConsulte a Casa Matos para ver detalhes e tomar providências.';
      telegramFailure = await sendMessage(token, link.data.chat_id, message);
      if (telegramFailure.ok) {
        status = 'enviado';
        reason = '';
      } else {
        reason = errorCode(telegramFailure, 'telegram_delivery_failed');
        const retry = telegramFailure.error_code === 429 ||
          (telegramFailure.error_code != null && telegramFailure.error_code >= 500) ||
          telegramFailure.description === 'network_unavailable';
        if (retry && item.tentativas < 4) {
          status = 'pendente';
          const seconds = Math.max(
            60, Math.min(900, telegramFailure.parameters?.retry_after || Math.pow(2, item.tentativas) * 60)
          );
          retryAt = new Date(Date.now() + seconds * 1000).toISOString();
        } else if (telegramFailure.error_code === 403) {
          await db.from('telegram_vinculos').update({ ativo: false, updated_at: new Date().toISOString() })
            .eq('user_id', item.user_id);
        }
      }
    } else {
      status = 'descartado';
      reason = 'alert_or_channel_inactive';
    }
    const updated = await db.from('telegram_fila').update({
      status, ultimo_erro: reason || null, processando_em: null,
      proxima_tentativa_em: retryAt,
      enviado_em: status === 'enviado' ? new Date().toISOString() : null,
    }).eq('id', item.id).eq('status', 'enviando');
    if (updated.error) console.error('telegram_queue_update_failed');
    if (status === 'enviado') sent++;
    else if (status === 'pendente') retried++;
    else failed++;
  }
  return json(req, { ok: true, processed: (batch.data || []).length, sent, retried, failed });
}

async function adminAction(req: Request, body: Record<string, unknown>) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return json(req, { error: auth.error }, auth.error === 'unauthenticated' ? 401 : 403);
  const db = dbClient();
  if (!db) return json(req, { error: 'server_not_configured' }, 503);
  const userId = auth.user.id;
  const token = botToken();
  const action = body.action;

  if (action === 'status') {
    const link = await db.from('telegram_vinculos')
      .select('bot_username,vinculado_em,testado_em,ativo,notificar_logins').eq('user_id', userId).maybeSingle();
    if (link.error) return json(req, { error: 'status_unavailable' }, 503);
    if (!token) return json(req, {
      ok: true, configured: false, linked: !!link.data, enabled: false,
    });
    const username = await findBot(token);
    return json(req, {
      ok: true, configured: true, bot_healthy: Boolean(username),
      linked: !!link.data, enabled: Boolean(link.data?.ativo),
      login_notifications: Boolean(link.data?.notificar_logins),
      tested: Boolean(link.data?.testado_em),
      bot_username: username || undefined,
    });
  }
  if (!token) return json(req, { error: 'bot_not_configured' }, 503);
  if (action === 'pair') {
    const username = await findBot(token);
    if (!username) return json(req, { error: 'bot_invalid_token' }, 503);
    const code = newCode();
    const hash = await sha256(code);
    await db.from('telegram_pareamentos').delete().eq('user_id', userId);
    const create = await db.from('telegram_pareamentos').insert({
      code_hash: hash, user_id: userId,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    if (create.error) return json(req, { error: 'pair_unavailable' }, 503);
    return json(req, { ok: true, code, link: 'https://t.me/' + username + '?start=' + code, expires_minutes: 15 });
  }
  if (action === 'verify') {
    const code = typeof body.code === 'string' ? body.code : '';
    if (!/^mt_[A-Za-z0-9_-]{32}$/.test(code)) return json(req, { error: 'invalid_pair_code' }, 400);
    const hash = await sha256(code);
    const pair = await db.from('telegram_pareamentos')
      .select('code_hash,expires_at').eq('user_id', userId).eq('code_hash', hash).maybeSingle();
    if (pair.error || !pair.data || new Date(pair.data.expires_at).getTime() <= Date.now()) {
      return json(req, { error: 'pair_expired' }, 409);
    }
    const updates = await botApi('getUpdates', { offset: -100, limit: 100, timeout: 0, allowed_updates: ['message'] }, token);
    if (!updates.ok) return json(req, { error: errorCode(updates, 'telegram_updates_unavailable') }, 503);
    const last = (Array.isArray(updates.result) ? updates.result : []) as Array<{
      message?: { text?: unknown; chat?: unknown; from?: { is_bot?: boolean } };
    }>;
    const message = last.find((item) => {
      const msg = item.message;
      return msg?.text === '/start ' + code && msg?.from?.is_bot !== true && privateChatId(msg?.chat) != null;
    });
    const chatId = privateChatId(message?.message?.chat);
    if (!chatId) return json(req, { error: 'telegram_start_not_seen' }, 409);
    const username = await findBot(token);
    if (!username) return json(req, { error: 'bot_invalid_token' }, 503);
    const upsert = await db.from('telegram_vinculos').upsert({
      user_id: userId, chat_id: chatId, bot_username: username,
      vinculado_em: new Date().toISOString(), testado_em: null,
      ultimo_teste_em: null, ativo: false, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (upsert.error) return json(req, { error: 'link_unavailable' }, 503);
    await db.from('telegram_pareamentos').delete().eq('user_id', userId).eq('code_hash', hash);
    return json(req, { ok: true, linked: true, enabled: false });
  }

  if (action === 'set_login_notifications') {
    if(typeof body.enabled!=='boolean')return json(req,{error:'invalid_login_preference'},400);
    const existing=await db.from('telegram_vinculos')
      .select('ativo').eq('user_id',userId).maybeSingle();
    if(existing.error)return json(req,{error:'link_lookup_failed'},503);
    if(!existing.data)return json(req,{error:'not_linked'},409);
    const updated=await db.from('telegram_vinculos')
      .update({notificar_logins:body.enabled,updated_at:new Date().toISOString()})
      .eq('user_id',userId);
    if(updated.error)return json(req,{error:'login_preference_failed'},503);
    if(!body.enabled){
      const queued=await db.from('telegram_fila')
        .select('id,alerta_id').eq('user_id',userId).in('status',['pendente','enviando']);
      if(!queued.error && queued.data?.length){
        const ids=queued.data.map(x=>x.alerta_id);
        const events=await db.from('alertas').select('id').eq('tipo','login').in('id',ids);
        const loginIds=(events.data||[]).map(x=>x.id);
        if(loginIds.length)await db.from('telegram_fila')
          .update({status:'descartado',ultimo_erro:'Avisos de login desativados',processando_em:null})
          .eq('user_id',userId).in('alerta_id',loginIds).in('status',['pendente','enviando']);
      }
    }
    return json(req,{ok:true,login_notifications:body.enabled});
  }
  const link = await db.from('telegram_vinculos').select('*').eq('user_id', userId).maybeSingle();
  if (link.error) return json(req, { error: 'link_lookup_failed' }, 503);
  if (!link.data) return json(req, { error: 'not_linked' }, 409);

  if (action === 'test') {
    if (link.data.ultimo_teste_em &&
      Date.now() - new Date(link.data.ultimo_teste_em).getTime() < 60_000) {
      return json(req, { error: 'test_cooldown' }, 429);
    }
    await db.from('telegram_vinculos').update({ ultimo_teste_em: new Date().toISOString() })
      .eq('user_id', userId);
    const message = await sendMessage(token, link.data.chat_id,
      'MATOS | Teste de notificações\n' +
      'Este é um teste do canal Telegram da Casa Matos. ' +
      'Se você recebeu esta mensagem, volte ao sistema para ativar os avisos automáticos.');
    if (!message.ok) return json(req, { error: errorCode(message, 'telegram_delivery_failed') }, 502);
    const saved = await db.from('telegram_vinculos')
      .update({ testado_em: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (saved.error) return json(req, { error: 'test_state_not_saved' }, 503);
    return json(req, { ok: true, accepted_by_telegram: true });
  }
  if (action === 'enable' || action === 'disable') {
    if (action === 'enable' && (!link.data.testado_em ||
      Date.now() - new Date(link.data.testado_em).getTime() > 24 * 60 * 60 * 1000)) {
      return json(req, { error: 'test_required' }, 409);
    }
    const enabled = action === 'enable';
    const updated = await db.from('telegram_vinculos')
      .update({ ativo: enabled, updated_at: new Date().toISOString() }).eq('user_id', userId);
    if (updated.error) return json(req, { error: 'toggle_failed' }, 503);
    if (!enabled) await db.from('telegram_fila').update({
      status: 'descartado', ultimo_erro: 'Canal Telegram desativado', processando_em: null,
    }).eq('user_id', userId).in('status', ['pendente', 'enviando']);
    return json(req, { ok: true, enabled });
  }
  if (action === 'disconnect') {
    const disabled = await db.from('telegram_vinculos').delete().eq('user_id', userId);
    if (disabled.error) return json(req, { error: 'disconnect_failed' }, 503);
    await db.from('telegram_fila').update({
      status: 'descartado', ultimo_erro: 'Vínculo Telegram removido', processando_em: null,
    }).eq('user_id', userId).in('status', ['pendente', 'enviando']);
    return json(req, { ok: true, linked: false });
  }
  return json(req, { error: 'unknown_action' }, 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  let body: Record<string, unknown>;
  try { body = await readJson(req, 4096) as Record<string, unknown>; }
  catch { return json(req, { error: 'invalid_request' }, 400); }
  if (body.action === 'dispatch') return internalDispatch(req);
  return adminAction(req, body);
});
