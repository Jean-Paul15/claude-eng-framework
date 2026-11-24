-- Socle de conformité — modèle PostgreSQL (Supabase compatible).
-- ATTENTION : modèle NON EXÉCUTÉ dans le framework. À adapter à la pile (noms de tables, schéma d'authentification),
-- puis à TESTER sur une base vierge (supabase start && supabase db reset) avant tout usage. Suppose une table users(id uuid primary key).
-- Mécanismes : C-01 politiques · C-02 consentements · C-04 conservation · C-06 audit · C-07 alertes · C-08 incidents.

-- ===== C-01 Politiques versionnées et ré-acceptation ==========================================================
create table legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms', 'privacy', 'cookies')),
  version text not null,
  locale text not null,
  content_sha256 text not null,
  summary_of_changes text not null,
  requires_reacceptance boolean not null,
  published_at timestamptz not null default now(),
  unique (kind, version, locale)
);
create table legal_acceptances (
  user_id uuid not null references users(id) on delete cascade,
  document_id uuid not null references legal_documents(id),
  accepted_at timestamptz not null default now(),
  method text not null,                      -- 'signup_checkbox' | 'reacceptance_screen'
  primary key (user_id, document_id)
);
-- Un texte publié ne se modifie pas : nouvelle version = nouvelle ligne.
create function legal_documents_immutable() returns trigger language plpgsql as $$
begin raise exception 'legal_documents est en ajout seul'; end $$;
create trigger legal_documents_no_update before update or delete on legal_documents
  for each row execute function legal_documents_immutable();

-- Vrai si une version EXIGEANT la ré-acceptation a été publiée après la dernière version acceptée de son type
-- (ou si l'utilisateur n'a jamais accepté ce type). Les changements mineurs (requires_reacceptance = false) n'en déclenchent pas.
create function needs_reacceptance(p_user uuid, p_locale text default 'fr') returns boolean
language sql stable as $$
  select exists (
    select 1 from legal_documents d
    where d.locale = p_locale and d.kind in ('terms', 'privacy') and d.requires_reacceptance
      and d.published_at > coalesce(
        (select max(l.published_at) from legal_acceptances a join legal_documents l on l.id = a.document_id
         where a.user_id = p_user and l.kind = d.kind and l.locale = p_locale),
        '-infinity'::timestamptz)
  );
$$;

-- ===== C-02 Consentements par finalité (ajout seul : l'état courant est la dernière ligne) =====================
create table consents (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('analytics', 'marketing_email', 'ads', 'third_party_sharing')),
  granted boolean not null,
  at timestamptz not null default now(),
  source text not null                      -- 'banner' | 'settings' | 'signup'
);
create index consents_user_purpose_at on consents (user_id, purpose, at desc);

-- ===== C-06 Journal d'audit en ajout seul ==========================================================================
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role text not null,                 -- 'user' | 'admin' | 'service' | 'system'
  action text not null,                     -- 'read' | 'create' | 'update' | 'delete' | 'export' | 'login' | 'role_change'
  entity text not null,
  entity_id text,
  subject_user_id uuid,                     -- la personne dont la donnée est touchée
  request_id text,
  ip inet,
  reason text                               -- motif obligatoire pour la lecture de données sensibles
);
create index audit_log_subject_at on audit_log (subject_user_id, at);
create index audit_log_actor_at on audit_log (actor_id, at);
-- Aucun rôle applicatif ne peut modifier ni effacer le journal (adapter les noms de rôles à la pile).
revoke update, delete, truncate on audit_log from public;

-- ===== C-04 Conservation et nettoyage automatique ==================================================================
create table retention_rules (
  id text primary key,                      -- 'sessions_expired' | 'accounts_deleted' | 'audit_12m' …
  target_table text not null,
  condition_sql text not null,              -- ex. 'deleted_at < now() - interval ''30 days'''
  action text not null check (action in ('delete', 'anonymize')),
  anonymize_set_sql text,                   -- pour 'anonymize' : ex. 'email = null, name = ''supprimé'''
  legal_reason text not null,               -- base de la durée ; pièces à conserver par la loi : ne pas créer de règle
  batch_size integer not null default 5000,
  enabled boolean not null default true
);
create table retention_runs (
  id bigserial primary key,
  rule_id text not null references retention_rules(id),
  started_at timestamptz not null default now(),
  rows_affected integer not null,
  ok boolean not null,
  error text
);

