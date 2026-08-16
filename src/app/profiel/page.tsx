import { db, USER_ID } from "@/lib/db";
import DbError from "@/components/DbError";
import ProfileForm from "@/components/ProfileForm";
import { COGGAN_ZONES } from "@/lib/zones";

export const dynamic = "force-dynamic";

export default async function ProfielPage() {
  const { data: user, error } = await db()
    .from("users").select("ftp_watts, age, weight_kg, target_hours_per_week").eq("id", USER_ID).single();
  if (error) return <DbError message={error.message} />;

  const wkg = user.weight_kg ? user.ftp_watts / Number(user.weight_kg) : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Profiel</p>
        <h1 className="text-2xl font-bold">FTP, zones & profiel</h1>
      </div>

      <ProfileForm
        initialFtp={user.ftp_watts}
        initialAge={user.age}
        initialWeightKg={user.weight_kg !== null ? Number(user.weight_kg) : null}
        initialTargetHours={user.target_hours_per_week !== null ? Number(user.target_hours_per_week) : null}
      />

      {wkg !== null && (
        <div className="card p-4 max-w-sm">
          <p className="eyebrow">Vermogen per kilo</p>
          <p className="num text-2xl font-bold">{wkg.toFixed(2)} W/kg</p>
          <p className="text-xs text-muted mt-1">
            Een indicatie van je huidige trainingsniveau — geen maat voor aanleg, wel voor waar je nu staat.
            Wordt meegegeven aan de schemagenerator.
          </p>
        </div>
      )}

      <div className="card p-4 space-y-2 max-w-lg">
        <p className="eyebrow">Coggan-zones bij {user.ftp_watts} W FTP</p>
        <div className="space-y-1.5">
          {COGGAN_ZONES.map((z) => (
            <div key={z.key} className="grid grid-cols-[8rem_1fr] items-center gap-3 text-sm">
              <span className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: z.color }} />
                <span className="font-semibold uppercase text-xs">{z.key}</span>
                <span className="text-muted">{z.name}</span>
              </span>
              <span className="num">
                {Math.round((z.lowPct / 100) * user.ftp_watts)}
                {z.highPct === null ? "+" : `–${Math.round((z.highPct / 100) * user.ftp_watts)}`} W
                <span className="text-muted text-xs ml-1.5">
                  ({z.lowPct}{z.highPct === null ? "+" : `–${z.highPct}`}%)
                </span>
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted pt-1">
          Deze vermogens worden gebruikt bij het exporteren van trainingen als .fit-bestand.
        </p>
      </div>
    </div>
  );
}
