import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const source=read('contract-pdfs.js');
const ui=read('simple-ui.js');
const sql=read('supabase/migrations/20261120_contratos_pdf_exclusao_protegida.sql');
const html=read('index.html');
const UUID='10000000-0000-4000-8000-000000000001';
const DOC_ID='20000000-0000-4000-8000-000000000002';
const documentRow={
 id:DOC_ID,contrato_id:UUID,arquivo_path:'contratos/'+UUID+'/pdf-simulado.pdf',
 arquivo_nome:'Contrato assinado.pdf',arquivo_tipo:'application/pdf',
};
const contract={id:UUID,imovel_id:'imovel-test',inquilino_id:'inquilino-test'};

function harness(options={}){
 const calls=[],activeFiles=[documentRow];
 let role=options.role||'admin';
 const ctx={
  window:{},currentRole:role,matosIsSuperAdmin:role==='admin',session:{access_token:'jwt-de-teste'},
  SUPA_URL:'https://projeto-simulado.supabase.co',
  authHeaders:()=>({apikey:'anon-publica','Authorization':'Bearer jwt-de-teste'}),
  crypto:{randomUUID:()=>DOC_ID},
  Uint8Array,Array,Blob,
  dbInsert:async(table,obj)=>{
   calls.push({type:'dbInsert',table,obj});
   if(options.insertFail)throw new Error('falha simulada');
   return [{id:DOC_ID,...obj}]
  },
  request:async(url,opts)=>{
   calls.push({type:'request',url,opts});
   if(url.includes('/rest/v1/rpc/excluir_contrato_sem_movimento')){
    if(options.deleteFail)throw new Error('Contrato vinculado a cobranças.');
    return true;
   }
   if(url.includes('/rest/v1/documentos?')&&(!opts||opts.method!=='DELETE')){
    return options.empty?[]:activeFiles;
   }
   if(opts?.method==='DELETE')return options.deleteFileFail?[]:[documentRow];
   return [];
  },
  fetch:async(url,opts)=>{
   calls.push({type:'storage',url,opts});
   return {ok:!options.uploadFail,status:options.uploadFail?403:200};
  },
 };
 ctx.window.confirm=()=>true;
 ctx.window.openDocumentoPrivado=async(path)=>{calls.push({type:'open',path})};
 vm.runInNewContext(source,ctx,{filename:'contract-pdfs.js'});
 return {api:ctx.window.MatosContractFiles,calls,ctx};
}
const pdf={
 name:'Contrato assinado.pdf',type:'application/pdf',size:1500,
 slice:()=>({arrayBuffer:async()=>new TextEncoder().encode('%PDF-').buffer}),
};
describe('documentos de contratos e exclusão segura',()=>{
 it('usa bucket privado e mantém a autorização do servidor nas alterações',()=>{
  expect(source).toContain("var BUCKET='documentos-imoveis'");
  expect(source).toContain("!matosIsSuperAdmin");
  expect(source).toContain("categoria:'Contrato',contrato_id:contract.id");
  expect(source).toContain("arquivo_tipo:'application/pdf'");
  expect(source).not.toContain('/object/public/');
  expect(source).not.toContain('service_role');
  expect(html).toContain('/contract-pdfs.js?v=2');
  expect(html).toContain('/simple-ui.js?v=27');
  expect(ui).toContain('data-contract-attach');
  expect(ui).toContain('data-contract-view');
  expect(ui).toContain('data-contract-delete');
  expect(ui).toContain('id="ct_pdf"');
 });
 it('valida extensão, MIME, tamanho e assinatura do PDF antes de enviar',async()=>{
  const {api}=harness();
  await expect(api.validatePdf(pdf)).resolves.toBe(true);
  await expect(api.validatePdf({...pdf,name:'invalido.txt'})).rejects.toThrow(/formato PDF/i);
  await expect(api.validatePdf({...pdf,type:'image/png'})).rejects.toThrow(/deve ser um PDF/i);
  await expect(api.validatePdf({...pdf,size:16*1024*1024})).rejects.toThrow(/15 MB/i);
  await expect(api.validatePdf({...pdf,slice:()=>({arrayBuffer:async()=>new TextEncoder().encode('FALSO').buffer})})).rejects.toThrow(/assinatura válida/i);
 });
 it('adiciona PDF privado e referencia exata do contrato com comprovante de salvamento',async()=>{
  const {api,calls}=harness();
  const result=await api.upload(contract,pdf);
  expect(result.contrato_id).toBe(UUID);
  expect(result.arquivo_path).toMatch(/^contratos\/10000000.+\.pdf$/);
  expect(calls[0].type).toBe('storage');
  expect(calls[0].opts.method).toBe('POST');
  expect(calls[0].opts.headers.Authorization).toBe('Bearer jwt-de-teste');
  expect(calls[0].opts.headers['x-upsert']).toBe('false');
  expect(calls[1].type).toBe('dbInsert');
  expect(calls[1].table).toBe('documentos');
  expect(calls[1].obj.categoria).toBe('Contrato');
  expect(calls[1].obj.imovel_id).toBe(contract.imovel_id);
  expect(calls[1].obj.inquilino_id).toBe(contract.inquilino_id);
 });
 it('erro ao registrar documento tenta limpar apenas o upload da própria operação',async()=>{
  const {api,calls}=harness({insertFail:true});
  await expect(api.upload(contract,pdf)).rejects.toThrow(/não foi possível vincular/i);
  expect(calls.map(c=>c.type)).toEqual(['storage','dbInsert','storage']);
  expect(calls[2].opts.method).toBe('DELETE');
 });
 it('leitura é controlada por RLS, sem mostrar escrita para consulta',async()=>{
  const {api,calls}=harness({role:'proprietario_consulta'});
  const rows=await api.list();
  expect(rows).toHaveLength(1);
  expect(calls[0].url).toContain('categoria=eq.Contrato');
  await api.open(rows[0]);
  expect(calls.at(-1).path).toBe(documentRow.arquivo_path);
  await expect(api.upload(contract,pdf)).rejects.toThrow(/Somente o administrador/i);
  await expect(api.deleteContract(UUID)).rejects.toThrow(/Somente o administrador/i);
 });
 it('só remove um PDF depois de excluída a sua referência no banco',async()=>{
  const {api,calls}=harness();
  const result=await api.remove(documentRow);
  expect(result).toEqual({removed:true,cleaned:true});
  expect(calls[0].type).toBe('request');
  expect(calls[0].opts.method).toBe('DELETE');
  expect(calls[0].url).toContain('contrato_id=eq.');
  expect(calls[1].type).toBe('storage');
  expect(calls[1].opts.method).toBe('DELETE');
 });
 it('a exclusão de contrato usa RPC autenticada, nunca DELETE genérico com cascata',async()=>{
  const {api,calls}=harness();
  await expect(api.deleteContract(UUID)).resolves.toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('/rest/v1/rpc/excluir_contrato_sem_movimento');
  expect(JSON.parse(calls[0].opts.body)).toEqual({p_contrato_id:UUID});
  await expect(harness({deleteFail:true}).api.deleteContract(UUID)).rejects.toThrow(/vinculado/i);
 });
 it('protege cobranças e trilha de alertas mesmo em acesso REST direto',()=>{
  expect(sql).toContain('ON DELETE RESTRICT');
  expect(sql).toContain('ON DELETE SET NULL');
  expect(sql).toContain('BEFORE DELETE ON public.contratos');
  expect(sql).toContain('SECURITY INVOKER');
  for(const table of ['cobrancas','financeiro','vistorias','documentos']){
   expect(sql).toContain('FROM public.'+table+' WHERE contrato_id=OLD.id');
  }
  expect(sql).toContain("auth.uid() IS NULL OR NOT public.is_admin()");
  expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.excluir_contrato_sem_movimento(uuid) TO authenticated');
  expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.(?:cobrancas|financeiro|vistorias|documentos|alertas)/i);
  expect(sql).not.toContain('SECURITY DEFINER');
 });
});
