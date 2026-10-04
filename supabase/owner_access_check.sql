-- Reveal only whether the signed-in visitor owns Roger's record.
create function public.roger_can_edit()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.roger_shared_record
    where id = 'roger' and owner_uid = (select auth.uid())
  );
$$;
revoke all on function public.roger_can_edit() from public, anon, authenticated;
grant execute on function public.roger_can_edit() to authenticated;
