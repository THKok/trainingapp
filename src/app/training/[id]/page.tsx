import { notFound } from "next/navigation";
import { db, USER_ID } from "@/lib/db";
import ZoneBars from "@/components/ZoneBars";
import RpeForm from "@/components/RpeForm";

export const dynamic = "force-dynamic";

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")} u` : `${m} min`;
}

export default async function TrainingPage({ params }: { params: { id: string } }) {
  const s = db();
  const [{ data: session }, { data: user }] = await Promise.all([
    s.from("training_sessions")
      .select("id, date, duration_sec, avg_power, normalized_power, intensity_factor, tss, zone_seconds, filename, rpe_logs(rpe, notes)")
      .eq("id", params.id).eq("user_id", USER_ID).maybeSingle(),
    s.from("users").select("ftp_watts").eq("id", USER_ID).single(),
  ]);
  if (!session || !user) notFound();

  const rpe = (session as any).rpe_logs as { rpe: number; notes: string | null } | null;
  const srpeLoad = rpe ? Math.round((session.duration_sec / 60) * rpe.rpe) : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Training · {session.date}</p>
        <h1 className="text-2xl font-bold">{session.filename ?? "Gereden training"}</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Duur" value={fmtDuration(session.duration_sec)} />
        <Stat label="Gem. vermogen" value={session.avg_power !== null ? `${session.avg_power} W` : "–"} />
        <Stat label="NP" value={session.normalized_power !== null ? `${session.normalized_power} W` : "–"} />
        <Stat label="IF" value={session.intensity_factor !== null ? String(session.intensity_factor) : "–"} />
        <Stat label="TSS" value={session.tss !== null ? String(Math.round(Number(session.tss))) : "–"} />
        <Stat label="sRPE-load" value={srpeLoad !== null ? String(srpeLoad) : "nog geen RPE"} />
      </div>

      <div className="card p-4 space-y-3">
        <p className="eyebrow">Tijd per zone (FTP {user.ftp_watts} W)</p>
        <ZoneBars zoneSeconds={session.zone_seconds ?? {}} ftp={user.ftp_watts} />
      </div>

      <RpeForm sessionId={session.id} initialRpe={rpe?.rpe ?? null} initialNotes={rpe?.notes ?? null} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <p className="eyebrow">{label}</p>
      <p className="num text-xl font-bold mt-1">{value}</p>
    </div>
  );
}
