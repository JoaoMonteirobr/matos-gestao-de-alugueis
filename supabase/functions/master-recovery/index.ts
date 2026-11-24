// Canal de recuperação não autenticado, com destinatário validado em SQL privado.
// Nenhum e-mail, UID ou credencial privilegiada é publicado ao navegador.
import { corsHeaders, json, readJson } from '../_shared/http.ts';

const GENERIC = { ok: true };
const RECOVERY_REDIRECT = 'https://gestao-alugueis-jp.vercel.app/';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  let email = '';
  try {
    const body = await readJson(req, 1024);
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  } catch {
    return json(req, GENERIC);
  }
  if (email.length < 5 || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    return json(req, GENERIC);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !publishableKey) {
    return json(req, { error: 'temporarily_unavailable' }, 503);
  }

  try {
    const allowedResponse = await fetch(supabaseUrl + '/rest/v1/rpc/matos_allow_master_recovery', {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_email: email }),
    });
    if (!allowedResponse.ok) {
      console.error('master-recovery private gate unavailable:', allowedResponse.status);
      return json(req, { error: 'temporarily_unavailable' }, 503);
    }
    if (await allowedResponse.json() !== true) return json(req, GENERIC);

    const sent = await fetch(supabaseUrl + '/auth/v1/recover?redirect_to=' + encodeURIComponent(RECOVERY_REDIRECT), {
      method: 'POST',
      headers: {
        'apikey': publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });
    if (!sent.ok) console.error('master-recovery delivery unavailable:', sent.status);
  } catch {
    console.error('master-recovery service unreachable');
  }

  // Indistinguível entre conta inexistente, não autorizada, limite de tentativas
  // e entrega de e-mail; evita enumeração das contas do sistema.
  return json(req, GENERIC);
});
