(function(){
'use strict';
if(adminMenus.indexOf('Alertas')<0)adminMenus.splice(1,0,'Alertas');
if(ownerMenus.indexOf('Alertas')<0)ownerMenus.splice(1,0,'Alertas');

var alertFilter='pendencias',alertsVisible=30,readIds=new Set();

function categoryLabel(type){
 var labels={login:'Acesso ao sistema',cobranca_atrasada:'Aluguel em atraso',
  cobranca_vencendo:'Aluguel a vencer',contrato_vencendo:'Contrato a vencer',
  contrato_vencido:'Contrato vencido',documento_vencendo:'Documento a vencer'};
 return labels[type]||String(type||'Alerta').replaceAll('_',' ')
}
function unread(a){return !a.resolvido&&!readIds.has(a.id)}
function operational(a){return a.tipo!=='login'}
function visibleRows(){
 var rows=window._alerts||[];
 if(alertFilter==='pendencias')return rows.filter(function(a){return operational(a)&&!a.resolvido});
 if(alertFilter==='nao_lidas')return rows.filter(function(a){return operational(a)&&unread(a)});
 if(alertFilter==='acessos')return rows.filter(function(a){return !operational(a)});
 return rows
}
function counts(){
 var all=window._alerts||[],active=all.filter(function(a){return operational(a)&&!a.resolvido});
 return {unread:Math.max(0,Number(window._alertsUnreadTotal??all.filter(function(a){return operational(a)&&unread(a)}).length)),active:active.length,
  urgent:active.filter(function(a){return a.prioridade==='urgente'}).length,
  login:all.filter(function(a){return a.tipo==='login'}).length}
}
function dateAlert(a){return dateBR(a.data_evento||a.created_at)}
function badgeMarkup(a){
 var tag=operational(a)?a.prioridade:'login',text=tag==='urgente'?'Urgente':
  tag==='alta'?'Alta prioridade':tag==='login'?'Acesso':'Informativo';
 var color=tag==='urgente'?'danger':tag==='alta'?'warning':'muted';
 return '<span class="alert-tag '+color+'">'+esc(text)+'</span>'
}
function rowMarkup(a){
 var isUnread=unread(a),done=a.resolvido;
 var actions=(isUnread?
  '<button class="btn secondary" type="button" onclick="markAlertReadUI(\''+a.id+'\')">Marcar como lida</button>':'');
 if(!done&&operational(a)&&isMatosSuper()){
  actions+='<button class="btn secondary" type="button" onclick="resolveAlert(\''+a.id+'\')">Resolver pendência</button>';
 }
 return '<article class="alert-entry'+(isUnread?' is-unread':'')+'">'+
  '<div class="alert-entry-body"><div class="alert-meta">'+
   '<span class="alert-category">'+esc(categoryLabel(a.tipo))+'</span>'+badgeMarkup(a)+
   (isUnread?'<span class="alert-tag new">Não lida</span>':'')+
   (done?'<span class="alert-tag done">Resolvido</span>':'')+'</div>'+
   '<h4>'+esc(a.titulo||'Notificação')+'</h4>'+
   '<p>'+esc(a.mensagem||'')+'</p>'+
   '<small>'+esc(dateAlert(a))+'</small></div>'+
   (actions?'<div class="alert-entry-actions">'+actions+'</div>':'')+'</article>'
}
function displayAlerts(){
 var target=E('alerts_list');if(!target)return;
 var total=counts(),nodes=visibleRows(),shown=nodes.slice(0,alertsVisible);
 var boxes={unread:'alerts_stat_unread',active:'alerts_stat_active',urgent:'alerts_stat_urgent'};
 Object.keys(boxes).forEach(function(key){var el=E(boxes[key]);if(el)el.textContent=String(total[key])});
 var count=E('alerts_filter_count');if(count)count.textContent=String(nodes.length)+' registro(s)';
 var btn=E('alerts_mark_all');if(btn)btn.disabled=!total.unread;
 document.querySelectorAll('[data-alert-filter]').forEach(function(el){
  var on=el.getAttribute('data-alert-filter')===alertFilter;
  el.classList.toggle('selected',on);el.setAttribute('aria-pressed',on?'true':'false')
 });
 if(nodes.length===0){
  var msg=alertFilter==='pendencias'?'Nenhuma pendência operacional aberta.':
   alertFilter==='nao_lidas'?'Tudo lido! Não há notificações novas.':
   'Nenhum alerta nesta categoria.';
  target.innerHTML='<div class="alerts-empty">'+esc(msg)+'</div>';
 }else target.innerHTML=shown.map(rowMarkup).join('');
 var more=E('alerts_more');if(more){more.hidden=nodes.length<=alertsVisible;
  more.textContent='Mostrar mais ('+(nodes.length-shown.length)+')'}
}
function changeAlertFilter(next){
 if(['pendencias','nao_lidas','acessos','historico'].indexOf(next)<0)return;
 alertFilter=next;alertsVisible=30;displayAlerts()
}
window.changeAlertFilter=changeAlertFilter;
function message(text,isError){
 var x=E('alerts_msg');if(x)x.innerHTML='<div class="notice '+(isError?'err':'success')+'">'+esc(text)+'</div>'
}
function errorText(e){
 var s=String(e&&e.message||e||'Erro desconhecido');
 if(/Failed to fetch|Load failed|NetworkError|network request failed/i.test(s))
  return 'Não foi possível conectar ao servidor. Confira a internet e tente novamente.';
 return s
}
async function refreshAlerts(){
 if(!isMatosSuper())return;
 try{await request('/rest/v1/rpc/gerar_alertas_operacionais',{
  method:'POST',headers:authHeaders(session.access_token),body:'{}'
 })}catch(e){}
}
async function fetchAlertState(){
 var results=await Promise.all([
  request('/rest/v1/alertas?select=*&tipo=neq.login&order=resolvido.asc,created_at.desc&limit=300',{
   headers:authHeaders(session.access_token)}),
  isMatosSuper()?request('/rest/v1/alertas?select=*&tipo=eq.login&order=created_at.desc&limit=50',{
   headers:authHeaders(session.access_token)}):Promise.resolve([]),
  request('/rest/v1/alertas_leituras?select=alerta_id&user_id=eq.'+
   encodeURIComponent(session.user.id)+'&limit=3000',{headers:authHeaders(session.access_token)}),
  request('/rest/v1/rpc/contar_alertas_nao_lidos',{
   method:'POST',headers:authHeaders(session.access_token),body:'{}'
  })
 ]);
 window._alerts=(results[0]||[]).concat(results[1]||[]);
 readIds=new Set((results[2]||[]).map(function(a){return a.alerta_id}));
 window._alertsUnreadTotal=Number(results[3]||0);
}
async function markAlertsRead(ids){
 if(!session||!session.access_token)throw new Error('Faça login para marcar alertas como lidos.');
 var result=await request('/rest/v1/rpc/marcar_alertas_como_lidos',{
  method:'POST',headers:authHeaders(session.access_token),
  body:JSON.stringify({p_ids:ids||null})
 });
 var candidates=(window._alerts||[]).filter(function(a){
  return !a.resolvido&&(!ids||ids.indexOf(a.id)>=0)
 });
 candidates.forEach(function(a){readIds.add(a.id)});
 await fetchAlertState();
 displayAlerts();
 if(typeof window.refreshMatosBell==='function')window.refreshMatosBell();
 return Number(result||0)
}
async function markAllAlertsReadUI(){
 var btn=E('alerts_mark_all');if(btn)btn.disabled=true;
 try{
  await markAlertsRead(null);
  message('Notificações marcadas como lidas. As pendências continuam abertas até serem resolvidas.',false)
 }catch(e){message('Não foi possível marcar todas como lidas. '+errorText(e),true);displayAlerts()}
}
window.markAllAlertsReadUI=markAllAlertsReadUI;
async function markAlertReadUI(id){
 try{await markAlertsRead([id])}catch(e){message(errorText(e),true)}
}
window.markAlertReadUI=markAlertReadUI;
async function resolveAlert(id){
 if(!isMatosSuper())return;
 try{
  await request('/rest/v1/alertas?id=eq.'+encodeURIComponent(id),{
   method:'PATCH',headers:Object.assign(authHeaders(session.access_token),
    {'Prefer':'return=representation'}),
   body:JSON.stringify({resolvido:true,resolvido_em:new Date().toISOString()})
  });
  await fetchAlertState();displayAlerts();
  if(typeof window.refreshMatosBell==='function')window.refreshMatosBell();
  message('Pendência marcada como resolvida.',false)
 }catch(e){message(errorText(e),true)}
}
window.resolveAlert=resolveAlert;

function notifStatus(){
 if(!('Notification' in window))return 'Não suportado';
 if(Notification.permission==='granted')return 'Verificando aparelho...';
 if(Notification.permission==='denied')return 'Bloqueado';
 return 'Não ativado'
}
function pushMessage(text,error){
 var m=E('push_msg');if(m)m.innerHTML='<div class="notice '+(error?'err':'success')+'">'+esc(text)+'</div>'
}
async function activatePushUI(){
 pushMessage('Registrando este aparelho...',false);
 try{
  await window.enableRemotePush();
  pushMessage('Este aparelho foi registrado para notificações externas.',false);
  var x=E('push_status');if(x)x.textContent=notifStatus();
  refreshMatosPushStatusUI()
 }catch(e){
  pushMessage(errorText(e),true);
  refreshMatosPushStatusUI()
 }
}
window.activatePushUI=activatePushUI;
async function testPushUI(){
 try{
  await window.testMatosNotification();
  pushMessage('Teste local exibido. Esse teste verifica apenas o navegador.',false)
 }catch(e){pushMessage(errorText(e),true)}
}
window.testPushUI=testPushUI;
async function testRemotePushUI(){
 var b=E('push_test_remote');if(b)b.disabled=true;
 pushMessage('Consultando o Firebase...',false);
 try{
  var r=await window.testMatosRemotePush();
  pushMessage('Firebase aceitou o envio para este aparelho. Confira se o Android exibiu a notificação; a confirmação de entrega depende do celular.',false);
  refreshMatosPushStatusUI()
 }catch(e){pushMessage(errorText(e),true)}
 finally{if(b)b.disabled=false}
}
window.testRemotePushUI=testRemotePushUI;
async function refreshMatosPushStatusUI(){
 var x=E('push_diagnostic'),server=E('push_server_status'),help=E('push_provider_help');
 var deviceHint=E('push_device_hint');
 if(!server)return;
 try{
  var d=await window.getMatosPushDiagnostics();
  if(x)x.textContent=d.active?'Inscrição detectada neste aparelho':
   d.permission==='denied'?'Notificações bloqueadas':
   d.ios&&!d.installed?'Instale na Tela de Início no iPhone/iPad':
   !d.pushSubscription?'Sem inscrição push ativa no navegador':
   !d.serverRegistered?'Sem registro válido para este aparelho':'Verificação necessária';
  var s=E('push_status');
  if(s)s.textContent=d.active?'Inscrição detectada':
   d.permission==='denied'?'Bloqueado':
   d.lastError==='push-service-error'?'Falha no serviço push do Android':
   d.permission==='granted'?'Registro não confirmado':'Não ativado';
  if(deviceHint){
   deviceHint.hidden=d.lastError!=='push-service-error';
   if(!deviceHint.hidden)deviceHint.textContent=
    'O último registro falhou no serviço push do Chrome/Android. O Firebase do servidor pode estar conectado mesmo assim. Toque em “Verificar meu celular” para diagnóstico e orientações.'
  }
 }catch(e){if(x)x.textContent='Registro indisponível';
  var s=E('push_status');if(s)s.textContent='Verificação indisponível'}
 if(isMatosSuper()){
  try{
   var status=await window.getMatosPushServerStatus();
   server.textContent=status.configured?'Firebase conectado':'Credencial Firebase pendente';
   if(help)help.hidden=Boolean(status.configured)
  }catch(e){
   server.textContent='Não foi possível verificar a conexão';
   if(help)help.hidden=true
  }
 }else server.textContent='Disponível ao administrador'
}
window.refreshMatosPushStatusUI=refreshMatosPushStatusUI;
async function diagnosePushUI(){
 var msg=E('push_msg');if(!msg)return;
 var hint=E('push_device_hint');if(hint)hint.hidden=true;
 try{
  var d=await window.diagnoseMatosPush();
  var checks=[
   'Permissão do navegador: '+d.permission,
   'Internet: '+(d.online?'conectada':'sem conexão'),
   'Serviço do aplicativo: '+(d.workerActive?'ativo':'não ativo'),
   'Inscrição push do navegador: '+(d.pushSubscription?'encontrada':'não encontrada'),
   'Registro neste aparelho: '+(d.serverRegistered?'encontrado':'não encontrado')
  ];
  msg.innerHTML='<div class="notice '+(d.active?'success':'err')+'">'+
   '<strong>Diagnóstico deste aparelho</strong><ul>'+
   checks.map(function(line){return '<li>'+esc(line)+'</li>'}).join('')+
   '</ul><p>'+esc(d.advice)+'</p></div>'
 }catch(e){pushMessage('Não foi possível verificar o celular. '+errorText(e),true)}
}
window.diagnosePushUI=diagnosePushUI;

async function repairPushUI(){
 var button=E('push_repair'),hint=E('push_device_hint');
 if(button)button.disabled=true;
 if(hint)hint.hidden=true;
 pushMessage('Verificando a inscrição diretamente no navegador...',false);
 try{
  var result=await window.repairMatosPush();
  if(result.ok){
   pushMessage(result.reason,false);
  }else{
   var step=result.stage==='browser'?'O serviço push do Chrome/Android recusou a inscrição. ':
    result.stage==='firebase'?'O navegador aceitou a inscrição, mas o Firebase/servidor falhou. ':
    'A inscrição não pôde ser confirmada. ';
   pushMessage(step+result.reason,true);
  }
 }catch(e){pushMessage(errorText(e),true)}
 finally{
  if(button)button.disabled=false;
  refreshMatosPushStatusUI()
 }
}
window.repairPushUI=repairPushUI;
async function resetPushUI(){
 try{
  await window.resetMatosPush();
  pushMessage('Registro desativado neste aparelho. Para receber avisos novamente, toque em Ativar.',false);
  refreshMatosPushStatusUI()
 }catch(e){pushMessage(errorText(e),true)}
}
window.resetPushUI=resetPushUI;

function alertToolbar(){
 return '<div class="alerts-metrics">'+
  '<div class="alerts-metric"><span>Não lidas</span><strong id="alerts_stat_unread">0</strong></div>'+
  '<div class="alerts-metric"><span>Pendências em aberto</span><strong id="alerts_stat_active">0</strong></div>'+
  '<div class="alerts-metric"><span>Urgentes</span><strong id="alerts_stat_urgent">0</strong></div>'+
  '</div><section class="panel alerts-inbox">'+
  '<div class="alerts-section-head"><div><h3>Caixa de entrada</h3>'+
  '<p class="muted">Concentre-se nas pendências. Os acessos ficam em uma aba separada.</p></div>'+
  '<button class="btn primary" type="button" id="alerts_mark_all" onclick="markAllAlertsReadUI()">Marcar todas como lidas</button></div>'+
  '<div class="alerts-filter-bar" aria-label="Filtrar notificações">'+
  '<button type="button" data-alert-filter="pendencias">Pendências</button>'+
  '<button type="button" data-alert-filter="nao_lidas">Não lidas</button>'+
  (isMatosSuper()?'<button type="button" data-alert-filter="acessos">Acessos</button>':'')+
  '<button type="button" data-alert-filter="historico">Histórico completo</button></div>'+
  '<p class="alerts-result-count" id="alerts_filter_count"></p>'+
  '<div id="alerts_msg" role="status" aria-live="polite"></div>'+
  '<div id="alerts_list" class="alerts-list"></div>'+
  '<button class="btn secondary alerts-more" id="alerts_more" type="button" hidden>Mostrar mais</button>'+
  '</section>'
}
function pushPanel(){
 return '<section class="panel alerts-push"><div class="alerts-section-head">'+
  '<div><h3>Notificações no celular</h3><p class="muted">Avisos mesmo com o sistema fechado.</p></div>'+
  '<button class="btn primary" type="button" id="push_test_remote" onclick="testRemotePushUI()">Testar push remoto (Firebase)</button></div>'+
  '<div class="alerts-push-status">'+
  '<div><small>Neste aparelho</small><strong id="push_status">'+esc(notifStatus())+'</strong></div>'+
  '<div><small>Servidor</small><strong id="push_server_status">Verificando...</strong></div></div>'+
  '<details class="alerts-push-advanced" id="push_advanced"><summary>Ativar e configurar notificações</summary>'+
  '<p class="muted">No iPhone/iPad, instale pelo Safari na Tela de Início antes de ativar o push.</p>'+
  '<p class="muted">Registro do aparelho: <strong id="push_diagnostic">Verificando...</strong></p>'+
  '<div class="alerts-push-actions">'+
  '<button class="btn primary" type="button" onclick="activatePushUI()">Ativar notificações</button>'+
  '<button class="btn secondary" type="button" id="push_diagnose" onclick="diagnosePushUI()">Verificar meu celular</button>'+
  '<button class="btn secondary" type="button" id="push_repair" onclick="repairPushUI()">Recuperar inscrição push</button>'+
  '<button class="btn secondary" type="button" onclick="testPushUI()">Testar notificação local</button>'+
  '<button class="btn secondary" type="button" onclick="resetPushUI()">Desativar neste aparelho</button>'+
  '<button class="btn secondary" type="button" onclick="installMatosApp()">Instalar aplicativo</button></div>'+
  '</details>'+
  '<p class="notice err" id="push_provider_help" hidden>A credencial Firebase ainda precisa ser configurada em Supabase → Edge Functions → Secrets.</p>'+
  '<p class="notice err" id="push_device_hint" hidden></p>'+
  '<div id="push_msg" role="status" aria-live="polite"></div></section>'
}
async function alertasPage(){
 var C=E('content');if(!C)return;
 C.innerHTML='<div class="panel">Carregando alertas...</div>';
 try{
  await refreshAlerts();
  await fetchAlertState();
  C.innerHTML='<div class="alerts-page">'+alertToolbar()+(isMatosSuper()&&window.matosTelegramPanel?window.matosTelegramPanel():'')+(isMatosSuper()?pushPanel():'')+'</div>';
  C.querySelectorAll('[data-alert-filter]').forEach(function(button){
   button.onclick=function(){changeAlertFilter(button.getAttribute('data-alert-filter'))}
  });
  var more=E('alerts_more');if(more)more.onclick=function(){alertsVisible+=30;displayAlerts()};
  displayAlerts();if(isMatosSuper()){refreshMatosPushStatusUI();if(typeof window.matosTelegramMount==='function')window.matosTelegramMount()}
  if(window.matosScrollToPush){
   window.matosScrollToPush=false;
   var target=E('push_test_remote');if(target)target.scrollIntoView({block:'center',behavior:'smooth'})
  }
 }catch(e){C.innerHTML='<div class="notice err">Não foi possível carregar a Central de Alertas. '+
  esc(errorText(e))+' <button class="btn secondary" type="button" onclick="load()">Tentar novamente</button></div>'}
}
window.alertasPage=alertasPage;
var oldLoad=window.load;
window.load=async function(){if(page==='Alertas')return alertasPage();return oldLoad()};
})();