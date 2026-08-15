import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Testversie zonder auth: alles draait onder één vaste gebruiker.
export const USER_ID = "00000000-0000-0000-0000-000000000001";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY ontbreken — vul .env.local (zie .env.example)."
      );
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateIso: string, n: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
