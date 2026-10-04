-- Roger Care public read / owner write record. Apply to the dedicated Roger Care project.
-- The owner_uid is assigned after the owner has signed in and been verified.
create table public.roger_shared_record (
  id text primary key default 'roger' check (id = 'roger'),
  owner_uid uuid references auth.users(id),
  record jsonb not null default '{}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

alter table public.roger_shared_record enable row level security;
revoke all on public.roger_shared_record from anon, authenticated;
grant select (id, record, revision, updated_at) on public.roger_shared_record to anon, authenticated;
grant update (record, revision) on public.roger_shared_record to authenticated;

create policy "Anyone can view Roger's published record"
  on public.roger_shared_record for select to anon, authenticated
  using (id = 'roger');
create policy "Only Roger's owner can edit"
  on public.roger_shared_record for update to authenticated
  using (owner_uid = (select auth.uid()) and id = 'roger')
  with check (owner_uid = (select auth.uid()) and id = 'roger');

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.roger_record_history (
  archived_at timestamptz not null default now(),
  revision bigint not null,
  record jsonb not null
);
alter table private.roger_record_history enable row level security;
revoke all on private.roger_record_history from public, anon, authenticated;

create function private.archive_roger_record()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'Revision must increase by one';
  end if;
  insert into private.roger_record_history(revision, record)
    values (old.revision, old.record);
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.archive_roger_record() from public, anon, authenticated;
create trigger archive_roger_record_before_update
  before update on public.roger_shared_record
  for each row execute function private.archive_roger_record();

insert into public.roger_shared_record (id) values ('roger');
