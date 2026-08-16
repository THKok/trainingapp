import { db, USER_ID } from "@/lib/db";
import DbError from "@/components/DbError";
import ProfileForm from "@/components/ProfileForm";
import { COGGAN_ZONES } from "@/lib/zones";
import { fetchSportSettings, fetchLatestWellness } from "@/lib/intervals-icu";

export const dynamic = "force-dynamic";

export default async function ProfielPage() {
  const [{ data: user, error }, sportSettings, wellness] = await Promise.all([
    db().from("users").select("age, target_hours_per_week").eq("id", USER_ID).single(),
    fetchSportSettings().catch(() => null),
    fetchLatestWellness().catch(() => null),
  ]);
  if (error) return <DbError message={error.message} />;

  const ftp = sportSettings?.ftp ?? null;
  const wkg = ftp && wellness?.weight ? ftp / wellness.weight : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Profiel</p>
        <h1 className="text-2xl font-bold">FTP, zones & profiel</h1>
      </div>

      <div className="card p-4 max-w-sm space-y-1">
        <p className="eyebrow">FTP & gewicht</p>
        {ftp === null ? (
          <p className="text-sm text-muted">
            Kon niet worden opgehaald van intervals.icu — controleer INTERVALS_ATHLETE_ID/INTERVALS_API_KEY.
          </p>
        ) : (
          <>
            <p className="num text-2xl font-bold">{ftp} W</p>
            {wkg !== null && (
              <p className="text-sm text-muted">
                {wkg.toFixed(2)} W/kg ({wellness!.weight} kg) — indicatie trainingsniveau, geen maat voor aanleg.
              </p>
            )}
            <p className="text-xs text-muted pt-1">
              Bron: intervals.icu. Wijzig FTP/gewicht daar — deze pagina leest het alleen uit.
            </p>
          </>
        )}
      </div>

      <ProfileForm initialAge={user.age} initialTargetHours={user.target_hours_per_week !== null ? Number(user.target_hours_per_week) : null} />

      {ftp !== null && (
        <div className="card p-4 space-y-2 max-w-lg">
          <p className="eyebrow">Coggan-zones bij {ftp} W FTP</p>
          <div className="space-y-1.5">
            {COGGAN_ZONES.map((z) => (
              <div key={z.key} className="grid grid-cols-[8rem_1fr] items-center gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: z.color }} />
                  <span className="font-semibold uppercase text-xs">{z.key}</span>
                  <span className="text-muted">{z.name}</span>
                </span>
                <span className="num">
                  {Math.round((z.lowPct / 100) * ftp)}
                  {z.highPct === null ? "+" : `–${Math.round((z.highPct / 100) * ftp)}`} W
                  <span className="text-muted text-xs ml-1.5">
                    ({z.lowPct}{z.highPct === null ? "+" : `–${z.highPct}`}%)
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted pt-1">
            Deze vermogens worden gebruikt bij het pushen van gegenereerde trainingen naar intervals.icu.
          </p>
        </div>
      )}
    </div>
  );
}
