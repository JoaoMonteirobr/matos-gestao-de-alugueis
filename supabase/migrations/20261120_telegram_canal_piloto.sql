-- Telegram piloto: canal facultativo e totalmente desligado por padrão.
-- Não modifica alertas existentes, contratos, cobranças ou impostos.
BEGIN;

CREATE TABLE IF NOT EXISTS public.telegram_vinculos (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  bot_username text NOT NULL,
  vinculado_em timestamptz NOT NULL DEFAULT now(),
  testado_em timestamptz,
  ultimo_teste_em timestamptz,
  ativo boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.telegram_pareamentos (
  code_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_pareamentos_user_idx
  ON public.telegram_pareamentos(user_id,expires_at);

CREATE TABLE IF NOT EXISTS public.telegram_fila (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alerta_id uuid NOT NULL REFERENCES public.alertas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  prioridade text NOT NULL DEFAULT 'media',
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','enviando','enviado','erro','descartado')),
  tentativas integer NOT NULL DEFAULT 0,
  ultimo_erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  processando_em timestamptz,
  proxima_tentativa_em timestamptz,
  UNIQUE(alerta_id,user_id)
);
CREATE INDEX IF NOT EXISTS telegram_fila_dispatch_idx
  ON public.telegram_fila(status,proxima_tentativa_em,created_at);

-- Somente Edge Functions com service_role podem ler e escrever vínculos/filas.
ALTER TABLE public.telegram_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_pareamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_vinculos,public.telegram_pareamentos,public.telegram_fila
  FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.telegram_vinculos,
  public.telegram_pareamentos,public.telegram_fila TO service_role;

-- Chave aleatória interna: usada por gatilho/cron, nunca pelo navegador.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='matos_telegram_dispatch_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32),'hex'),
      'matos_telegram_dispatch_secret',
      'Autenticação exclusiva das entregas Telegram da Casa Matos'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validar_chave_telegram_dispatch(p_chave text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=''
AS $$
  SELECT length(coalesce(p_chave,''))=64 AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name='matos_telegram_dispatch_secret' AND decrypted_secret=p_chave
  );
$$;
REVOKE ALL ON FUNCTION public.validar_chave_telegram_dispatch(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validar_chave_telegram_dispatch(text) TO service_role;

-- Cancela tentativas antigas/inválidas sem apagar a auditoria.
-- Lock evita dois envios simultâneos do mesmo item pela execução instantânea e pelo cron.
CREATE OR REPLACE FUNCTION public.claim_telegram_fila(p_limit integer DEFAULT 5)
RETURNS SETOF public.telegram_fila
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  UPDATE public.telegram_fila AS f
  SET status='descartado',processando_em=NULL,ultimo_erro='Alerta expirado, resolvido ou canal desativado'
  WHERE f.status IN ('pendente','enviando')
    AND (
      f.created_at < now()-interval '24 hours'
      OR NOT EXISTS (
        SELECT 1 FROM public.alertas a
        JOIN public.telegram_vinculos v ON v.user_id=f.user_id
        WHERE a.id=f.alerta_id AND a.tipo<>'login'
          AND NOT a.resolvido AND v.ativo
      )
    );
  RETURN QUERY
  WITH candidates AS (
    SELECT f.id
    FROM public.telegram_fila f
    JOIN public.telegram_vinculos v ON v.user_id=f.user_id
    JOIN public.alertas a ON a.id=f.alerta_id
    WHERE v.ativo AND a.tipo<>'login' AND NOT a.resolvido
      AND f.created_at >= now()-interval '24 hours'
      AND f.tentativas < 4
      AND COALESCE(f.proxima_tentativa_em,now()) <= now()
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

CREATE OR REPLACE FUNCTION public.enfileirar_telegram_alerta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF NEW.tipo='login' OR NEW.resolvido THEN RETURN NEW; END IF;
  INSERT INTO public.telegram_fila(alerta_id,user_id,titulo,prioridade)
  SELECT NEW.id,v.user_id,NEW.titulo,NEW.prioridade
  FROM public.telegram_vinculos v WHERE v.ativo
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
  -- Uma falha no Telegram nunca deve bloquear a criação de um alerta de gestão.
  RAISE WARNING 'telegram_trigger_failed: %', SQLSTATE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enfileirar_telegram_alerta() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_alertas_telegram_piloto ON public.alertas;
CREATE TRIGGER trg_alertas_telegram_piloto
AFTER INSERT ON public.alertas
FOR EACH ROW EXECUTE FUNCTION public.enfileirar_telegram_alerta();

-- Recuperação da fila: ativada como serviço, mas sem envio quando nenhum vínculo
-- estiver habilitado; não reenfileira alertas históricos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='matos_telegram_dispatch') THEN
    PERFORM cron.unschedule('matos_telegram_dispatch');
  END IF;
  PERFORM cron.schedule(
    'matos_telegram_dispatch','* * * * *',
    $job$
    SELECT net.http_post(
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
    )
    WHERE EXISTS(
      SELECT 1 FROM public.telegram_vinculos WHERE ativo=true
    );
    $job$
  );
END $$;
COMMIT;