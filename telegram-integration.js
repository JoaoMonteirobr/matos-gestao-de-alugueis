(function(){
'use strict';
// Telegram é independente do Web Push/Chrome. Fica desativado até teste explícito.
const ERROR_MESSAGES={
  bot_not_configured:'O bot ainda não foi configurado. Cadastre o token no Supabase.',
  bot_invalid_token:'O token do bot está inválido ou o Telegram não pôde validá-lo.',
  telegram_invalid_token:'Token Telegram inválido. Confira o segredo no Supabase.',
  telegram_webhook_conflict:'Este bot já tem um webhook configurado. Use um bot novo exclusivo para a Casa Matos.',
  telegram_updates_unavailable:'Não foi possível consultar as mensagens do bot. Tente novamente.',
  telegram_start_not_seen:'Ainda não localizei o comando Iniciar no Telegram. Abra o link, toque em Iniciar e verifique novamente.',
  invalid_pair_code:'O código de vinculação está inválido. Gere um novo link.',
  pair_expired:'O código de vinculação expirou. Gere outro link (validade: 15 minutos).',
  pair_unavailable:'Não foi possível gerar o vínculo agora.',
  link_unavailable:'Não foi possível salvar o vínculo na Casa Matos.',
  not_linked:'Vincule sua conta do Telegram antes de testar.',
  test_required:'Envie primeiro a mensagem de teste e confirme o recebimento.',
  test_cooldown:'Você realizou um teste há pouco. Aguarde um minuto para enviar outro.',
  login_preference_failed:'Não foi possível alterar os avisos de acesso.',
  invalid_login_preference:'Preferência de alertas inválida.',
  telegram_chat_blocked:'O bot foi bloqueado ou o chat está indisponível. Desbloqueie o bot no Telegram.',
  telegram_rate_limited:'O Telegram limitou temporariamente as mensagens. Tente novamente.',
  telegram_delivery_failed:'Não foi possível enviar a mensagem ao Telegram.',
  unauthenticated:'Entre novamente na Casa Matos para continuar.',
  forbidden:'Somente o administrador pode configurar este canal.',
  server_not_configured:'O servidor de notificações não está configurado.',
};
let status=null,loading=false;
const ID='matos_telegram_pair_code';
function el(id){return document.getElementById(id)}
function msg(value,error){
 const target=el('telegram_msg');if(!target)return;
 target.innerHTML='<div class="notice '+(error?'err':'success')+'">'+esc(value)+'</div>'
}
function showError(e){
 msg(String(e&&e.message||e||'Erro desconhecido'),true)
}
function usernameText(value){
 return /^[A-Za-z0-9_]{5,32}$/.test(value||'')?'@'+value:'Bot Telegram'
}
async function callTelegram(action,values){
 if(!session?.access_token)throw new Error('Faça login novamente.');
 const response=await fetch(SUPA_URL+'/functions/v1/telegram-channel',{
  method:'POST',headers:Object.assign(authHeaders(session.access_token),{'Content-Type':'application/json'}),
  body:JSON.stringify(Object.assign({action:action},values||{}))
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.error){
  throw new Error(ERROR_MESSAGES[data.error]||'Não foi possível acessar o Telegram (HTTP '+response.status+').')
 }
 return data
}
function render(){
 const root=el('telegram_controls');if(!root)return;
 if(!status){root.innerHTML='<p class="muted">Verificando disponibilidade do Telegram...</p>';return}
 const pairCode=sessionStorage.getItem(ID);
 const botLabel=status.bot_username?esc(usernameText(status.bot_username)):'Bot Telegram';
 const classes='class="btn secondary" type="button"';
 if(!status.configured){
  root.innerHTML='<div class="telegram-setup">'+
   '<strong>Preparação: criar seu bot gratuito</strong>'+
   '<p>1. Abra <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">BotFather no Telegram</a> e envie <code>/newbot</code>.</p>'+
   '<p>2. Copie o token fornecido e salve-o em <strong>Supabase → Edge Functions → Secrets</strong> com o nome <code>MATOS_TELEGRAM_BOT_TOKEN</code>.</p>'+
   '<p>3. Volte aqui e toque em <strong>Verificar configuração</strong>. Não cole o token nesta página nem na conversa.</p>'+
   '<button '+classes+' onclick="refreshMatosTelegramUI()">Verificar configuração</button></div>';
  return
 }
 if(!status.bot_healthy){
  root.innerHTML='<div class="notice err">Não foi possível validar o bot. Confira o token no Supabase e tente novamente.</div>'+
   '<button '+classes+' onclick="refreshMatosTelegramUI()">Tentar novamente</button>';return
 }
 if(!status.linked){
  root.innerHTML='<p class="muted">Bot reconhecido: <strong>'+botLabel+'</strong>. Vincule seu chat privado para receber uma mensagem de teste.</p>'+
   '<div class="telegram-actions">'+
   '<button class="btn primary" type="button" onclick="telegramPairUI()">Gerar link de vinculação</button>'+
   (pairCode?'<button '+classes+' onclick="telegramVerifyUI()">Verificar vínculo</button>':'')+
   '</div><div id="telegram_pair_link"></div>';
  return
 }
 root.innerHTML='<div class="telegram-status">'+
  '<span class="telegram-dot '+(status.enabled?'telegram-dot-on':'')+'"></span>'+
  '<div><strong>'+botLabel+'</strong><small>'+
  (status.enabled?'Avisos automáticos ativados':'Conectado · envio automático desligado')+
  '</small></div></div>'+
  '<p class="muted">'+(status.tested?
   'O Telegram aceitou o teste. Ative os avisos apenas se você recebeu a mensagem no aplicativo.':
   'Envie uma mensagem de teste. O canal continuará desligado até sua confirmação.')+'</p>'+
  '<div class="telegram-actions">'+
  '<button class="btn primary" type="button" onclick="telegramTestUI()">Enviar mensagem de teste</button>'+
  (status.enabled?
   '<button '+classes+' onclick="telegramDisableUI()">Desativar avisos</button>':
   (status.tested?'<button '+classes+' onclick="telegramEnableUI()">Recebi o teste — ativar avisos</button>':''))+
  '<button '+classes+' onclick="telegramDisconnectUI()">Desvincular</button></div>'+
  '<div class="telegram-security-setting"><div><strong>Avisos de acesso ao sistema</strong>'+
  '<p class="muted">Receba no Telegram o nome, a região aproximada, o dispositivo e o horário de cada novo login.</p></div>'+
  '<button class="btn secondary" type="button" onclick="telegramToggleLoginUI()">'+
  (status.login_notifications?'Desativar avisos de login':'Ativar avisos de login')+
  '</button></div>';
}
function panel(){
 return '<section class="panel telegram-panel" id="telegram_panel">'+
  '<div class="alerts-section-head"><div><h3>Notificações pelo Telegram</h3>'+
  '<p class="muted">Canal gratuito de teste, independente das notificações do Chrome.</p></div>'+
  '<span class="telegram-pill" id="telegram_badge">Desligado</span></div>'+
  '<div id="telegram_controls"><p class="muted">Carregando...</p></div>'+
  '<div id="telegram_msg" role="status" aria-live="polite"></div></section>'
}
window.matosTelegramPanel=panel;
async function refreshMatosTelegramUI(){
 if(!matosIsSuperAdmin){const node=el('telegram_controls');if(node)node.innerHTML='<p class="muted">Canal disponível somente aos administradores.</p>';return}
 try{
  status=await callTelegram('status');
  render();
  const badge=el('telegram_badge');
  if(badge)badge.textContent=status.enabled?'Ativo':status.linked?'Conectado · desligado':'Desligado';
 }catch(e){
  const target=el('telegram_controls');
  if(target)target.innerHTML='<p class="muted">Não foi possível consultar o canal Telegram.</p>'+
   '<button class="btn secondary" type="button" onclick="refreshMatosTelegramUI()">Tentar novamente</button>';
  showError(e)
 }
}
window.refreshMatosTelegramUI=refreshMatosTelegramUI;
window.matosTelegramMount=function(){status=null;refreshMatosTelegramUI()};
function busy(on){loading=on;const root=el('telegram_panel');if(root)root.querySelectorAll('button').forEach(b=>{b.disabled=on})}
window.telegramPairUI=async function(){
 if(loading)return;busy(true);
 try{
  const result=await callTelegram('pair');
  sessionStorage.setItem(ID,result.code);
  render();
  const box=el('telegram_pair_link');
  if(box){
   const url=/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=mt_[A-Za-z0-9_-]{32}$/.test(result.link)?
    result.link:null;
   if(!url)throw new Error('O link gerado pelo bot é inválido.');
   box.innerHTML='<div class="telegram-setup"><p><strong>Passo 1:</strong> toque no link abaixo e pressione <b>Iniciar</b> no Telegram.</p>'+
    '<p><a id="telegram_open_link" target="_blank" rel="noopener noreferrer">Abrir meu bot no Telegram</a></p>'+
    '<p><strong>Passo 2:</strong> volte à Casa Matos e toque em <b>Verificar vínculo</b>. O código expira em 15 minutos.</p></div>';
   el('telegram_open_link').href=url;
  }
  msg('Link gerado. Inicie o bot no Telegram antes de verificar o vínculo.',false)
 }catch(e){showError(e)}finally{busy(false)}
};
window.telegramVerifyUI=async function(){
 if(loading)return;const code=sessionStorage.getItem(ID);
 if(!code){msg('Gere primeiro um link de vinculação.',true);return}
 busy(true);
 try{
  await callTelegram('verify',{code});
  sessionStorage.removeItem(ID);
  msg('Telegram vinculado. Agora envie a mensagem de teste.',false);
  await refreshMatosTelegramUI()
 }catch(e){showError(e)}finally{busy(false)}
};
window.telegramTestUI=async function(){
 if(loading)return;busy(true);
 try{
  await callTelegram('test');
  msg('O Telegram aceitou a mensagem de teste. Confira seu celular. Se ela chegou, clique em "Recebi o teste — ativar avisos".',false);
  await refreshMatosTelegramUI()
 }catch(e){showError(e)}finally{busy(false)}
};
window.telegramEnableUI=async function(){
 if(loading)return;busy(true);
 try{
  await callTelegram('enable');
  msg('Avisos automáticos ativados. Novos alertas operacionais serão enviados; logins serão incluídos conforme sua preferência. Não enviamos histórico antigo.',false);
  await refreshMatosTelegramUI()
 }catch(e){showError(e)}finally{busy(false)}
};
window.telegramToggleLoginUI=async function(){
 if(loading||!status?.linked)return;
 const enabled=!Boolean(status.login_notifications);
 busy(true);
 try{
  await callTelegram('set_login_notifications',{enabled});
  msg(enabled?'Avisos de login ativados. Cada novo acesso será informado no Telegram.':
    'Avisos de login desativados. Os demais alertas continuam funcionando.',false);
  await refreshMatosTelegramUI()
 }catch(e){showError(e)}finally{busy(false)}
};
window.telegramDisableUI=async function(){
 if(loading)return;busy(true);
 try{await callTelegram('disable');msg('Envio automático do Telegram desativado. Seu vínculo foi preservado.',false);await refreshMatosTelegramUI()}
 catch(e){showError(e)}finally{busy(false)}
};
window.telegramDisconnectUI=async function(){
 if(loading||!window.confirm('Desvincular seu Telegram da Casa Matos?'))return;
 busy(true);
 try{await callTelegram('disconnect');sessionStorage.removeItem(ID);msg('Vínculo removido e envios desativados.',false);await refreshMatosTelegramUI()}
 catch(e){showError(e)}finally{busy(false)}
};
})();