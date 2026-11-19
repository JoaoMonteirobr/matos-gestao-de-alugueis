import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (name) => fs.readFileSync(path.join(process.cwd(),name),'utf8');
const pwa = read('pwa.js');
const edge = read('supabase/functions/push-dispatch/index.ts');
const ui = read('alerts.js');

function errorTools(){
 const begin=pwa.indexOf('function pushFailureCode(error){');
 const end=pwa.indexOf('window.MatosPushFailure=',begin);
 expect(begin).toBeGreaterThan(-1);
 expect(end).toBeGreaterThan(begin);
 return new Function(pwa.slice(begin,end)+'\nreturn {pushFailureCode,pushFailureMessage};')();
}
async function diagnosticWithSubscription(subscription) {
 const begin=pwa.indexOf('window.getMatosPushDiagnostics=async function(){');
 const end=pwa.indexOf('window.getMatosPushServerStatus=async function(){',begin);
 expect(begin).toBeGreaterThan(-1);
 expect(end).toBeGreaterThan(begin);
 const ctx={
  window:{Notification:{permission:'granted'}},
  isInstalled:()=>true,
  isIos:()=>false,
  navigator:{onLine:true,serviceWorker:{getRegistration:async()=>({
   active:{scriptURL:'/sw.js'},pushManager:{getSubscription:async()=>subscription}
  })}},
  Notification:{permission:'granted'},
  localStorage:{getItem:(key)=>{
   if(key==='matos_push_token')return 'test-device-token';
   return null;
  }},
  session:{user:{id:'00000000-0000-4000-8000-000000000001'},access_token:'session-test'},
  request:async()=>[{endpoint:'test-device-token',ativo:true}],
  authHeaders:()=>({Authorization:'Bearer session-test'}),
  encodeURIComponent
 };
 vm.runInNewContext(pwa.slice(begin,end),ctx);
 return ctx.window.getMatosPushDiagnostics()
}

describe('diagnóstico do push Android',()=>{
 it('traduz o erro nativo do serviço push do Chrome sem culpar credenciais do servidor',()=>{
  const {pushFailureCode,pushFailureMessage}=errorTools();
  const failure=new Error('Registration failed - push service error');
  expect(pushFailureCode(failure)).toBe('push-service-error');
  expect(pushFailureMessage(failure)).toContain('Chrome/Android');
  expect(pushFailureMessage(failure)).toContain('Serviços do Google Play');
  expect(pushFailureMessage(failure)).toContain('VPN/DNS privado');
 });
 it('não considera ativo um token antigo sem assinatura PushManager',async()=>{
  const d=await diagnosticWithSubscription(null);
  expect(d.tokenStored).toBe(true);
  expect(d.serverRegistered).toBe(true);
  expect(d.workerActive).toBe(true);
  expect(d.pushSubscription).toBe(false);
  expect(d.active).toBe(false);
 });
 it('identifica inscrição detectada apenas quando navegador e servidor concordam',async()=>{
  const d=await diagnosticWithSubscription({endpoint:'browser-private-endpoint'});
  expect(d.pushSubscription).toBe(true);
  expect(d.active).toBe(true);
 });
 it('não apaga registros de outros dispositivos nem força update no SW durante inscrição',()=>{
  const reg=pwa.slice(pwa.indexOf('async function registerSW()'),pwa.indexOf('function pushFailureCode('));
  expect(reg).not.toContain('reg.update()');
  expect(reg).toContain('await navigator.serviceWorker.ready');
  const enable=pwa.slice(pwa.indexOf('window.enableRemotePush=async function()'),pwa.indexOf('window.getMatosPushDiagnostics=async function()'));
  expect(enable).toContain("localStorage.setItem('matos_push_last_error',pushFailureCode(e))");
  expect(enable).toContain('throw new Error(pushFailureMessage(e))');
  expect(enable).toContain("localStorage.removeItem('matos_push_last_error')");
  expect(enable).not.toContain('deleteToken()');
 });
 it('limita teste remoto ao token deste dispositivo pertencente ao usuário autenticado',()=>{
  const device=edge.slice(edge.indexOf('async function runDeviceTest('),edge.indexOf('async function diagnostic('));
  expect(device).toContain(".eq('user_id', auth.user.id).eq('endpoint', deviceToken)");
  expect(device).toContain('.limit(1)');
  expect(device).not.toContain('.limit(3)');
  expect(edge).toContain("runDeviceTest(req, body?.device_token)");
  expect(pwa).toContain("body:JSON.stringify({action:'test',device_token:deviceToken})");
  expect(ui).toContain('Firebase aceitou o envio para este aparelho');
 });
 it('exibe estado não confirmado e oferece diagnóstico sem dados sensíveis',()=>{
  expect(ui).toContain('Verificar meu celular');
  expect(ui).toContain('Inscrição detectada');
  expect(ui).toContain('Falha no serviço push do Android');
  expect(ui).toContain('window.diagnoseMatosPush()');
  expect(pwa).toContain('window.diagnoseMatosPush=async function()');
  const method=pwa.slice(pwa.indexOf('window.diagnoseMatosPush=async function()'),pwa.indexOf('window.resetMatosPush=async function()'));
  expect(method).not.toMatch(/endpoint:\s*token|token:\s*localStorage/);
  expect(method).toContain('Nunca retornar JWT, endpoint, token FCM');
 });
});
