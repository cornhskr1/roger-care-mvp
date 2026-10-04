import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const origin = 'https://cornhskr1.github.io';
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const bearer = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
  if (!bearer) return reply(401, { error: 'Owner sign-in required' });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return reply(503, { error: 'Sign-in transfer unavailable' });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await admin.auth.getUser(bearer[1]);
  if (userError || !user?.email) return reply(401, { error: 'Owner sign-in expired' });
  const ownerClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  });
  const { data: canEdit, error: accessError } = await ownerClient.rpc('roger_can_edit');
  if (accessError) return reply(503, { error: 'Could not check owner access' });
  if (canEdit !== true) return reply(403, { error: 'Owner access required' });

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const token_hash = data?.properties?.hashed_token;
  if (error || !token_hash) return reply(503, { error: 'Could not create sign-in. Try again shortly.' });
  return reply(200, { kind: 'roger-owner-pair-v1', token_hash, type: 'magiclink' });
});
