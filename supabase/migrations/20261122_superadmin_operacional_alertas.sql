-- Política de menor privilégio: 1 superadministrador (João Paulo), 1 operador,
-- proprietária em modo consulta. É intencional que este migration nunca
-- exponha IDs/e-mails dos usuários nem modifique senhas/lançamentos.
BEGIN;
DO $guard$
DECLARE n integer;
BEGIN
 SELECT COUNT(*) INTO n FROM public.perfis p JOIN auth.users u ON u.id=p.user_id
 WHERE p.nome='João Paulo' AND p.role='admin'
   AND u.email_confirmed_at IS NOT NULL AND u.email IS NOT NULL
   AND u.email NOT LIKE '%@matos.invalid';
 IF n<>1 THEN
   RAISE EXCEPTION 'Não foi possível identificar unicamente o superadministrador confirmado. Nenhum acesso foi alterado.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.perfis WHERE nome='Ney Freitas' AND role='admin') THEN
   RAISE EXCEPTION 'Conta administrativa operacional não encontrada. Migração cancelada.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.perfis WHERE nome='Maria Gorette Buzanello Matos' AND role='proprietario_consulta') THEN
   RAISE EXCEPTION 'Conta proprietária não encontrada. Migração cancelada.';
 END IF;
END $guard$;

ALTER TABLE public.perfis DROP CONSTRAINT perfis_role_check;
ALTER TABLE public.perfis ADD CONSTRAINT perfis_role_check
 CHECK(role=ANY(ARRAY['superadmin','admin','proprietario',
                      'proprietario_consulta','inquilino']));

UPDATE public.perfis SET role='superadmin'
 WHERE nome='João Paulo' AND role='admin';

-- A função antiga is_admin, já usada em RLS e operações críticas, passa a
-- representar SOMENTE o nível proprietário/técnico da Casa Matos.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.perfis p
  WHERE p.user_id=(SELECT auth.uid()) AND p.role='superadmin');
$fn$;

-- Operador é limitado a imóveis, inquilinos e pagamentos.
CREATE OR REPLACE FUNCTION public.is_operador()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.perfis p
  WHERE p.user_id=(SELECT auth.uid()) AND p.role IN ('superadmin','admin'));
$fn$;
REVOKE ALL ON FUNCTION public.is_operador() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_operador() TO authenticated,service_role;

-- Proteções em tabelas: permissões antigas '*_admin_all' passam a
-- valer apenas para o superadmin. Operador recebe grants explícitos.
DROP POLICY IF EXISTS matos_operador_imoveis_select ON public.imoveis;
CREATE POLICY matos_operador_imoveis_select ON public.imoveis FOR SELECT TO authenticated
 USING(public.is_operador());
DROP POLICY IF EXISTS matos_operador_imoveis_insert ON public.imoveis;
CREATE POLICY matos_operador_imoveis_insert ON public.imoveis FOR INSERT TO authenticated
 WITH CHECK(public.is_operador());
DROP POLICY IF EXISTS matos_operador_imoveis_update ON public.imoveis;
CREATE POLICY matos_operador_imoveis_update ON public.imoveis FOR UPDATE TO authenticated
 USING(public.is_operador()) WITH CHECK(public.is_operador());

DROP POLICY IF EXISTS matos_operador_inquilinos_select ON public.inquilinos;
CREATE POLICY matos_operador_inquilinos_select ON public.inquilinos FOR SELECT TO authenticated
 USING(public.is_operador());
DROP POLICY IF EXISTS matos_operador_inquilinos_insert ON public.inquilinos;
CREATE POLICY matos_operador_inquilinos_insert ON public.inquilinos FOR INSERT TO authenticated
 WITH CHECK(public.is_operador());
DROP POLICY IF EXISTS matos_operador_inquilinos_update ON public.inquilinos;
CREATE POLICY matos_operador_inquilinos_update ON public.inquilinos FOR UPDATE TO authenticated
 USING(public.is_operador()) WITH CHECK(public.is_operador());

DROP POLICY IF EXISTS matos_operador_cobrancas_select ON public.cobrancas;
CREATE POLICY matos_operador_cobrancas_select ON public.cobrancas FOR SELECT TO authenticated
 USING(public.is_operador());
DROP POLICY IF EXISTS matos_operador_cobrancas_insert ON public.cobrancas;
CREATE POLICY matos_operador_cobrancas_insert ON public.cobrancas FOR INSERT TO authenticated
 WITH CHECK(public.is_operador());
DROP POLICY IF EXISTS matos_operador_cobrancas_update ON public.cobrancas;
CREATE POLICY matos_operador_cobrancas_update ON public.cobrancas FOR UPDATE TO authenticated
 USING(public.is_operador()) WITH CHECK(public.is_operador());

