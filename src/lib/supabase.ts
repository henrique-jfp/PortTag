import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const appName =
  typeof document === "undefined"
    ? "admin"
    : document.documentElement.dataset.app ?? "admin";

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local"
  );
}
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    ...(appName === "admin" ? {} : { storageKey: `encomenda-${appName}-auth` }),
  },
});
