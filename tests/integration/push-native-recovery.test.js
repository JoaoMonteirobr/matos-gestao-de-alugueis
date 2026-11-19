import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const pwa = fs.readFileSync(path.join(process.cwd(),'pwa.js'),'utf8');
const alerts = fs.readFileSync(path.join(process.cwd(),'alerts.js'),'utf8');
const start=pwa.indexOf('function vapidKeyBytes(value){');
const end=pwa.indexOf('window.diagnoseMatosPush=async function(){',start);
const block=pwa.slice(start,end);

function harness(options={}){
 const key=Buffer.from(Uint8Array.from({length:65},(_,i)=>i===0?4:i)).toString('base64url');
 const storage=new Map();
 const subscribe=vi.fn(async()=>{
  if(options.fail)throw new Error('Registration failed - push service error');
  return {endpoint:'https://example.invalid/push-id'};
 });
 const getSubscription=vi.fn(async()=>options.existing?{endpoint:'https://example.invalid/previous'}:null);
 const enableRemotePush=vi.fn(async()=>{
  if(options.firebaseFail)throw new Error('Firebase recusou o token');
 });
 const result=options.result||{active:true};
 const registerSW=vi.fn(async()=>({
  active:{state:'activated'},
  pushManager:{getSubscription,subscribe}
 }));
 const window={
  MATOS_FIREBASE:{vapidKey:key},
  Notification:{permission:'granted'},
  PushManager:class PushManager{},
  enableRemotePush,
  getMatosPushDiagnostics:vi.fn(async()=>result),
 };
 const context={
  window,session:{user:{id:'a'},access_token:'mock'},
  Notification:window.Notification,
  isIos:()=>false,isInstalled:()=>true,installHint:()=> 'Instale',
  registerSW,localStorage:{
   getItem:(key)=>storage.get(key)||null,
   setItem:(key,value)=>storage.set(key,value),
  },
  pushFailureCode:(error)=>/push service error/i.test(error.message)?'push-service-error':'unknown',
  pushFailureMessage:(error)=>'O Chrome/Android recusou a inscrição: '+error.message,
  atob:(value)=>Buffer.from(value,'base64').toString('binary'),
  Uint8Array,
 };
 vm.runInNewContext(block,context);
 return {window,storage,subscribe,getSubscription,enableRemotePush,registerSW};
}

describe('recuperação assistida da inscrição Web Push',()=>{
 it('não tenta registrar Firebase se o PushManager do Android recusou inscrição',async()=>{
  const h=harness({fail:true});
  const result=await h.window.repairMatosPush();
  expect(result.ok).toBe(false);
  expect(result.stage).toBe('browser');
  expect(result.reason).toContain('Chrome/Android');
  expect(h.storage.get('matos_push_last_error')).toBe('push-service-error');
  expect(h.subscribe).toHaveBeenCalledOnce();
  expect(h.enableRemotePush).not.toHaveBeenCalled();
 });
 it('registra o Firebase somente após inscrição nativa bem-sucedida',async()=>{
  const h=harness();
  const result=await h.window.repairMatosPush();
  expect(result.ok).toBe(true);
  expect(result.stage).toBe('done');
  expect(h.subscribe).toHaveBeenCalledOnce();
  const args=h.subscribe.mock.calls[0][0];
  expect(args.userVisibleOnly).toBe(true);
  expect(args.applicationServerKey.length).toBe(65);
  expect(args.applicationServerKey[0]).toBe(4);
  expect(h.enableRemotePush).toHaveBeenCalledOnce();
 });
 it('reutiliza inscrição pré-existente, sem gerar outra no Android',async()=>{
  const h=harness({existing:true});
  const result=await h.window.repairMatosPush();
  expect(result.ok).toBe(true);
  expect(h.getSubscription).toHaveBeenCalledOnce();
  expect(h.subscribe).not.toHaveBeenCalled();
  expect(h.enableRemotePush).toHaveBeenCalledOnce();
 });
 it('identifica falha posterior ao PushManager como erro Firebase/servidor',async()=>{
  const h=harness({firebaseFail:true});
  const result=await h.window.repairMatosPush();
  expect(result.ok).toBe(false);
  expect(result.stage).toBe('firebase');
  expect(result.reason).toContain('Firebase recusou o token');
 });
 it('não retira dados de outros dispositivos ou solicita exclusão de tokens',()=>{
  expect(block).not.toContain('deleteToken(');
  expect(block).not.toContain('unsubscribe(');
  expect(block).not.toContain('push_dispositivos?');
  expect(alerts).toContain('Recuperar inscrição push');
  expect(alerts).toContain("result.stage==='browser'");
  expect(alerts).toContain('window.repairMatosPush()');
 });
});
