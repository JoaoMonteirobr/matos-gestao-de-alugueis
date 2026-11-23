-- Etapa 1: credencial de propriedade privada. Designação da conta principal
-- é feita em SQL protegido de operação, NÃO em repositório ou no navegador.
BEGIN;
CREATE SCHEMA IF NOT EXISTS matos_private;
REVOKE ALL ON SCHEMA matos_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS matos_private.superadmin (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE matos_private.superadmin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON matos_private.superadmin FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.matos_is_superadmin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT EXISTS(
  SELECT 1 FROM matos_private.superadmin sa
  WHERE sa.user_id=(SELECT auth.uid()) AND sa.enabled
 );
$$;
REVOKE ALL ON FUNCTION public.matos_is_superadmin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.matos_is_superadmin() TO authenticated,service_role;
COMMIT;