-- Applique une règle par lots bornés (ne verrouille jamais une table entière). Les noms de table et de condition viennent
-- de retention_rules, écrite par les migrations : jamais d'une entrée utilisateur.
create function run_retention_rule(p_rule text) returns integer language plpgsql as $$
declare r retention_rules; n integer := 0; batch integer;
begin
  select * into r from retention_rules where id = p_rule and enabled;
  if not found then return 0; end if;
  begin
    loop
      if r.action = 'delete' then
        execute format('delete from %I where ctid in (select ctid from %I where %s limit %s)', r.target_table, r.target_table, r.condition_sql, r.batch_size);
      else
        execute format('update %I set %s where ctid in (select ctid from %I where %s limit %s)', r.target_table, r.anonymize_set_sql, r.target_table, r.condition_sql, r.batch_size);
      end if;
      get diagnostics batch = row_count;
      n := n + batch;
      exit when batch < r.batch_size;
    end loop;
    insert into retention_runs (rule_id, rows_affected, ok) values (p_rule, n, true);
  exception when others then
    insert into retention_runs (rule_id, rows_affected, ok, error) values (p_rule, n, false, sqlerrm);
  end;
  return n;
end $$;
-- Planification (pg_cron sur Supabase) : select cron.schedule('retention-daily', '15 3 * * *', $$select run_retention_rule(id) from retention_rules where enabled$$);

-- ===== C-07 Alertes de sécurité et seuils en données ===============================================================
create table security_thresholds (
  signal text primary key,                  -- 'mass_read' | 'login_failures' | 'access_denied' | 'mass_export' | 'mass_delete'
  window_minutes integer not null,
  threshold integer not null
);
insert into security_thresholds values ('mass_read', 60, 200), ('login_failures', 10, 10), ('access_denied', 10, 20), ('mass_export', 60, 3);
create table security_alerts (
  id bigserial primary key,
  at timestamptz not null default now(),
  signal text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  actor_id uuid,
  details jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'acknowledged', 'closed'))
);
-- Signal « lecture massive » : un acteur non système lit les données de plus de N personnes distinctes dans la fenêtre.
create function detect_mass_read() returns integer language plpgsql as $$
declare t security_thresholds; n integer := 0; rec record;
begin
  select * into t from security_thresholds where signal = 'mass_read';
  for rec in
    select actor_id, count(distinct subject_user_id) as people
    from audit_log
    where action = 'read' and at > now() - make_interval(mins => t.window_minutes) and actor_role <> 'system'
    group by actor_id having count(distinct subject_user_id) > t.threshold
  loop
    insert into security_alerts (signal, severity, actor_id, details) values ('mass_read', 'critical', rec.actor_id, jsonb_build_object('people', rec.people));
    n := n + 1;
  end loop;
  return n;
end $$;
-- Les autres signaux suivent le même modèle (une fonction par signal, planifiée toutes les 5 minutes).

-- ===== C-08 Incidents : qui est touché ? =========================================================================
create table security_incidents (
  id bigserial primary key,
  detected_at timestamptz not null default now(),
  description text not null,
  scope jsonb not null default '{}',
  affected_count integer,
  notified_authority_at timestamptz,        -- 72 h après la connaissance de la violation (RGPD 33)
  notified_subjects_at timestamptz,
  closed_at timestamptz
);
-- Personnes touchées par un acteur sur une période (base de la notification) ; à compléter par la carte des données (C-03).
create function affected_subjects(p_actor uuid, p_from timestamptz, p_to timestamptz)
returns table (subject_user_id uuid, first_at timestamptz, last_at timestamptz, actions text[])
language sql stable as $$
  select a.subject_user_id, min(a.at), max(a.at), array_agg(distinct a.action)
  from audit_log a
  where a.actor_id = p_actor and a.at between p_from and p_to and a.subject_user_id is not null
  group by a.subject_user_id;
$$;
