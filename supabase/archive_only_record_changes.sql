-- Assigning the verified owner changes metadata, not the published record.
-- Archive and increment checks apply only to record publication.
drop trigger archive_roger_record_before_update on public.roger_shared_record;
create trigger archive_roger_record_before_update
  before update of record, revision on public.roger_shared_record
  for each row execute function private.archive_roger_record();
