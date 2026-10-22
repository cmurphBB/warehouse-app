import { createClient } from "@supabase/supabase-js";

// Public values (safe in the browser). Data access goes through the
// `inventory` function, which checks the signed-in user's role.
export const SUPABASE_URL = "https://sxyeasllycwzioskvswn.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KWzHyglRxNon5ujc9XTecA_bMa7Ta6q";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