-- Dados necessários à visualização/relatórios: operador pode ler, nunca
-- alterar configurações, contratos, IPTU, manutenção, repasses ou auditoria.
DO $reader$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY[
  'proprietarios','contratos','iptu','financeiro','gastos','gasto_tipos',
  'gasto_anexos','manutencoes','documentos','repasses',
  'vistorias','vistoria_itens'
 ] LOOP
  EXECUTE format('DROP POLICY IF EXISTS matos_operador_leitura ON public.%I',tab);
  EXECUTE format('CREATE POLICY matos_operador_leitura ON public.%I
   FOR SELECT TO authenticated USING(public.is_operador())',tab);
 END LOOP;
END $reader$;

-- Auditoria, acessos, sistema e configurações estritamente do superadmin.
DROP POLICY IF EXISTS admins_read_login_auditoria ON public.login_auditoria;
CREATE POLICY admins_read_login_auditoria ON public.login_auditoria FOR SELECT
 TO authenticated USING(public.is_admin());

DROP POLICY IF EXISTS configuracoes_auth_select ON public.configuracoes;
CREATE POLICY configuracoes_auth_select ON public.configuracoes FOR SELECT
 TO authenticated USING(public.is_admin());

-- Os demais usuários veem apenas alertas operacionais que o RLS autoriza.
DROP POLICY IF EXISTS matos_operador_alertas_select ON public.alertas;
CREATE POLICY matos_operador_alertas_select ON public.alertas FOR SELECT
 TO authenticated USING(public.is_operador() AND tipo<>'login');
DROP POLICY IF EXISTS matos_consulta_alertas_select ON public.alertas;
CREATE POLICY matos_consulta_alertas_select ON public.alertas FOR SELECT
 TO authenticated USING(public.eh_consulta_geral() AND tipo<>'login');

-- A política vinculada continua limitada a imóvel/contrato, mas jamais
-- permite que outro perfil enxergue logins de sistema.
DROP POLICY IF EXISTS alertas_vinculados_select ON public.alertas;
CREATE POLICY alertas_vinculados_select ON public.alertas FOR SELECT TO authenticated
 USING(public.is_admin() OR
  (tipo<>'login' AND (
   (imovel_id IS NOT NULL AND public.usuario_pode_ver_imovel(imovel_id))
   OR (contrato_id IS NOT NULL AND public.usuario_pode_ver_contrato(contrato_id))
  ))
 );

-- Comprovantes: o administrador operacional pode enviar e corrigir o
-- comprovante do pagamento; não acessa arquivos privados de configuração.
DROP POLICY IF EXISTS comprovantes_operador_select ON storage.objects;
CREATE POLICY comprovantes_operador_select ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='comprovantes' AND public.is_operador());
DROP POLICY IF EXISTS comprovantes_operador_insert ON storage.objects;
CREATE POLICY comprovantes_operador_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='comprovantes' AND public.is_operador());
DROP POLICY IF EXISTS comprovantes_operador_update ON storage.objects;
CREATE POLICY comprovantes_operador_update ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='comprovantes' AND public.is_operador())
 WITH CHECK(bucket_id='comprovantes' AND public.is_operador());
DROP POLICY IF EXISTS comprovantes_operador_delete ON storage.objects;
CREATE POLICY comprovantes_operador_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='comprovantes' AND public.is_operador());

-- Operador continua podendo visualizar a própria foto, mas não alterar
-- avatares alheios; proprietária não recebe poderes adicionais.
DROP POLICY IF EXISTS avatares_operador_self_read ON storage.objects;
CREATE POLICY avatares_operador_self_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='avatares-admin' AND public.is_operador()
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
DROP POLICY IF EXISTS avatares_operador_self_upload ON storage.objects;
CREATE POLICY avatares_operador_self_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='avatares-admin' AND public.is_operador()
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
DROP POLICY IF EXISTS avatares_operador_self_delete ON storage.objects;
CREATE POLICY avatares_operador_self_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='avatares-admin' AND public.is_operador()
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);

-- Entrega externa push permanece vinculada ao superadmin, sem alterar
-- o canal Telegram já conectado ao usuário.
CREATE OR REPLACE FUNCTION public.enfileirar_push_alerta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF NEW.resolvido OR NEW.tipo='login' THEN RETURN NEW; END IF;
 INSERT INTO public.push_fila(alerta_id,user_id,titulo,mensagem,url)
 SELECT NEW.id,p.user_id,NEW.titulo,NEW.mensagem,'/?pagina=Alertas'
 FROM public.perfis p WHERE p.role='superadmin'
 ON CONFLICT(alerta_id,user_id) DO NOTHING;
 RETURN NEW;
END;
$fn$;

-- Número real de alertas não lidos para cada usuário. SECURITY INVOKER
-- mantém o RLS da tabela alertas e das leituras por usuário; sem limite
-- artificial de 200/3000 linhas e sem contabilizar logins no sino.
CREATE OR REPLACE FUNCTION public.contar_alertas_nao_lidos()
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $fn$
 SELECT COUNT(*)::integer
 FROM public.alertas a
 WHERE (SELECT auth.uid()) IS NOT NULL
   AND NOT a.resolvido
   AND a.tipo<>'login'
   AND NOT EXISTS(
     SELECT 1 FROM public.alertas_leituras l
      WHERE l.user_id=(SELECT auth.uid()) AND l.alerta_id=a.id
   );
