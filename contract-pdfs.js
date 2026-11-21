/* Anexos de contratos: PDF privado no bucket documentos-imoveis, sem links públicos. */
(function(){
'use strict';
var BUCKET='documentos-imoveis',MAX_PDF_BYTES=15*1024*1024;
var UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminOnly(){
 if(currentRole!=='admin')throw new Error('Somente o administrador pode alterar contratos.');
 if(!session?.access_token)throw new Error('Sua sessão expirou. Entre novamente no sistema.')
}
function encodePath(path){
 return String(path||'').split('/').map(encodeURIComponent).join('/')
}
function privateObjectUrl(path){
 return SUPA_URL+'/storage/v1/object/'+BUCKET+'/'+encodePath(path)
}
function newFileId(){
 if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
 var bytes=crypto.getRandomValues(new Uint8Array(16));
 return Array.from(bytes,function(x){return x.toString(16).padStart(2,'0')}).join('')
}
async function validatePdf(file){
 if(!file||typeof file.name!=='string'||!file.name.toLowerCase().endsWith('.pdf')){
  throw new Error('Selecione um contrato no formato PDF (.pdf).')
 }
 if(file.type&&file.type!=='application/pdf')throw new Error('O arquivo deve ser um PDF.');
 if(!file.size||file.size>MAX_PDF_BYTES)throw new Error('O PDF deve ter entre 1 byte e 15 MB.');
 if(typeof file.slice!=='function')throw new Error('Não foi possível validar o PDF selecionado.');
 var bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());
 if(String.fromCharCode.apply(null,Array.from(bytes))!=='%PDF-'){
  throw new Error('O arquivo não contém uma assinatura válida de PDF.')
 }
 return true
}
async function list(){
 if(!session?.access_token)throw new Error('Entre novamente para consultar os documentos.');
 var qs='/rest/v1/documentos?select=id,contrato_id,arquivo_path,arquivo_nome,arquivo_tipo,created_at'+
   '&categoria=eq.Contrato&order=created_at.desc';
 var docs=await request(qs,{headers:authHeaders(session.access_token)});
 return (Array.isArray(docs)?docs:[]).filter(function(d){return d.contrato_id&&d.arquivo_path&&
  (d.arquivo_tipo==='application/pdf'||String(d.arquivo_nome||'').toLowerCase().endsWith('.pdf'))})
}
async function removeStorage(path){
 var response=await fetch(privateObjectUrl(path),{
  method:'DELETE',headers:authHeaders(session.access_token)
 });
 return response.ok
}
async function upload(contract,file){
 adminOnly();
 if(!contract||!UUID.test(String(contract.id||'')))throw new Error('Salve primeiro um contrato válido.');
 await validatePdf(file);
 var path='contratos/'+contract.id+'/'+newFileId()+'.pdf';
 var response=await fetch(privateObjectUrl(path),{
  method:'POST',headers:Object.assign(authHeaders(session.access_token),{
   'Content-Type':'application/pdf','x-upsert':'false'
  }),body:file
 });
 if(!response.ok)throw new Error('Não foi possível enviar o PDF ao armazenamento privado (HTTP '+response.status+').');
 try{
  var docs=await dbInsert('documentos',{
   titulo:'Contrato de locação - '+String(file.name).slice(0,160),
   categoria:'Contrato',contrato_id:contract.id,
   imovel_id:contract.imovel_id,inquilino_id:contract.inquilino_id,
   arquivo_path:path,arquivo_nome:String(file.name).slice(0,255),
   arquivo_tipo:'application/pdf',
  });
  if(!Array.isArray(docs)||docs.length!==1||!docs[0].id){
   throw new Error('O documento foi enviado, mas o registro não foi confirmado.')
  }
  return docs[0]
 }catch(e){
  try{await removeStorage(path)}catch(_){}
  throw new Error('Não foi possível vincular o PDF ao contrato: '+e.message)
 }
}
async function open(doc){
 if(!doc?.arquivo_path)throw new Error('O contrato não possui PDF.');
 if(typeof window.openDocumentoPrivado!=='function')throw new Error('Visualizador privado indisponível.');
 return window.openDocumentoPrivado(doc.arquivo_path)
}
async function remove(doc){
 adminOnly();
 if(!doc||!UUID.test(String(doc.id||'')))throw new Error('Documento inválido.');
 if(!window.confirm('Remover o PDF "'+String(doc.arquivo_nome||'contrato')+'"? O cadastro do contrato será mantido.'))return false;
 var result=await request('/rest/v1/documentos?id=eq.'+encodeURIComponent(doc.id)+
  '&categoria=eq.Contrato&contrato_id=eq.'+encodeURIComponent(doc.contrato_id),{
  method:'DELETE',headers:Object.assign(authHeaders(session.access_token),{'Prefer':'return=representation'})
 });
 if(!Array.isArray(result)||result.length!==1)throw new Error('O PDF não foi removido. Atualize a página e tente novamente.');
 // Remoção posterior: mantém a referência intacta se a operação no banco falhar.
 // Falha de Storage deixa apenas um arquivo órfão e privado, nunca apaga cobrança.
 var cleaned=false;
 try{cleaned=await removeStorage(doc.arquivo_path)}catch(_){}
 return {removed:true,cleaned:cleaned}
}
async function deleteContract(id){
 adminOnly();
 if(!UUID.test(String(id||'')))throw new Error('Identificador do contrato inválido.');
 var deleted=await request('/rest/v1/rpc/excluir_contrato_sem_movimento',{
  method:'POST',headers:Object.assign(authHeaders(session.access_token),{
   'Content-Type':'application/json'
  }),body:JSON.stringify({p_contrato_id:id})
 });
 if(deleted!==true)throw new Error('Não foi possível confirmar a exclusão do contrato.');
 return true
}
window.MatosContractFiles={
 list:list,validatePdf:validatePdf,upload:upload,open:open,remove:remove,
 deleteContract:deleteContract
};
})();