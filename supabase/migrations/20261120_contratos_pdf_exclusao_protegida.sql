-- Excluir contratos somente se não houver dependências operacionais.
-- IMPORTANTE: não toca em registros existentes, documentos ou valores financeiros.
-- Protege também o acesso REST direto, além da interface e da RPC.
BEGIN;

-- Nunca remover cobranças/pagamentos por exclusão acidental de um contrato.
ALTER TABLE public.cobrancas
  DROP CONSTRAINT IF EXISTS cobrancas_contrato_id_fkey;
ALTER TABLE public.cobrancas
  ADD CONSTRAINT cobrancas_contrato_id_fkey
  FOREIGN KEY (contrato_id) REFERENCES public.contratos(id)
  ON DELETE RESTRICT;

-- Os alertas permanecem na trilha de acompanhamento, mesmo se um
-- contrato digitado errado for removido. Apenas o vínculo fica nulo.
ALTER TABLE public.alertas
  DROP CONSTRAINT IF EXISTS alertas_contrato_id_fkey;
ALTER TABLE public.alertas
  ADD CONSTRAINT alertas_contrato_id_fkey
  FOREIGN KEY (contrato_id) REFERENCES public.contratos(id)
  ON DELETE SET NULL;

-- A função roda com os privilégios do chamador (não contorna RLS).
CREATE OR REPLACE FUNCTION public.bloquear_exclusao_contrato_vinculado()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cobrancas WHERE contrato_id=OLD.id) THEN
    RAISE EXCEPTION 'Contrato vinculado a cobranças. Exclua somente cadastros sem histórico financeiro.'
      USING ERRCODE='23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financeiro WHERE contrato_id=OLD.id) THEN
    RAISE EXCEPTION 'Contrato vinculado a lançamentos financeiros. A exclusão foi bloqueada.'
      USING ERRCODE='23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vistorias WHERE contrato_id=OLD.id) THEN
    RAISE EXCEPTION 'Contrato vinculado a vistorias. A exclusão foi bloqueada.'
      USING ERRCODE='23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.documentos WHERE contrato_id=OLD.id) THEN
    RAISE EXCEPTION 'Contrato possui documentos vinculados. Remova primeiro os anexos do cadastro.'
      USING ERRCODE='23503';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.bloquear_exclusao_contrato_vinculado() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_contratos_exclusao_protegida ON public.contratos;
CREATE TRIGGER trg_contratos_exclusao_protegida
  BEFORE DELETE ON public.contratos
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_exclusao_contrato_vinculado();

-- A operação no app chama esta RPC, mas o gatilho de segurança é aplicado
-- também se outro cliente tentar excluir contratos via REST.
CREATE OR REPLACE FUNCTION public.excluir_contrato_sem_movimento(p_contrato_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_deleted uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o administrador pode excluir contratos.'
      USING ERRCODE='42501';
  END IF;
  IF p_contrato_id IS NULL THEN
    RAISE EXCEPTION 'Informe o contrato a excluir.' USING ERRCODE='22023';
  END IF;

  DELETE FROM public.contratos WHERE id=p_contrato_id RETURNING id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado ou acesso negado.' USING ERRCODE='P0002';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.excluir_contrato_sem_movimento(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_contrato_sem_movimento(uuid) TO authenticated;

COMMIT;