$fn$;
REVOKE ALL ON FUNCTION public.contar_alertas_nao_lidos() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contar_alertas_nao_lidos() TO authenticated;

-- Proteção de solicitações de recuperação: somente o servidor acessa
-- os registros e há uma solicitação por combinação IP/e-mail a cada 10min.
CREATE TABLE IF NOT EXISTS public.matos_recuperacao_limites(
 chave_hash text PRIMARY KEY,
 ultima_solicitacao timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.matos_recuperacao_limites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.matos_recuperacao_limites FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.matos_recuperacao_limites TO service_role;

CREATE OR REPLACE FUNCTION public.matos_pode_recuperar_senha(p_chave_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE allowed integer;
BEGIN
 IF p_chave_hash !~ '^[a-f0-9]{64} THEN RETURN false; END IF;
 INSERT INTO public.matos_recuperacao_limites(chave_hash,ultima_solicitacao)
 VALUES(p_chave_hash,now())
 ON CONFLICT(chave_hash) DO UPDATE SET ultima_solicitacao=now()
 WHERE matos_recuperacao_limites.ultima_solicitacao < now()-interval '10 minutes';
 GET DIAGNOSTICS allowed=ROW_COUNT;
 RETURN allowed=1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.matos_pode_recuperar_senha(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.matos_pode_recuperar_senha(text) TO service_role;


-- Prévia de alertas na mesma condição do contador, sem a amostragem
-- antiga de até 200 alertas e 3000 leituras.
CREATE OR REPLACE FUNCTION public.listar_alertas_nao_lidos(p_limite integer DEFAULT 8)
RETURNS SETOF public.alertas LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $fn$
 SELECT a.* FROM public.alertas a
 WHERE (SELECT auth.uid()) IS NOT NULL
   AND NOT a.resolvido
   AND a.tipo<>'login'
   AND NOT EXISTS(
     SELECT 1 FROM public.alertas_leituras l
      WHERE l.user_id=(SELECT auth.uid()) AND l.alerta_id=a.id
   )
 ORDER BY CASE a.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END,
          a.created_at DESC
 LIMIT LEAST(GREATEST(COALESCE(p_limite,8),1),30);
$fn$;
REVOKE ALL ON FUNCTION public.listar_alertas_nao_lidos(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.listar_alertas_nao_lidos(integer) TO authenticated;


-- A galeria de avatar existente reconhece o novo nível de gestor,
-- sem ampliar privilégios aos perfis de consulta.
CREATE OR REPLACE FUNCTION public.definir_meu_avatar(
 p_tipo text,p_emoji text DEFAULT NULL,p_path text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 v_id uuid := (SELECT auth.uid());
 v_role text;
 v_emojis text[] := ARRAY[
  '😎','🤓','🤠','🥳','😺','🐼','🦁','🐯','🦊','🐻','🐸','🐵',
  '🦄','🐉','👽','🤖','👻','🎃','🧙','🧑‍🚀','🦸','🥷','👑','🦖'
 ];
BEGIN
 IF v_id IS NULL THEN
  RAISE EXCEPTION 'Sessão inválida. Entre novamente.' USING ERRCODE='42501';
 END IF;
 SELECT role INTO v_role FROM public.perfis WHERE user_id=v_id FOR UPDATE;
 IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN
  RAISE EXCEPTION 'Somente equipe administrativa pode alterar o avatar.'
   USING ERRCODE='42501';
 END IF;
 IF p_tipo NOT IN ('inicial','emoji','foto') OR p_tipo IS NULL THEN
  RAISE EXCEPTION 'Tipo de avatar inválido.' USING ERRCODE='22023';
 END IF;
 IF p_tipo='emoji' AND (p_emoji IS NULL OR NOT p_emoji=ANY(v_emojis)) THEN
  RAISE EXCEPTION 'Escolha um personagem da galeria.' USING ERRCODE='22023';
 END IF;
 IF p_tipo='foto' THEN
  IF p_path IS NULL OR p_path !~ ('^'||v_id::text||'/[0-9a-f-]{36}[.](jpg|png|webp))
   OR NOT EXISTS(SELECT 1 FROM storage.objects
     WHERE bucket_id='avatares-admin' AND name=p_path AND owner_id=v_id::text) THEN
   RAISE EXCEPTION 'Foto inválida ou não enviada pela conta.' USING ERRCODE='42501';
  END IF;
 END IF;
 UPDATE public.perfis SET
  avatar_tipo=p_tipo,
  avatar_emoji=CASE WHEN p_tipo='emoji' THEN p_emoji ELSE NULL END,
  avatar_path=CASE WHEN p_tipo='foto' THEN p_path ELSE NULL END
 WHERE user_id=v_id;
 RETURN jsonb_build_object('ok',true,'avatar_tipo',p_tipo,
  'avatar_emoji',CASE WHEN p_tipo='emoji' THEN p_emoji ELSE NULL END,
  'avatar_path',CASE WHEN p_tipo='foto' THEN p_path ELSE NULL END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.definir_meu_avatar(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.definir_meu_avatar(text,text,text) TO authenticated;

COMMIT;