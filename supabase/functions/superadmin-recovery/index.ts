import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders, json, readJson } from '../_shared/http.ts';

// Resposta sempre idêntica para não revelar qual conta é privilegiada.
// As senhas são redefinidas somente pelo link oficial do Supabase Auth.
const SITE='https://gestao-alugueis-jp.vercel.app';
const GENERIC={ok:true,message:'Se este e-mail estiver habilitado, você receberá instruções de recuperação.'};
function safeEmail(value:unknown){
 const email=typeof value==='string'?value.trim().toLowerCase():'';
 return email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null
}
async function hash(value:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('')
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(req)});
 if(req.method!=='POST')return json(req,{error:'method_not_allowed'},405);
 let payload:Record<string,unknown>;
 try{payload=await readJson(req,2048) as Record<string,unknown>}
 catch{return json(req,GENERIC)}
 const email=safeEmail(payload?.email);
 if(!email)return json(req,GENERIC);
 const url=Deno.env.get('SUPABASE_URL')||'';
 const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 const publicKey=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY')||'';
 if(!url||!serviceKey||!publicKey)return json(req,GENERIC);
 const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  // Limite atômico por origem e endereço informado. Armazena só hash,
  // sem IP/e-mail em claro nem credenciais no registro de tentativas.
  const ip=(req.headers.get('cf-connecting-ip')||
   (req.headers.get('x-forwarded-for')||'').split(',')[0].trim()||'unknown').slice(0,80);
  const accountKey=await hash('matos-account:'+email);
  const deviceKey=await hash('matos-origin:'+ip);
  const accountLimit=await db.rpc('matos_pode_recuperar_senha',{p_chave_hash:accountKey});
  const deviceLimit=await db.rpc('matos_pode_recuperar_senha',{p_chave_hash:deviceKey});
  if(accountLimit.error||deviceLimit.error||!accountLimit.data||!deviceLimit.data){
   return json(req,GENERIC)
  }
  const profile=await db.from('perfis').select('user_id')
    .eq('role','superadmin').maybeSingle();
  if(profile.error||!profile.data)return json(req,GENERIC);
  const authUser=await db.auth.admin.getUserById(profile.data.user_id);
  const user=authUser.data?.user;
  if(authUser.error||!user||!user.email_confirmed_at||
    String(user.email||'').toLowerCase()!==email)return json(req,GENERIC);
  const auth=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  // SITE já é o destino HTTPS utilizado pelos logins da Casa Matos.
  // O token temporário de recuperação é processado somente no browser.
  const outcome=await auth.auth.resetPasswordForEmail(email,{redirectTo:SITE});
  if(outcome.error)console.error('super_recovery_delivery_unavailable');
 }catch{
  // Não revelar a existência da conta ou detalhes de envio.
  console.error('super_recovery_service_unavailable')
 }
 return json(req,GENERIC);
});
