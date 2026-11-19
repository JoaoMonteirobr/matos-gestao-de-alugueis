(function(){
'use strict';
if(adminMenus.indexOf('Alertas')<0)adminMenus.splice(1,0,'Alertas');
if(ownerMenus.indexOf('Alertas')<0)ownerMenus.splice(1,0,'Alertas');
function prioBadge(p){var map={urgente:'red',alta:'red',media:'yellow',baixa:'green'};return '<span class="badge '+(map[p]||'yellow')+'">'+esc((p||'média').charAt(0).toUpperCase()+(p||'média').slice(1))+'</span>'}
function categoryLabel(t){var m={login:'Login',cobranca_atrasada:'Aluguel em atraso',cobranca_vencendo:'Conta a vencer',contrato_vencendo:'Contrato a vencer',contrato_vencido:'Contrato vencido',documento_vencendo:'Documento a vencer'};return m[t]||String(t||'Alerta').replaceAll('_',' ')}
function statusMeta(a){if(a.tipo==='login')return a.resolvido?['Visto','green']:['Novo','blue'];if(a.resolvido)return ['Resolvido','green'];if(a.tipo==='cobranca_atrasada')return ['Em atraso','red'];if(a.tipo==='contrato_vencido')return ['Vencido','red'];if(a.tipo==='cobranca_vencendo'||a.tipo==='contrato_vencendo'||a.tipo==='documento_vencendo')return ['A vencer','yellow'];return ['Aberto','blue']}
function statusBadge(a){var s=statusMeta(a);return '<span class="badge '+s[1]+'">'+esc(s[0])+'</span>'}
function actionLabel(a){return a.tipo==='login'?'Marcar como visto':'Marcar como resolvido'}
async function refreshAlerts(){if(currentRole!=='admin')return;try{await request('/rest/v1/rpc/gerar_alertas_operacionais',{method:'POST',headers:authHeaders(session.access_token),body:'{}'})}catch(e){}}
async function resolveAlert(id){try{await request('/rest/v1/alertas?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:Object.assign(authHeaders(session.access_token),{'Prefer':'return=representation'}),body:JSON.stringify({resolvido:true,resolvido_em:new Date().toISOString()})});alertasPage()}catch(e){alert(e.message)}}
window.resolveAlert=resolveAlert;
function notifStatus(){if(!('Notification'in window))return 'Não suportado';if(Notification.permission==='granted')return localStorage.getItem('matos_push_token')?'Ativado neste aparelho':'Permissão concedida';if(Notification.permission==='denied')return 'Bloqueado no navegador';return 'Ainda não ativado'}
async function activatePushUI(){var m=E('push_msg');if(m)m.innerHTML='<div class="notice">Preparando o serviço de push e registrando este aparelho...</div>';try{await window.enableRemotePush();if(m)m.innerHTML='<div class="notice success">Notificações remotas ativadas e aparelho registrado com sucesso.</div>';var s=E('push_status');if(s)s.textContent=notifStatus();refreshMatosPushStatusUI()}catch(e){if(m)m.innerHTML='<div class="notice err">'+esc(e.message)+'</div>'}}
window.activatePushUI=activatePushUI;
async function testPushUI(){var m=E('push_msg');if(m)m.innerHTML='<div class="notice">Enviando teste local...</div>';try{await window.testMatosNotification();if(m)m.innerHTML='<div class="notice success">Notificação local exibida. Isso confirma permissão e Service Worker.</div>'}catch(e){if(m)m.innerHTML='<div class="notice err">'+esc(e.message)+'</div>'}}
window.testPushUI=testPushUI;

async function testRemotePushUI(){
 var m=E('push_msg'),b=E('push_test_remote');
 if(m)m.innerHTML='<div class="notice">Solicitando teste externo ao servidor Firebase...</div>';
 if(b)b.disabled=true;
 try{
  var result=await window.testMatosRemotePush();
  if(m)m.innerHTML='<div class="notice success">'+
   'Firebase aceitou o envio para '+result.accepted_by_firebase+' aparelho(s). '+
   'Confira a notificação do celular. A exibição depende das permissões do aparelho.</div>';
  refreshMatosPushStatusUI()
 }catch(e){
  if(m)m.innerHTML='<div class="notice err">'+esc(e.message)+'</div>'
 }finally{if(b)b.disabled=false}
}
window.testRemotePushUI=testRemotePushUI;
async function refreshMatosPushStatusUI(){
 var x=E('push_diagnostic');if(!x)return;
 try{
  var d=await window.getMatosPushDiagnostics();
  x.textContent=d.active?'Registrado no servidor ('+d.deviceCount+' aparelho(s) ativo(s))':
   d.permission==='denied'?'Permissão bloqueada no navegador':
   d.ios&&!d.installed?'Instale na Tela de Início (iPhone/iPad)':
   d.permission==='granted'?'Aguardando ativação neste aparelho':'Ainda não ativado'
 }catch(e){x.textContent='Não foi possível consultar o registro no servidor'}
}
window.refreshMatosPushStatusUI=refreshMatosPushStatusUI;

async function resetPushUI(){var m=E('push_msg');if(m)m.innerHTML='<div class="notice">Limpando registro antigo de notificações...</div>';try{await window.resetMatosPush();if(m)m.innerHTML='<div class="notice success">Registro antigo removido. Agora toque em “Ativar notificações”.</div>';var s=E('push_status');if(s)s.textContent=notifStatus();refreshMatosPushStatusUI()}catch(e){if(m)m.innerHTML='<div class="notice err">'+esc(e.message)+'</div>'}}
window.resetPushUI=resetPushUI;
async function alertasPage(){var C=E('content');C.innerHTML='<div class="panel">Atualizando alertas...</div>';await refreshAlerts();try{var data=await request('/rest/v1/alertas?select=*&order=resolvido.asc,created_at.desc&limit=200',{headers:authHeaders(session.access_token)});window._alerts=data||[];var ab=(data||[]).filter(function(x){return !x.resolvido}),urg=ab.filter(function(x){return x.prioridade==='urgente'}).length,alta=ab.filter(function(x){return x.prioridade==='alta'}).length;var rows=(data||[]).map(function(a){return '<tr><td>'+prioBadge(a.prioridade)+'</td><td><span class="badge blue">'+esc(categoryLabel(a.tipo))+'</span></td><td><b>'+esc(a.titulo)+'</b><div class="muted">'+esc(a.mensagem)+'</div></td><td>'+dateBR(a.data_evento)+'</td><td>'+statusBadge(a)+'</td><td>'+(currentRole==='admin'&&!a.resolvido?'<div class="rowactions"><button onclick="resolveAlert(\''+a.id+'\')">'+esc(actionLabel(a))+'</button></div>':'—')+'</td></tr>'}).join('');var controls='<div class="panel"><div class="panel-title"><h3>Notificações no celular</h3></div><p class="muted">Ative o aparelho para receber avisos quando o sistema estiver fechado. O teste <b>remoto</b> confirma se o Firebase aceitou o envio; o teste <b>local</b> verifica apenas o navegador.</p><p class="muted" style="font-size:12px">No iPhone/iPad, adicione o sistema à Tela de Início pelo Safari, abra pelo ícone e então ative as notificações.</p><div class="mini-fin"><div class="mini-stat"><small>Status neste aparelho</small><b id="push_status">'+esc(notifStatus())+'</b></div><div class="mini-stat"><small>Registro no servidor</small><b id="push_diagnostic">Verificando...</b></div><div class="mini-stat"><small>Aplicativo</small><b>'+(localStorage.getItem('matos_pwa_installed')?'Instalado':'Pode ser instalado')+'</b></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn primary" onclick="activatePushUI()">Ativar notificações</button><button class="btn primary" id="push_test_remote" onclick="testRemotePushUI()">Testar push remoto (Firebase)</button><button class="btn secondary" onclick="testPushUI()">Testar notificação local</button><button class="btn secondary" onclick="resetPushUI()">Desativar registro neste aparelho</button><button class="btn secondary" onclick="installMatosApp()">Instalar aplicativo</button></div><div id="push_msg" style="margin-top:10px"></div></div>';C.innerHTML='<div class="cards"><div class="card redish"><div class="cl">Urgentes</div><div class="num">'+urg+'</div></div><div class="card goldish"><div class="cl">Alta prioridade</div><div class="num">'+alta+'</div></div><div class="card blue"><div class="cl">Alertas abertos</div><div class="num">'+ab.length+'</div></div><div class="card greenish"><div class="cl">Resolvidos / vistos</div><div class="num">'+((data||[]).length-ab.length)+'</div></div></div>'+controls+'<div class="panel"><div class="panel-title"><h3>Central de Alertas</h3></div><p class="muted">Logins, atrasos, contas e contratos são classificados separadamente para facilitar a ação correta.</p><div class="tablewrap"><table class="table"><thead><tr><th>Prioridade</th><th>Categoria</th><th>Alerta</th><th>Data</th><th>Situação</th><th>Ações</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" class="empty">Nenhum alerta no momento.</td></tr>')+'</tbody></table></div></div>';refreshMatosPushStatusUI()}catch(e){C.innerHTML='<div class="notice err">'+esc(e.message)+'</div>'}}
var oldLoad=window.load;window.load=async function(){if(page==='Alertas')return alertasPage();return oldLoad()};
})();