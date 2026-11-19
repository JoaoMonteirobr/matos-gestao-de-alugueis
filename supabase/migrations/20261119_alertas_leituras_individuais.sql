-- Leitura individual de alertas sem alterar o status operacional "resolvido".
-- Não modifica cobranças, contratos, imóveis nem registros existentes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.alertas_leituras (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alerta_id uuid NOT NULL REFERENCES public.alertas(id) ON DELETE CASCADE,
  lido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, alerta_id)
);

ALTER TABLE public.alertas_leituras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alertas_leituras FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.alertas_leituras TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alertas_leituras'
      AND policyname = 'leituras_somente_proprio_usuario_select') THEN
    CREATE POLICY leituras_somente_proprio_usuario_select
      ON public.alertas_leituras FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alertas_leituras'
      AND policyname = 'leituras_somente_proprio_usuario_insert') THEN
    CREATE POLICY leituras_somente_proprio_usuario_insert
      ON public.alertas_leituras FOR INSERT TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.alertas a
          WHERE a.id = alerta_id
        )
      );
  END IF;
END $$;

-- SECURITY INVOKER: a tabela alertas mantém suas regras RLS; cada pessoa
-- só pode registrar leitura dos alertas que já tem direito de visualizar.
CREATE OR REPLACE FUNCTION public.marcar_alertas_como_lidos(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.alertas_leituras (user_id, alerta_id)
  SELECT (SELECT auth.uid()), a.id
  FROM public.alertas a
  WHERE NOT a.resolvido
    AND (p_ids IS NULL OR a.id = ANY(p_ids))
  ON CONFLICT (user_id, alerta_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.marcar_alertas_como_lidos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_alertas_como_lidos(uuid[]) TO authenticated;

COMMIT;