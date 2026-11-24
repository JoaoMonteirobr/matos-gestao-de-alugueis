/* Conta principal: alteração e recuperação de senha verificadas no Supabase.
 * Nenhuma senha ou token é guardado no código, banco de dados ou telemetria.
 */
(function(){
'use strict';
function validPassword(value){
 return typeof value==='string'&&value.length>=12&&value.length<=128&&
  /[a-z]/.test(value)&&/[A-Z]/.test(value)&&/[0-9]/.test(value)&&/[^A-Za-z0-9]/.test(value);
}
function notice(target,text,error){
 var node=document.getElementById(target);
 if(!node)return;
 node.textContent=text;
 node.className='notice '+(error?'err':'success');
}
async function updateAuthPassword(token,password){
 return request('/auth/v1/user',{
  method:'PUT',headers:authHeaders(token),
  body:JSON.stringify({password:password})
 })
}
async function revokeAuthSessions(token){
  try{await request('/auth/v1/logout?scope=global',{method:'POST',headers:authHeaders(token)})}catch(e){}
}
async function passwordPanel(){
 if(!matosIsSuperAdmin||!session?.access_token){
  throw new Error('Configuração de senha restrita ao responsável pelo sistema.')
 }
 var C=E('content');
 C.innerHTML='<section class="panel master-password-panel">'+
  '<h3>Alterar minha senha</h3>'+
  '<p class="muted">Informe a senha atual e defina uma nova senha exclusiva para seu acesso.</p>'+
  '<form id="master_pw_form" autocomplete="off">'+
  '<label class="lbl" for="master_pw_current">Senha atual</label>'+
  '<input class="inp" id="master_pw_current" type="password" autocomplete="current-password" required>'+
  '<label class="lbl" for="master_pw_new">Nova senha</label>'+
  '<input class="inp" id="master_pw_new" type="password" autocomplete="new-password" minlength="12" required>'+
  '<label class="lbl" for="master_pw_again">Confirmar nova senha</label>'+
  '<input class="inp" id="master_pw_again" type="password" autocomplete="new-password" minlength="12" required>'+
  '<p class="muted">Use de 12 a 128 caracteres, com letras maiúsculas, minúsculas, número e símbolo.</p>'+
  '<div id="master_pw_message" role="status" aria-live="polite"></div>'+
  '<button class="btn primary" id="master_pw_save" type="submit">Alterar minha senha</button></form></section>';
 E('master_pw_form').onsubmit=async function(event){
  event.preventDefault();
  if(!matosIsSuperAdmin)return;
  var current=E('master_pw_current').value,next=E('master_pw_new').value,again=E('master_pw_again').value;
  if(!validPassword(next))return notice('master_pw_message','A nova senha precisa ter 12 a 128 caracteres, com letras maiúsculas, minúsculas, número e símbolo.',true);
  if(next!==again)return notice('master_pw_message','A confirmação não corresponde à nova senha.',true);
  if(next===current)return notice('master_pw_message','Escolha uma senha diferente da atual.',true);
  var btn=E('master_pw_save');btn.disabled=true;
  try{
   var user=await request('/auth/v1/user',{headers:authHeaders(session.access_token)});
   if(!user?.email)throw new Error('Sua conta não tem e-mail de autenticação válido.');
   // Confirma a senha atual junto ao serviço de autenticação antes de alterá-la.
   await request('/auth/v1/token?grant_type=password',{
    method:'POST',headers:authHeaders(),
    body:JSON.stringify({email:user.email,password:current})
   });
   await updateAuthPassword(session.access_token,next);
   ['master_pw_current','master_pw_new','master_pw_again'].forEach(function(id){if(E(id))E(id).value=''});
   saveSession(null);session=null;currentRole='visitante';currentProfile=null;matosIsSuperAdmin=false;
   render();
   if(E('msg'))E('msg').textContent='Senha atualizada. Entre novamente com sua nova senha.';
  }catch(error){
   notice('master_pw_message','Não foi possível alterar sua senha. Confira a senha atual e tente novamente. '+String(error?.message||''),true)
  }finally{if(btn?.isConnected)btn.disabled=false}
 }
}
async function recoverIfPresent(){
 var hash=new URLSearchParams((location.hash||'').replace(/^#/,''));
 var isRecovery=hash.get('type')==='recovery';
 if(!isRecovery)return false;
 var token=hash.get('access_token');
 history.replaceState(null,'',location.pathname+location.search);
 if(!token){
  APP.innerHTML='<div class="boot"><div class="bootbox"><h3>Link de recuperação inválido</h3><p>Solicite um novo link pelo formulário de login.</p><button class="btn primary" id="recover_back">Voltar ao login</button></div></div>';
  E('recover_back').onclick=function(){login()};
  return true
 }
 // Nunca criar sessão normal a partir de um link de recuperação.
 APP.innerHTML='<div class="boot"><div class="bootbox"><h3>Verificando recuperação de acesso...</h3></div></div>';
 try{
  await request('/auth/v1/user',{headers:authHeaders(token)});
  var allowed=await request('/rest/v1/rpc/matos_is_superadmin',{
   method:'POST',headers:authHeaders(token),body:'{}'
  });
  if(allowed!==true)throw new Error('Este procedimento é exclusivo da conta responsável pela configuração.');
  APP.innerHTML='<div class="auth master-recovery"><section class="formwrap">'+
   '<div class="login"><div class="ey">Recuperação de acesso</div><div class="title">Definir nova senha</div>'+
   '<p>Confirme a nova senha para sua conta.</p><form id="master_recover_form">'+
   '<label class="lbl" for="master_recover_new">Nova senha</label>'+
   '<input class="inp" id="master_recover_new" type="password" autocomplete="new-password" required>'+
   '<label class="lbl" for="master_recover_again">Confirmar senha</label>'+
   '<input class="inp" id="master_recover_again" type="password" autocomplete="new-password" required>'+
   '<p class="muted">Mínimo de 12 caracteres, maiúscula, minúscula, número e símbolo.</p>'+
   '<div id="master_recover_message" role="status" aria-live="polite"></div>'+
   '<button class="btn primary" id="master_recover_save" type="submit">Salvar nova senha</button></form></div></section></div>';
  E('master_recover_form').onsubmit=async function(event){
   event.preventDefault();
   var pass=E('master_recover_new').value,again=E('master_recover_again').value;
   if(!validPassword(pass))return notice('master_recover_message','A senha deve ter 12 a 128 caracteres, letras maiúsculas, minúsculas, número e símbolo.',true);
   if(pass!==again)return notice('master_recover_message','As senhas não coincidem.',true);
   var button=E('master_recover_save');button.disabled=true;
   try{
    await updateAuthPassword(token,pass);
    token=null;
    saveSession(null);session=null;matosIsSuperAdmin=false;
    login();
    if(E('msg'))E('msg').textContent='Senha recuperada com segurança. Entre com a nova senha.';
   }catch(error){
    notice('master_recover_message','Não foi possível definir a senha. O link pode estar expirado; solicite outro.',true);
    button.disabled=false
   }
  };
 }catch(error){
  token=null;
  APP.innerHTML='<div class="boot"><div class="bootbox"><h3>Recuperação não autorizada</h3><p>'+
    esc(error?.message||'Solicite um novo link de recuperação.')+'</p>'+
    '<button class="btn primary" id="recover_back">Voltar ao login</button></div></div>';
  E('recover_back').onclick=function(){login()}
 }
 return true
}
window.MatosMasterSecurity={passwordPanel:passwordPanel,recoverIfPresent:recoverIfPresent,validPassword:validPassword};
})();
