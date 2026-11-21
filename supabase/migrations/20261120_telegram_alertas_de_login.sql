-- Alertas de login no Telegram: opt-in por administrador, sem reenvio histórico.
-- A única conta Telegram já ativa solicitou avisos de acesso; novos vínculos
-- permanecem com a preferência desativada por padrão.
BEGIN;
ALTER TABLE public.telegram_vinculos
  ADD COLUMN IF NOT EXISTS notificar_logins boolean NOT NULL DEFAULT false;

UPDATE public.telegram_vinculos
SET notificar_logins=true,updated_at=now()
WHERE ativo=true AND notificar_logins=false;

-- Inclui novos logins apenas no canal explicitamente habilitado.
CREATE OR REPLACE FUNCTION public.enfileirar_telegram_alerta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF NEW.resolvido THEN RETURN NEW; END IF;
  INSERT INTO public.telegram_fila(alerta_id,user_id,titulo,prioridade)
  SELECT NEW.id,v.user_id,NEW.titulo,NEW.prioridade
  FROM public.telegram_vinculos v
  WHERE v.ativo AND (NEW.tipo<>'login' OR v.notificar_logins)
  ON CONFLICT(alerta_id,user_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  IF v_inserted > 0 AND EXISTS(
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name='matos_telegram_dispatch_secret'
  ) THEN
    PERFORM net.http_post(
      url:='https://behmmbgbrsesxthsczdl.supabase.co/functions/v1/telegram-channel',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-matos-telegram-secret',(
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name='matos_telegram_dispatch_secret' LIMIT 1
        )
      ),
      body:='{"action":"dispatch"}'::jsonb,
      timeout_milliseconds:=5000
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'telegram_trigger_failed: %',SQLSTATE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enfileirar_telegram_alerta() FROM PUBLIC,anon,authenticated;

-- Corrige a política de resgate da fila e evita repetição/backlog de logins.
CREATE OR REPLACE FUNCTION public.claim_telegram_fila(p_limit integer DEFAULT 5)
RETURNS SETOF public.telegram_fila
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  UPDATE public.telegram_fila AS f
  SET status='descartado',processando_em=NULL,
      ultimo_erro='Alerta expirado, resolvido ou canal desativado'
  WHERE f.status IN ('pendente','enviando')
    AND (
      f.created_at < now()-interval '24 hours'
      OR NOT EXISTS (
        SELECT 1 FROM public.alertas a
        JOIN public.telegram_vinculos v ON v.user_id=f.user_id
        WHERE a.id=f.alerta_id AND NOT a.resolvido AND v.ativo
          AND (a.tipo<>'login' OR v.notificar_logins)
      )
    );
  RETURN QUERY
  WITH candidates AS (
    SELECT f.id
    FROM public.telegram_fila f
    JOIN public.telegram_vinculos v ON v.user_id=f.user_id
    JOIN public.alertas a ON a.id=f.alerta_id
    WHERE v.ativo AND NOT a.resolvido
      AND (a.tipo<>'login' OR v.notificar_logins)
      AND f.created_at >= now()-interval '24 hours'
      AND f.tentativas < 4
      AND COALESCE(f.proxima_tentativa_em,now())<=now()
      AND (
        f.status='pendente'
        OR (f.status='enviando' AND f.processando_em < now()-interval '10 minutes')
      )
    ORDER BY CASE f.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END,
      f.created_at
    FOR UPDATE OF f SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit,5),1),5)
  )
  UPDATE public.telegram_fila f
  SET status='enviando',tentativas=f.tentativas+1,processando_em=now()
  FROM candidates WHERE f.id=candidates.id
  RETURNING f.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_telegram_fila(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telegram_fila(integer) TO service_role;
COMMIT;