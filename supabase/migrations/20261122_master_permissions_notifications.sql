-- Etapa 2: executar APENAS depois de designar e validar superadmin privado.
-- Preserva perfil 'admin' no app, com super-privilégio server-side.
BEGIN;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM matos_private.superadmin WHERE enabled;
 IF n<>1 THEN
  RAISE EXCEPTION 'Implantação bloqueada: esperado exatamente um superadministrador, encontrado %', n;
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM matos_private.superadmin s JOIN public.perfis p ON p.user_id=s.user_id
  WHERE s.enabled AND p.role='admin'
 ) THEN
  RAISE EXCEPTION 'Implantação bloqueada: o usuário privilegiado perdeu o papel administrativo.';
 END IF;
END $$;

-- Não permitir que o próprio responsável ou um cliente REST exclua o seu
-- perfil nem troque o seu papel, evitando perda de acesso por erro operacional.
CREATE OR REPLACE FUNCTION public.matos_preservar_conta_principal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $
BEGIN
 IF EXISTS(
  SELECT 1 FROM matos_private.superadmin s WHERE s.user_id=OLD.user_id AND s.enabled
 ) THEN
  IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'A conta principal não pode ser excluída.' USING ERRCODE='42501';
  END IF;
  IF NEW.user_id<>OLD.user_id OR NEW.role<>'admin' THEN
   RAISE EXCEPTION 'O perfil da conta principal é protegido.' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$;
REVOKE ALL ON FUNCTION public.matos_preservar_conta_principal() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_matos_preservar_conta_principal ON public.perfis;
CREATE TRIGGER trg_matos_preservar_conta_principal
BEFORE UPDATE OR DELETE ON public.perfis FOR EACH ROW EXECUTE FUNCTION public.matos_preservar_conta_principal();

-- Somente a conta designada altera estruturas administrativas ou auditoria.
ALTER POLICY perfis_admin_all ON public.perfis
 USING (public.matos_is_superadmin()) WITH CHECK (public.matos_is_superadmin());
ALTER POLICY configuracoes_admin_all ON public.configuracoes
 USING (public.matos_is_superadmin()) WITH CHECK (public.matos_is_superadmin());
ALTER POLICY auditoria_admin_select ON public.auditoria
 USING (public.matos_is_superadmin());
ALTER POLICY admins_read_login_auditoria ON public.login_auditoria
 USING (public.matos_is_superadmin());

-- Administrador operacional: cadastro de imóveis e inquilinos e pagamentos.
-- Outras tabelas continuam consultáveis conforme o RLS já configurado.
DO $$
DECLARE p record;
BEGIN
 FOR p IN
  SELECT tablename,policyname
  FROM pg_policies WHERE schemaname='public' AND cmd='ALL'
  AND tablename IN (
   'contratos','documentos','financeiro','iptu','gastos','gasto_anexos',
   'gasto_tipos','proprietarios','repasses','vistorias','vistoria_itens',
   'manutencoes'
  )
 LOOP
  EXECUTE format('ALTER POLICY %I ON public.%I USING (public.matos_is_superadmin()) WITH CHECK (public.matos_is_superadmin())',
   p.policyname,p.tablename);
 END LOOP;
END $$;

-- A leitura necessária a cadastros e relatórios continua liberada ao
-- administrador operacional, mas escrita nessas tabelas exige super privilégio.
DO $
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['proprietarios','gastos','gasto_tipos','gasto_anexos'] LOOP
  EXECUTE format(
    'CREATE POLICY matos_operador_consulta ON public.%I FOR SELECT TO authenticated USING (public.is_admin())',
    tab
  );
 END LOOP;
END $;

-- Ações relativas a senhas, alertas de login e outros dados de segurança.
ALTER POLICY alertas_admin_all ON public.alertas
 USING (public.matos_is_superadmin()) WITH CHECK (public.matos_is_superadmin());
ALTER POLICY alertas_vinculados_select ON public.alertas
 USING (
  public.matos_is_superadmin()
  OR (
   tipo <> 'login' AND (
    public.is_admin()
    OR (imovel_id IS NOT NULL AND public.usuario_pode_ver_imovel(imovel_id))
    OR (contrato_id IS NOT NULL AND public.usuario_pode_ver_contrato(contrato_id))
   )
  )
 );
