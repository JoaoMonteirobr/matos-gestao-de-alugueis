(function(){
'use strict';
let installPrompt=null,foregroundBound=false;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e});
window.addEventListener('appinstalled',()=>{installPrompt=null;localStorage.setItem('matos_pwa_installed','1')});

function loadScript(src){
 return new Promise((ok,fail)=>{
  if(document.querySelector('script[src="'+src+'"]'))return ok();
  const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=fail;
  document.head.appendChild(s)
 })
}
function isIos(){return /iPhone|iPad|iPod/i.test(navigator.userAgent)}
function isInstalled(){
 return window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true
}
function installHint(){
 return isIos()&&!isInstalled()
  ? 'No iPhone/iPad, abra no Safari, toque em Compartilhar → Adicionar à Tela de Início e abra o sistema pelo ícone. Depois ative as notificações.'
  : 'Verifique as permissões do navegador, a conexão HTTPS e as configurações de notificações do aparelho.'
}
async function registerSW(){
 if(!('serviceWorker' in navigator))throw new Error('Service Worker indisponível neste navegador.');
 const reg=await navigator.serviceWorker.register('/sw.js?v=4',{scope:'/'});
 // Aguarda ativação: não força update enquanto o PushManager tenta inscrever.
 await navigator.serviceWorker.ready;
 if(!reg.active)throw new Error('O serviço de notificações ainda está sendo ativado. Reabra o sistema e tente novamente.');
 return reg
}
function pushFailureCode(error){
 const message=String(error&&error.message||error||'').toLowerCase();
 if(/registration failed.*push service error|push service error/.test(message))return 'push-service-error';
 if(/permission|notallowederror/.test(message))return 'permission';
 if(/network|failed to fetch|fetch failed/.test(message))return 'network';
 if(/service worker|serviceworker|no active/.test(message))return 'worker';
 return 'unknown'
}
function pushFailureMessage(error){
 const type=pushFailureCode(error);
 if(type==='push-service-error')return 'O serviço push do Chrome/Android recusou a inscrição neste celular. Isso não indica falha das credenciais Firebase do servidor. Confira notificações do Chrome e do aplicativo, atualize Chrome e Serviços do Google Play, teste outra rede e desative temporariamente VPN/DNS privado. Depois toque em Ativar notificações novamente.';
 if(type==='permission')return 'O navegador bloqueou a permissão de notificações. Permita notificações para a Casa Matos e para o Chrome nas configurações do Android.';
 if(type==='network')return 'Não foi possível alcançar o serviço de notificações. Confira sua conexão, VPN e DNS privado e tente novamente.';
 if(type==='worker')return 'O serviço do aplicativo não terminou de iniciar. Reabra a Casa Matos no Chrome e tente novamente.';
 return 'Não foi possível registrar o push neste aparelho. Verifique a conexão, permissões e o Chrome. Detalhe: '+String(error&&error.message||error||'erro desconhecido').slice(0,160)
}
window.MatosPushFailure={code:pushFailureCode,message:pushFailureMessage};
async function ensureFirebase(){
 await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
 await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
 if(!firebase.apps.length)firebase.initializeApp(window.MATOS_FIREBASE.config);
 if(typeof firebase.messaging.isSupported==='function'){
  const supported=await firebase.messaging.isSupported();
  if(!supported)throw new Error('O Firebase não é compatível com este navegador. '+installHint())
 }
 return firebase.messaging()
}
function bindForeground(messaging,reg){
 if(foregroundBound)return;
 foregroundBound=true;
 messaging.onMessage(async function(payload){
  const data=payload.data||{},notice=payload.notification||{};
  if(Notification.permission!=='granted')return;
  await reg.showNotification(notice.title||data.title||'Casa Matos',{
   body:notice.body||data.body||'Nova notificação.',
   icon:'/matos-marca.svg?v=2',
   tag:data.tag||'matos-alerta',
   data:{url:data.url||'/?pagina=Alertas'}
  })
 })
}
function headers(){
 return Object.assign(authHeaders(session.access_token),{'Content-Type':'application/json'})
}
window.installMatosApp=async function(){
 if(isIos()){
  alert(isInstalled()?'O aplicativo já está na Tela de Início.':installHint());return
 }
 if(!installPrompt){
  alert('Abra o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.');return
 }
 installPrompt.prompt();await installPrompt.userChoice;installPrompt=null
};
window.matosPushInstallHint=installHint;
window.enableRemotePush=async function(){
 if(!session||!session.user)throw new Error('Faça login antes de ativar as notificações.');
 if(!window.MATOS_FIREBASE||!window.MATOS_FIREBASE.vapidKey)
  throw new Error('A chave VAPID pública não está configurada.');
 if(isIos()&&!isInstalled())throw new Error(installHint());
 if(!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window))
  throw new Error('Este navegador não suporta todas as funções de push. '+installHint());
 let permission=Notification.permission;
 if(permission==='default')permission=await Notification.requestPermission();
 if(permission!=='granted')throw new Error('Permissão de notificação não concedida. '+installHint());
 let reg,messaging,token;
 try{
  // Preservar a inscrição já válida: desinstalar a cada ativação causava falhas.
  reg=await registerSW();
  messaging=await ensureFirebase();
  token=await messaging.getToken({
   vapidKey:window.MATOS_FIREBASE.vapidKey,serviceWorkerRegistration:reg
  });
 }catch(e){
  // Não apaga registros antigos de outros aparelhos nem a inscrição existente.
  localStorage.setItem('matos_push_last_error',pushFailureCode(e));
  throw new Error(pushFailureMessage(e))
 }
 if(!token)throw new Error('O serviço de push não retornou um registro para o aparelho.');
 const former=localStorage.getItem('matos_push_token');
 await request('/rest/v1/push_dispositivos?on_conflict=user_id,endpoint',{
  method:'POST',headers:Object.assign(headers(),{'Prefer':'resolution=merge-duplicates,return=minimal'}),
  body:JSON.stringify({
   user_id:session.user.id,endpoint:token,
   plataforma:navigator.platform||null,navegador:navigator.userAgent||null,
   ativo:true,ultimo_uso:new Date().toISOString()
  })
 });
 if(former&&former!==token){
  try{
   await request('/rest/v1/push_dispositivos?user_id=eq.'+
    encodeURIComponent(session.user.id)+'&endpoint=eq.'+encodeURIComponent(former),{
    method:'PATCH',headers:headers(),body:JSON.stringify({ativo:false})
   })
  }catch(_){}
 }
 localStorage.setItem('matos_push_token',token);
 localStorage.setItem('matos_push_enabled','1');
 localStorage.removeItem('matos_push_last_error');
 bindForeground(messaging,reg);
 return true
};
window.getMatosPushDiagnostics=async function(){
 const result={permission:'indisponível',installed:isInstalled(),ios:isIos(),
  online:navigator.onLine!==false,workerActive:false,pushSubscription:false,
  tokenStored:!!localStorage.getItem('matos_push_token'),
  lastError:localStorage.getItem('matos_push_last_error')||'',
  serverRegistered:false,deviceCount:0,active:false};
 if('Notification' in window)result.permission=Notification.permission;
 if('serviceWorker' in navigator){
  try{
   const reg=await navigator.serviceWorker.getRegistration('/');
   result.workerActive=Boolean(reg&&reg.active);
   if(reg&&reg.active&&reg.pushManager){
    result.pushSubscription=Boolean(await reg.pushManager.getSubscription())
   }
  }catch(_){}
 }
 if(!session||!session.user||!session.access_token)return result;
 const token=localStorage.getItem('matos_push_token');
 const devices=await request('/rest/v1/push_dispositivos?select=endpoint,ativo&user_id=eq.'+
  encodeURIComponent(session.user.id),{headers:authHeaders(session.access_token)});
 result.deviceCount=(devices||[]).filter(x=>x.ativo).length;
 result.serverRegistered=Boolean(token)&&(devices||[]).some(x=>x.ativo&&x.endpoint===token);
 // Token salvo não comprova inscrição válida: verificar também PushManager e SW.
 result.active=result.permission==='granted'&&result.workerActive&&
  result.pushSubscription&&result.serverRegistered;
 return result
};
window.getMatosPushServerStatus=async function(){
 if(!session||!session.access_token)throw new Error('Sessão não autenticada.');
 if(currentRole!=='admin')return {configured:false,notAuthorized:true};
 const response=await fetch(SUPA_URL+'/functions/v1/push-dispatch',{
  method:'POST',headers:headers(),body:JSON.stringify({action:'diagnostic'})
 });
 if(!response.ok)throw new Error('Não foi possível consultar o servidor Firebase.');
 const payload=await response.json();
 return {configured:payload.configured===true,provider:'Firebase'}
};
window.testMatosRemotePush=async function(){
 if(!session||!session.access_token)throw new Error('Faça login para testar.');
 if(currentRole!=='admin')throw new Error('Teste remoto disponível somente ao administrador.');
 const current=await window.getMatosPushDiagnostics();
 if(!current.active)throw new Error('Ative as notificações neste aparelho antes do teste remoto.');
 const deviceToken=localStorage.getItem('matos_push_token');
 if(!deviceToken)throw new Error('Nenhum registro local foi encontrado para este aparelho.');
 const response=await fetch(SUPA_URL+'/functions/v1/push-dispatch',{
  method:'POST',headers:headers(),body:JSON.stringify({action:'test',device_token:deviceToken})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok||!result.ok){
  const messages={
   no_active_devices:'Este celular não possui um registro ativo no servidor. Toque em Ativar notificações.',
   device_not_registered:'Este celular não está registrado. Ative as notificações aqui antes de testar.',
   firebase_credentials_not_configured:'O servidor ainda precisa da credencial Firebase para enviar push.',
   test_cooldown:'Teste recente. Tente novamente após um minuto.',
   push_server_not_configured:'O servidor de notificações não está configurado.',
   forbidden:'Sua conta não pode emitir este teste.',
   unauthenticated:'Sua sessão expirou. Entre novamente.',
  };
  throw new Error(messages[result.error]||'O servidor não conseguiu enviar o push remoto. Código '+response.status)
 }
 return result
};
window.testMatosNotification=async function(){
 if(!('Notification' in window))throw new Error('Notificações indisponíveis neste navegador.');
 if(Notification.permission!=='granted'){
  const perm=await Notification.requestPermission();
  if(perm!=='granted')throw new Error('Permissão de notificações não concedida.')
 }
 const reg=await registerSW();
 await reg.showNotification('Teste local | Casa Matos',{
  body:'Este teste confirma somente o navegador. Para verificar o Firebase, use “Testar push remoto”.',
  tag:'matos-teste-local',icon:'/matos-marca.svg?v=2',data:{url:'/'}
 });
 return true
};
window.diagnoseMatosPush=async function(){
 const d=await window.getMatosPushDiagnostics();
 return {
  platform:d.ios?'iOS':'Android ou computador',
  permission:d.permission,online:d.online,
  workerActive:d.workerActive,pushSubscription:d.pushSubscription,
  serverRegistered:d.serverRegistered,deviceCount:d.deviceCount,
  lastError:d.lastError,active:d.active,
  // Nunca retornar JWT, endpoint, token FCM, VAPID ou dados pessoais.
  advice:d.lastError==='push-service-error'?pushFailureMessage({message:'Registration failed - push service error'}):
   d.permission==='denied'?'Autorize notificações nas configurações do navegador e do celular.':
   !d.online?'Conecte o aparelho à internet e tente novamente.':
   !d.workerActive?'Reabra o aplicativo no Chrome para ativar o Service Worker.':
   !d.pushSubscription?'Ainda não foi possível confirmar a inscrição push deste navegador.':
   !d.serverRegistered?'É necessário registrar este aparelho na Casa Matos.':
   'Inscrição detectada neste aparelho. Use o teste remoto para verificar se o Firebase aceita o envio.'
 }
};
window.resetMatosPush=async function(){
 const token=localStorage.getItem('matos_push_token');
 if(token&&session&&session.user){
  await request('/rest/v1/push_dispositivos?user_id=eq.'+
   encodeURIComponent(session.user.id)+'&endpoint=eq.'+encodeURIComponent(token),{
    method:'PATCH',headers:headers(),body:JSON.stringify({ativo:false})
   })
 }
 // Não desinstalar Service Workers nem cancelar inscrições de outros recursos.
 try{const messaging=await ensureFirebase();await messaging.deleteToken()}catch(_){}
 localStorage.removeItem('matos_push_token');
 localStorage.removeItem('matos_push_enabled');
 return true
};
registerSW().catch(console.warn);
})();