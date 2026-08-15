export default function DbError({ message }: { message: string }) {
  return (
    <div className="card p-4 space-y-1">
      <p className="eyebrow">Databasefout</p>
      <p className="text-sm">{message}</p>
      <p className="text-xs text-muted">
        Controleer NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in Vercel
        (Settings → Environment Variables), en of daarna een Redeploy is gedaan.
      </p>
    </div>
  );
}
