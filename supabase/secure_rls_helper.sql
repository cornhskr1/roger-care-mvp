-- Supabase's automatic-RLS event trigger should not be directly callable
-- through the public Data API. The event trigger itself remains installed.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
