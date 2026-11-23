(function(){
'use strict';
var ROUTE_KEY='matos_current_page';
var SESSION_START_KEY='matos_session_started_at';
var SESSION_LIMIT_MS=20*60*1000;
var bellPoll=null,timerTick=null,documentBound=false;
function routeFromUrl(){try{return new URLSearchParams(location.search).get('pagina')||''}catch(e){return ''}}
function storedPage(){try{return sessionStorage.getItem(ROUTE_KEY)||''}catch(e){return ''}}
function rememberPage(){try{if(page)sessionStorage.setItem(ROUTE_KEY,page)}catch(e){}}
var incoming=routeFromUrl();if(incoming){page=incoming;try{sessionStorage.setItem(ROUTE_KEY,incoming);history.replaceState(null,'',location.pathname+location.hash)}catch(e){}}else{var saved=storedPage();if(saved)page=saved}
function categoryLabel(t){var m={login:'Login',cobranca_atrasada:'Aluguel em atraso',cobranca_vencendo:'Conta a vencer',contrato_vencendo:'Contrato a vencer',contrato_vencido:'Contrato vencido',documento_vencendo:'Documento a vencer'};return m[t]||'Alerta'}
function bellMarkup(){return '<div class="notify-wrap" id="notify_wrap"><button class="notify-bell" id="notify_bell" type="button" aria-label="Notificações" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg><span class="notify-count" id="notify_count" hidden>0</span></button><div class="notify-panel" id="notify_panel" hidden><div class="notify-head"><strong>Notificações</strong><button type="button" id="notify_all">Ver todas</button></div><div class="notify-list" id="notify_list"><div class="notify-empty">Carregando notificações...</div></div>'+
 (isMatosSuper()?'<div class="notify-footer"><button type="button" id="notify_push">Configurar notificações no celular</button></div>':'')+'</div></div>'}
function timerMarkup(){return '<div class="session-timer" id="session_timer" title="Tempo restante desta sessão"><span class="session-timer-icon"></span><div><small>Sessão restante</small><strong id="session_clock">20:00</strong></div></div>'}
function openAlerts(){page='Alertas';rememberPage();shell()}
function openPushSettings(){if(!isMatosSuper())return openAlerts();window.matosScrollToPush=true;openAlerts()}
window.openAlertCenter=openAlerts;
window.openMatosPushSettings=openPushSettings;
function renderBellRows(data,total){
 var list=E('notify_list'),count=E('notify_count');
 if(!list||!count)return;
 var arr=Array.isArray(data)?data:[],unread=Math.max(0,Number(total)||0);
 count.textContent=unread>99?'99+':String(unread);
 count.hidden=unread===0;
 count.setAttribute('aria-label',unread+' notificações não lidas');
 var bell=E('notify_bell');if(bell)bell.setAttribute('aria-label','Notificações: '+unread+' não lidas');
 if(!unread){list.innerHTML='<div class="notify-empty">Nenhuma notificação pendente.</div>';return}
 if(!arr.length){list.innerHTML='<div class="notify-empty">Há '+unread+' aviso(s) não lidos. Abra a Central para consultar.</div>';return}
 list.innerHTML=arr.map(function(a){
  var cls=a.prioridade==='urgente'?'urgent':a.prioridade==='alta'?'high':'';
  return '<button type="button" class="notify-item" data-alert-open="1"><div class="notify-item-top">'+
   '<span class="notify-dot '+cls+'"></span><span class="notify-category">'+esc(categoryLabel(a.tipo))+'</span></div>'+
   '<div class="notify-title">'+esc(a.titulo||'Alerta')+'</div>'+
   '<div class="notify-message">'+esc(a.mensagem||'')+'</div></button>'
 }).join('')
}
var bellRefreshing=false;
async function refreshBell(){
 if(bellRefreshing||!session||!session.access_token||currentRole==='visitante')return;
 bellRefreshing=true;
 var userId=session.user&&session.user.id,token=session.access_token;
 try{
  // Os avisos operacionais são gerados pelo cron; a revisão manual fica
  // reservada ao gestor. Falha do gerador nunca impede a caixa de entrada.
  if(isMatosSuper()){
   try{await request('/rest/v1/rpc/gerar_alertas_operacionais',{
    method:'POST',headers:authHeaders(token),body:'{}'
   })}catch(e){}
  }
  var results=await Promise.all([
   request('/rest/v1/rpc/contar_alertas_nao_lidos',{
    method:'POST',headers:authHeaders(token),body:'{}'
   }),
   request('/rest/v1/rpc/listar_alertas_nao_lidos',{
    method:'POST',headers:authHeaders(token),body:JSON.stringify({p_limite:8})
   })
  ]);
  // Protege contra respostas antigas após troca de conta/sessão.
  if(!session||session.access_token!==token||!session.user||
     session.user.id!==userId)return;
  renderBellRows(results[1],results[0]);
 }catch(e){
  var list=E('notify_list'),badge=E('notify_count');
  if(list)list.innerHTML='<div class="notify-empty">Não foi possível atualizar. Toque no sino para tentar novamente.</div>';
  if(badge)badge.hidden=true
 }finally{bellRefreshing=false}
}
window.refreshMatosBell=refreshBell;
function toggleBell(){var p=E('notify_panel'),b=E('notify_bell');if(!p||!b)return;var opening=p.hidden;p.hidden=!opening;b.setAttribute('aria-expanded',opening?'true':'false');if(opening)refreshBell()}
function bindBell(){var b=E('notify_bell'),all=E('notify_all'),push=E('notify_push'),list=E('notify_list');if(b)b.onclick=function(ev){ev.stopPropagation();toggleBell()};if(all)all.onclick=openAlerts;if(push)push.onclick=openPushSettings;if(list)list.onclick=function(ev){var t=ev.target.closest('[data-alert-open]');if(t)openAlerts()};if(!documentBound){document.addEventListener('click',function(ev){var w=E('notify_wrap'),p=E('notify_panel'),b=E('notify_bell');if(w&&p&&!p.hidden&&!w.contains(ev.target)){p.hidden=true;if(b)b.setAttribute('aria-expanded','false')}});documentBound=true}}
function injectHeaderTools(){var bar=document.querySelector('.appbar');if(!bar)return;var tools=bar.querySelector('.appbar-tools');if(!tools){tools=document.createElement('div');tools.className='appbar-tools';var user=bar.querySelector('.user');bar.insertBefore(tools,user||null)}tools.innerHTML=bellMarkup()+(canMatosOperate()?'':timerMarkup());bindBell();refreshBell();if(bellPoll)clearInterval(bellPoll);bellPoll=setInterval(refreshBell,20000);if(canMatosOperate())stopSessionTimer();else startSessionTimer()}
function sessionStart(){var v=Number(localStorage.getItem(SESSION_START_KEY)||0);if(!v){v=Date.now();localStorage.setItem(SESSION_START_KEY,String(v))}return v}
function formatRemaining(ms){var sec=Math.max(0,Math.ceil(ms/1000)),m=Math.floor(sec/60),s=sec%60;return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}
function expireNonAdminSession(){localStorage.removeItem(SESSION_START_KEY);try{sessionStorage.removeItem('matos_last_activity')}catch(e){}saveSession(null);session=null;currentRole='visitante';currentProfile=null;render();setTimeout(function(){var m=E('msg');if(m)m.innerHTML='<div class="notice">Sua sessão de 20 minutos terminou. Entre novamente para continuar.</div>'},0)}
function updateSessionClock(){if(!session||!session.access_token||canMatosOperate())return;var remain=SESSION_LIMIT_MS-(Date.now()-sessionStart()),clock=E('session_clock'),box=E('session_timer');if(clock)clock.textContent=formatRemaining(remain);if(box){box.classList.toggle('warning',remain<=2*60*1000&&remain>30000);box.classList.toggle('danger',remain<=30000)}if(remain<=0)expireNonAdminSession()}
function startSessionTimer(){if(canMatosOperate()){localStorage.removeItem(SESSION_START_KEY);return}sessionStart();if(timerTick)clearInterval(timerTick);updateSessionClock();timerTick=setInterval(updateSessionClock,1000)}
function stopSessionTimer(){if(timerTick){clearInterval(timerTick);timerTick=null}if(canMatosOperate())localStorage.removeItem(SESSION_START_KEY)}
var originalSaveSession=saveSession;saveSession=function(s){if(s&&s.access_token){localStorage.setItem(SESSION_START_KEY,String(Date.now()))}else{localStorage.removeItem(SESSION_START_KEY)}return originalSaveSession(s)};window.saveSession=saveSession;
var originalShell=shell;shell=function(){originalShell();rememberPage();Array.prototype.forEach.call(document.querySelectorAll('[data-page]'),function(b){b.addEventListener('click',function(){var p=b.getAttribute('data-page');if(p){page=p;rememberPage()}})});injectHeaderTools()};window.shell=shell;
var originalGoQuick=window.goQuick;window.goQuick=function(p){page=p;rememberPage();return originalGoQuick(p)};
window.addEventListener('beforeunload',rememberPage);
})();