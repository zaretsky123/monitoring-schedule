import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const adminId = "5913bab3-0a64-401e-9c8a-fe0b5ef21eeb";
const allowedOrigin = "https://zaretsky123.github.io";

function headers() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

Deno.serve(async (request: Request) => {
  const responseHeaders = headers();
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: responseHeaders });
  if (request.headers.get("origin") && request.headers.get("origin") !== allowedOrigin) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: responseHeaders });
  }

  let credentials: { login?: unknown; password?: unknown };
  try {
    credentials = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: responseHeaders });
  }
  if (credentials.login !== "admin" || typeof credentials.password !== "string" || credentials.password.length > 1024) {
    return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: responseHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) {
    return new Response(JSON.stringify({ error: "Authentication unavailable" }), { status: 503, headers: responseHeaders });
  }

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: admin, error: adminError } = await adminClient.auth.admin.getUserById(adminId);
  if (adminError || !admin.user?.email) {
    return new Response(JSON.stringify({ error: "Authentication unavailable" }), { status: 503, headers: responseHeaders });
  }

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await authClient.auth.signInWithPassword({ email: admin.user.email, password: credentials.password });
  if (error || !data.session || data.user?.id !== adminId) {
    return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: responseHeaders });
  }

  return new Response(JSON.stringify({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }), { status: 200, headers: responseHeaders });
});
