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
 await navigator.serviceWorker.ready;
 try{await reg.update()}catch(_){}
 return reg
}
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
  throw new Error('Não foi possível registrar push externo. '+(e&&e.message||String(e)))
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
 bindForeground(messaging,reg);
 return true
};
window.getMatosPushDiagnostics=async function(){
 const result={permission:'indisponível',installed:isInstalled(),ios:isIos(),
  serverRegistered:false,deviceCount:0,active:false};
 if('Notification' in window)result.permission=Notification.permission;
 if(!session||!session.user)return result;
 const token=localStorage.getItem('matos_push_token');
 if(!token)return result;
 const devices=await request('/rest/v1/push_dispositivos?select=endpoint,ativo&user_id=eq.'+
  encodeURIComponent(session.user.id),{headers:authHeaders(session.access_token)});
 result.deviceCount=(devices||[]).filter(x=>x.ativo).length;
 result.serverRegistered=(devices||[]).some(x=>x.ativo&&x.endpoint===token);
 result.active=result.permission==='granted'&&result.serverRegistered;
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
 const response=await fetch(SUPA_URL+'/functions/v1/push-dispatch',{
  method:'POST',headers:headers(),body:JSON.stringify({action:'test'})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok||!result.ok){
  const messages={
   no_active_devices:'Nenhum aparelho ativo cadastrado para esta conta.',
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