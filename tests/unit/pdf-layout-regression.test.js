import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read=(file)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
const charge=read('charge-pdf-safe.js');
const css=read('simple-ui.css');
const html=read('index.html');
const start=charge.indexOf('function fitChargePdf(');
const end=charge.indexOf('async function generateChargePdf()',start);
const helpers=new Function(charge.slice(start,end)+'\nreturn {fitChargePdf,chargePdfLines,chargeObservations};')();

describe('preflight de documentos financeiros PDF',()=>{
 it('limita nome do inquilino e endereço à célula sem sobrepor o vencimento',()=>{
  const mock={
   setFontSize:()=>{},
   getTextWidth:(str)=>String(str).length,
   splitTextToSize:(str,width)=>{
    const s=String(str),result=[];
    for(let i=0;i<s.length;i+=Math.floor(width))result.push(s.slice(i,i+Math.floor(width)));
    return result
   },
  };
  const name='Inquilino de teste '.repeat(20);
  const tenant=helpers.fitChargePdf(mock,name,72,9);
  expect(tenant.endsWith('...')).toBe(true);
  expect(mock.getTextWidth(tenant)).toBeLessThanOrEqual(72);
  const address=helpers.chargePdfLines(mock,'Avenida extenso endereço comercial '.repeat(30),80,9,2);
  expect(address).toHaveLength(2);
  for(const line of address)expect(mock.getTextWidth(line)).toBeLessThanOrEqual(80);
 });
 it('cria páginas adicionais para observações extensas sem cortar o conteúdo',()=>{
  let pages=1;
  const calls=[];
  const mock={
   setFont:()=>{},setFontSize:()=>{},setTextColor:()=>{},setFillColor:()=>{},rect:()=>{},
   internal:{getNumberOfPages:()=>pages},
   addPage:()=>{pages++},
   text:(text,x,y)=>{calls.push({value:text,x,y,page:pages})},
   splitTextToSize:(str)=>Array.from({length:111},(_,i)=>'Linha de observação '+String(i+1).padStart(3,'0')),
  };
  helpers.chargeObservations(mock,'Observações de teste', [16,41,69],[91,108,126]);
  expect(pages).toBe(4);
  const written=calls.filter(c=>Array.isArray(c.value)).flatMap(c=>c.value);
  expect(written).toHaveLength(111);
  expect(written[0]).toContain('001');
  expect(written.at(-1)).toContain('111');
  expect(calls.filter(c=>Array.isArray(c.value)).every(c=>c.y===62)).toBe(true);
 });
 it('mantém PIX íntegro, sem cortar chave nem código copia e cola',()=>{
  expect(charge).toContain("validatePayload(payload)");
  expect(charge).toContain("doc.splitTextToSize(key,105)");
  expect(charge).toContain("doc.splitTextToSize(payload,105)");
  expect(charge).toContain('chargeObservations(doc,obs,navy,gray)');
  expect(charge).toContain('fitChargePdf(doc,E2(');
  expect(html).toContain('/charge-pdf-safe.js?v=3');
 });
 it('garante que tabela impressa não seja cortada pelo contêiner com rolagem',()=>{
  expect(css).toContain('.matos-monthly-report .tablewrap,#printArea .tablewrap');
  expect(css).toContain('overflow:visible!important');
  expect(css).toContain('.matos-monthly-report .report-table thead{display:table-header-group}');
  expect(html).toContain('/simple-ui.css?v=21');
 });
});
