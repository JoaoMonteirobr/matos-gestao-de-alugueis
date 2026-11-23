import { expect, test } from '@playwright/test';

const USER='00000000-0000-4000-8000-000000000111';
const CONTRACT='10000000-0000-4000-8000-000000000001';
const PROPERTY='20000000-0000-4000-8000-000000000002';
const TENANT='30000000-0000-4000-8000-000000000003';
const DOCUMENT='40000000-0000-4000-8000-000000000004';
const samplePdf={name:'Contrato assinado.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')};

async function openContracts(page,role='admin'){
 test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL)||process.env.MATOS_E2E_EXTERNAL==='1',
  'Fluxo de contratos usa dados simulados somente no build local, sem alterar produção.');
 const now=[{
  id:CONTRACT,imovel_id:PROPERTY,inquilino_id:TENANT,
  data_inicio:'2026-11-01',data_fim:'2027-11-01',
  dia_vencimento:5,aluguel_atual:1800,status:'ativo',
 }];
 const docs=[];let uploads=0, deletions=0,requests=[];
 await page.addInitScript((id)=>{
  localStorage.setItem('matos_session',JSON.stringify({
   access_token:'token-simulado',user:{id,email:'teste@example.invalid'}
  }));
 },USER);
 await page.route('https://behmmbgbrsesxthsczdl.supabase.co/**',async(route)=>{
  const url=new URL(route.request().url()),method=route.request().method();
  const respond=(data,status=200)=>route.fulfill({
   status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},
   body:JSON.stringify(data)
  });
  requests.push({pathname:url.pathname,method});
  if(url.pathname==='/auth/v1/user')return respond({id:USER,email:'teste@example.invalid'});
  if (url.pathname === '/rest/v1/rpc/matos_is_superadmin') return respond(true);
    if (url.pathname === '/rest/v1/rpc/matos_notificacoes_inbox') {
      return respond({total:0,items:[]});
    }
    if(url.pathname==='/rest/v1/perfis')return respond([{user_id:USER,nome:'Usuário Teste',role}]);
  if(url.pathname==='/rest/v1/contratos'){
   if(method==='POST'){
    const data=route.request().postDataJSON();const created={...data,id:CONTRACT};
    now.push(created);return respond([created],201);
   }
   return respond(now);
  }
  if(url.pathname==='/rest/v1/imoveis')return respond([{
   id:PROPERTY,nome:'Galeria Matos — Loja 02',
   status:'ocupado',inquilino_id:TENANT,aluguel_base:1800
  }]);
  if(url.pathname==='/rest/v1/inquilinos')return respond([{
   id:TENANT,nome:'Inquilino de teste'
  }]);
  if(url.pathname==='/rest/v1/documentos'){
   if(method==='POST'){
    const obj=route.request().postDataJSON(),record={id:DOCUMENT,...obj};
    docs.push(record);return respond([record],201);
   }
   if(method==='DELETE'){
    const index=docs.findIndex(x=>x.id===DOCUMENT);
    if(index<0)return respond([]);
    return respond([docs.splice(index,1)[0]]);
   }
   return respond(docs);
  }
  if(url.pathname==='/rest/v1/rpc/excluir_contrato_sem_movimento'){
   deletions++;
   if(docs.length)return respond({message:'Contrato possui documentos vinculados.'},409);
   now.length=0;
   return respond(true);
  }
  if(url.pathname.startsWith('/storage/v1/object/documentos-imoveis/')){
   if(method==='POST'){uploads++;return respond({Key:'contratos/simulado.pdf'});}
   if(method==='DELETE')return respond({});
  }
  if(url.pathname.startsWith('/storage/v1/object/sign/documentos-imoveis/')){
   return respond({signedURL:'/storage/v1/object/sign/documentos-imoveis/simulado.pdf?token=falso'});
  }
  return respond([]);
 });
 await page.goto('/');
 await expect(page.locator('#notify_bell')).toBeVisible();
 await page.evaluate(()=>goQuick('Contratos'));
 await expect(page.locator('.contracts-table')).toBeVisible();
 return {docs,now,requests,counts:()=>({uploads,deletions})};
}

test('administrador anexa PDF e exclusão não apaga contrato com documento',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const state=await openContracts(page);
 await expect(page.getByRole('button',{name:'Anexar PDF'})).toBeVisible();
 await page.locator('[data-contract-file]').setInputFiles(samplePdf);
 await expect(page.getByRole('button',{name:'Ver PDF'})).toBeVisible();
 expect(state.counts().uploads).toBe(1);
 expect(state.docs).toHaveLength(1);
 page.on('dialog',d=>d.accept());
 await page.getByRole('button',{name:'Excluir',exact:true}).click();
 await expect(page.locator('#contract-doc-status')).toContainText('Exclusão bloqueada');
 expect(state.now).toHaveLength(1);

 await page.getByRole('button',{name:/Remover PDF/}).click();
 await expect(page.locator('.contracts-table')).toContainText('Sem PDF anexado');
 expect(state.docs).toHaveLength(0);
 await page.getByRole('button',{name:'Excluir',exact:true}).click();
 await expect(page.locator('.contracts-table')).toContainText('Nenhum contrato cadastrado');
 expect(state.now).toHaveLength(0);
 expect(state.counts().deletions).toBe(2);
 expect(errors).toEqual([]);
});

test('cadastro permite PDF opcional e fica disponível também em Configurações',async({page})=>{
 const state=await openContracts(page);
 await page.evaluate(()=>window.MatosSettings.open('Contratos'));
 await expect(page.locator('#backSettings')).toBeVisible();
 await expect(page.getByRole('button',{name:'Novo contrato'})).toBeVisible();
 await page.getByRole('button',{name:'Novo contrato'}).click();
 await expect(page.locator('#ct_pdf')).toBeAttached();
 await expect(page.locator('#ct_pdf')).toHaveAttribute('accept','.pdf,application/pdf');
 expect(state.counts().uploads).toBe(0);
});

test('perfil de consulta vê PDF, mas não consegue anexar, editar ou excluir',async({page})=>{
 await openContracts(page,'proprietario_consulta');
 await expect(page.locator('.contracts-table')).toBeVisible();
 await expect(page.locator('.contracts-table')).toContainText('Sem PDF anexado');
 await expect(page.getByRole('button',{name:'Novo contrato'})).toHaveCount(0);
 await expect(page.locator('[data-contract-delete]')).toHaveCount(0);
 await expect(page.locator('[data-contract-attach]')).toHaveCount(0);
 await expect(page.locator('[data-contract-edit]')).toHaveCount(0);
});
