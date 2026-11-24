-- Recuperação exclusiva do responsável, sem e-mail ou identificador no código público.
-- A função só pode ser chamada pelo service_role de uma Edge Function.
BEGIN;

CREATE TABLE IF NOT EXISTS matos_private.master_recovery_throttle (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE matos_private.master_recovery_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON matos_private.master_recovery_throttle FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.matos_allow_master_recovery(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_inserted uuid;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) < 5 OR length(trim(p_email)) > 254 THEN
    RETURN false;
  END IF;

  IF (SELECT count(*) FROM matos_private.superadmin WHERE enabled) <> 1 THEN
    RETURN false;
  END IF;

  SELECT s.user_id INTO v_user
  FROM matos_private.superadmin s
  JOIN auth.users u ON u.id = s.user_id
  JOIN public.perfis p ON p.user_id = s.user_id
  WHERE s.enabled
    AND p.role = 'admin'
    AND u.email_confirmed_at IS NOT NULL
    AND lower(u.email) = lower(trim(p_email));

  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  -- Limita o envio a uma solicitação a cada dez minutos por conta.
  INSERT INTO matos_private.master_recovery_throttle(user_id, requested_at)
  VALUES (v_user, now())
  ON CONFLICT (user_id)
  DO UPDATE SET requested_at = EXCLUDED.requested_at
    WHERE matos_private.master_recovery_throttle.requested_at <= now() - interval '10 minutes'
  RETURNING user_id INTO v_inserted;

  RETURN v_inserted IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.matos_allow_master_recovery(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.matos_allow_master_recovery(text) TO service_role;
COMMIT;
