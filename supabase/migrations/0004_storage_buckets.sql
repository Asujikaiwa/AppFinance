-- ============================================================================
-- Storage buckets + RLS for receipt attachments and generated reports.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('reports', 'reports', false, 52428800, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Receipts bucket: object key format = "<workspace_id>/<entry_id_or_uuid>/<filename>"
-- ----------------------------------------------------------------------------
create policy "members read own workspace receipts"
  on storage.objects for select
  using (
    bucket_id = 'receipts'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy "writers upload receipts"
  on storage.objects for insert
  with check (
    bucket_id = 'receipts'
    and public.workspace_role((storage.foldername(name))[1]::uuid) in ('owner', 'accountant')
  );

create policy "writers delete receipts"
  on storage.objects for delete
  using (
    bucket_id = 'receipts'
    and public.workspace_role((storage.foldername(name))[1]::uuid) in ('owner', 'accountant')
  );

-- ----------------------------------------------------------------------------
-- Reports bucket: same workspace-scoped pattern
-- ----------------------------------------------------------------------------
create policy "members read own workspace reports"
  on storage.objects for select
  using (
    bucket_id = 'reports'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy "writers upload reports"
  on storage.objects for insert
  with check (
    bucket_id = 'reports'
    and public.workspace_role((storage.foldername(name))[1]::uuid) in ('owner', 'accountant')
  );
