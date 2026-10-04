-- Install before deploying the app's per-entry sync. Existing archive trigger
-- continues to retain the previous revision for every successful update.
create or replace function public.roger_apply_patches(p_changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_record jsonb;
  current_revision bigint;
  current_updated_at timestamptz;
  next_record jsonb;
  change jsonb;
  key text;
  item_id text;
  old_value jsonb;
  new_value jsonb;
  rows jsonb;
  current_value jsonb;
  position integer;
  row_item jsonb;
  changed boolean := false;
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 100 then
    raise exception 'Invalid change list' using errcode = '22023';
  end if;
  select record, revision, updated_at into current_record, current_revision, current_updated_at
    from public.roger_shared_record where id = 'roger' for update;
  if not found then raise exception 'Owner access required' using errcode = '42501'; end if;
  if current_revision = 0 then raise exception 'Publish the first record before editing' using errcode = '22023'; end if;
  next_record := current_record;
  for change in select value from jsonb_array_elements(p_changes) loop
    key := change->>'key';
    if jsonb_typeof(change) <> 'object' or not change ? 'before' or not change ? 'after' then
      raise exception 'Invalid change' using errcode = '22023';
    end if;
    old_value := change->'before'; new_value := change->'after';
    if key in ('carePlan','profile','journalCoverageThrough','schemaVersion') then
      current_value := coalesce(next_record->key, 'null'::jsonb);
      if current_value = new_value then continue; end if;
      if key = 'journalCoverageThrough' then
        if current_value <> 'null'::jsonb and (new_value = 'null'::jsonb or current_value #>> '{}' > new_value #>> '{}') then continue; end if;
      elsif key = 'schemaVersion' then
        if current_value <> 'null'::jsonb and (current_value #>> '{}')::integer >= (new_value #>> '{}')::integer then continue; end if;
      else
      if current_value <> old_value then raise exception 'Changed online: %', key using errcode = '40001'; end if;
      end if;
      next_record := jsonb_set(next_record,array[key],new_value,true);
    elsif key in ('observations','qualityOfLife','costs','treatments','labs',
                  'importHistory','medicationAdministrations','medications',
                  'medicationCourses','medicationPurchases','recordCorrections') then
      item_id := change->>'id';
      if item_id is null or length(item_id) > 200 or length(item_id) = 0 then
        raise exception 'Missing item ID' using errcode = '22023';
      end if;
      rows := coalesce(next_record->key,'[]'::jsonb);
      if jsonb_typeof(rows) <> 'array' then raise exception 'Invalid collection' using errcode = '22023'; end if;
      position := null; current_value := 'null'::jsonb;
      for row_item, position in select value, ordinality::integer - 1
        from jsonb_array_elements(rows) with ordinality
        where case when key = 'labs' then coalesce(value->>'id',(value->>'date')||'|'||(value->>'metric'))
                   when key = 'recordCorrections' then coalesce(value->>'changeId',(value->>'collection')||'|'||(value->>'id')||'|'||(value->>'at'))
                   when key = 'importHistory' then value->>'key'
                   else value->>'id' end = item_id limit 1
      loop current_value := row_item; exit; end loop;
      if current_value = new_value then continue; end if;
      if current_value <> old_value then raise exception 'Entry changed online: %', item_id using errcode = '40001'; end if;
      if new_value = 'null'::jsonb then
        if position is not null then rows := rows - position; end if;
      else
        if jsonb_typeof(new_value) <> 'object' then raise exception 'Invalid entry' using errcode = '22023'; end if;
        if key not in ('recordCorrections','importHistory') and
          (case when key = 'labs' then coalesce(new_value->>'id',(new_value->>'date')||'|'||(new_value->>'metric'))
                else new_value->>'id' end) is distinct from item_id then
          raise exception 'Entry ID mismatch' using errcode = '22023';
        end if;
        if position is null then rows := rows || jsonb_build_array(new_value);
        else rows := jsonb_set(rows,array[position::text],new_value); end if;
      end if;
      next_record := jsonb_set(next_record,array[key],rows,true);
    else raise exception 'Unsupported change: %', key using errcode = '22023'; end if;
    changed := true;
  end loop;
  if changed then
    next_record := jsonb_set(next_record,'{_savedAt}',to_jsonb(clock_timestamp()::text),true);
    update public.roger_shared_record set record = next_record, revision = current_revision + 1
      where id = 'roger' returning record, revision, updated_at
      into current_record, current_revision, current_updated_at;
    if not found then raise exception 'Owner access required' using errcode = '42501'; end if;
  end if;
  return jsonb_build_object('record',current_record,'revision',current_revision,'updated_at',current_updated_at);
end;
$$;
revoke all on function public.roger_apply_patches(jsonb) from public, anon, authenticated;
grant execute on function public.roger_apply_patches(jsonb) to authenticated;
