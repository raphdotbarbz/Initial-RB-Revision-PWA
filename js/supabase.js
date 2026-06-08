import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

let supabaseClientPromise = null;
const normalizedUrl = `${SUPABASE_URL || ""}`.trim();
const normalizedAnonKey = `${SUPABASE_ANON_KEY || ""}`.trim();

function hasConfig() {
  return Boolean(normalizedUrl && normalizedAnonKey);
}

async function loadLibrary() {
  return import("https://esm.sh/@supabase/supabase-js@2.57.0");
}

export function getSupabaseAvailability() {
  if (!hasConfig()) {
    return { enabled: false, label: "Fill js/config.js first" };
  }
  if (!navigator.onLine) {
    return { enabled: false, label: "Cloud sync needs connection" };
  }
  return { enabled: true, label: "Cloud sync ready" };
}

export async function getSupabaseClient() {
  if (!hasConfig()) {
    throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js.");
  }

  if (!supabaseClientPromise) {
    supabaseClientPromise = loadLibrary().then(({ createClient }) =>
      createClient(normalizedUrl, normalizedAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "rb_supabase_auth"
        }
      })
    );
  }

  return supabaseClientPromise;
}

export async function getCloudSession() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function onCloudAuthStateChange(callback) {
  const supabase = await getSupabaseClient();
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function sendMagicLink(email) {
  const supabase = await getSupabaseClient();
  const redirectTo = window.location.origin + window.location.pathname + window.location.hash;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo
    }
  });
  if (error) {
    throw error;
  }
}

export async function signOutCloud() {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function ensureProfile(user) {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email || null,
    updated_at: new Date().toISOString()
  });
  if (error) {
    throw error;
  }
}

export async function fetchUserSnapshot(userId) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("user_snapshots")
    .select("progress, settings, synced_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function saveUserSnapshot(userId, { progress, settings }) {
  const supabase = await getSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("user_snapshots").upsert({
    user_id: userId,
    progress,
    settings,
    synced_at: now,
    updated_at: now
  });
  if (error) {
    throw error;
  }
}