CREATE POLICY alertas_operador_consulta_leitura
 ON public.alertas FOR SELECT TO authenticated
 USING (tipo <> 'login' AND (public.is_admin() OR public.eh_consulta_geral()));

-- Apenas o superadministrador muda os anexos, gastos e documentos protegidos.
DO $$
DECLARE p record;
BEGIN
 FOR p IN
  SELECT policyname,cmd
  FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
    AND policyname IN (
      'documentos_imoveis_admin_delete','documentos_imoveis_admin_insert',
      'documentos_imoveis_admin_update','gastos_notas_admin_delete',
      'gastos_notas_admin_insert','gastos_notas_admin_update')
 LOOP
  IF p.cmd='INSERT' THEN
    EXECUTE format(
      'ALTER POLICY %I ON storage.objects WITH CHECK (bucket_id=%L AND public.matos_is_superadmin())',
      p.policyname,CASE WHEN p.policyname LIKE 'gastos%%' THEN 'gastos-notas' ELSE 'documentos-imoveis' END);
  ELSIF p.cmd='UPDATE' THEN
    EXECUTE format(
      'ALTER POLICY %I ON storage.objects USING (bucket_id=%L AND public.matos_is_superadmin()) WITH CHECK (bucket_id=%L AND public.matos_is_superadmin())',
      p.policyname,CASE WHEN p.policyname LIKE 'gastos%%' THEN 'gastos-notas' ELSE 'documentos-imoveis' END,
      CASE WHEN p.policyname LIKE 'gastos%%' THEN 'gastos-notas' ELSE 'documentos-imoveis' END);
  ELSE
    EXECUTE format(
      'ALTER POLICY %I ON storage.objects USING (bucket_id=%L AND public.matos_is_superadmin())',
      p.policyname,CASE WHEN p.policyname LIKE 'gastos%%' THEN 'gastos-notas' ELSE 'documentos-imoveis' END);
  END IF;
 END LOOP;
END $$;

-- Funções SECURITY DEFINER que alteram dados em lote precisam de verificação
-- privilegiada explícita: políticas de tabela não se aplicam a seu proprietário.
-- Conserva integralmente a lógica financeira original, alterando apenas o gate.
DO $
DECLARE
 func_name text; previous text; updated text;
BEGIN
 FOREACH func_name IN ARRAY ARRAY[
  'public.gerar_cobrancas_mes(date)',
  'public.gerar_repasses_mes(date)',
  'public.gerar_alertas_operacionais()'
 ] LOOP
  SELECT pg_get_functiondef(func_name::regprocedure) INTO previous;
  IF previous IS NULL THEN
   RAISE EXCEPTION 'Função de segurança ausente: %',func_name;
  END IF;
  updated:=replace(previous,'if not public.is_admin() then',
    'if not public.matos_is_superadmin() then');
  updated:=replace(updated,'if not is_admin() then',
    'if not public.matos_is_superadmin() then');
  IF updated=previous THEN
   RAISE EXCEPTION 'Gate administrativo não encontrado em %',func_name;
  END IF;
  EXECUTE updated;
 END LOOP;
END $;

-- Inbox coerente para todo usuário: contagem total (sem limite 200) e até
-- oito mensagens atuais. Retorna apenas linhas visíveis sob o próprio RLS.
CREATE OR REPLACE FUNCTION public.matos_notificacoes_inbox()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$
 WITH visible AS (
  SELECT a.id,a.tipo,a.titulo,a.mensagem,a.prioridade,a.created_at
  FROM public.alertas a
  WHERE a.resolvido=false
   AND (a.tipo <> 'login' OR public.matos_is_superadmin())
   AND NOT EXISTS(
    SELECT 1 FROM public.alertas_leituras l
    WHERE l.alerta_id=a.id AND l.user_id=(SELECT auth.uid())
   )
 ),
 recent AS (
  SELECT * FROM visible ORDER BY created_at DESC LIMIT 8
 )
 SELECT jsonb_build_object(
  'total', (SELECT count(*) FROM visible),
  'items', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC) FROM recent r),'[]'::jsonb)
 );
$$;
REVOKE ALL ON FUNCTION public.matos_notificacoes_inbox() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.matos_notificacoes_inbox() TO authenticated;

COMMIT;