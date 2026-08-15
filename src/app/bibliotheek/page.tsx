import { db } from "@/lib/db";
import { TEMPLATE_ZONE_COLORS } from "@/lib/zones";
import DbError from "@/components/DbError";

export const dynamic = "force-dynamic";

const ZONE_ORDER = ["herstel", "duur", "tempo", "sweetspot", "drempel", "vo2max", "anaeroob", "neuromusculair"];
const ZONE_LABELS: Record<string, string> = {
  herstel: "Herstel (Z1)", duur: "Duur (Z2)", tempo: "Tempo (Z3)", sweetspot: "Sweetspot",
  drempel: "Drempel (Z4)", vo2max: "VO2max (Z5)", anaeroob: "Anaeroob (Z6)", neuromusculair: "Neuromusculair (Z7)",
};

interface Block { reps: number; on_sec: number; on_pct: number; off_sec: number; off_pct: number; pattern?: string }
interface Structure {
  warmup_min: number; blocks: Block[]; series?: number;
  between_blocks_rest_min: number; cooldown_min: number;
}

function fmtSec(sec: number): string {
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60} min`;
  return `${sec} s`;
}

function blockText(st: Structure): string {
  const parts: string[] = [];
  if (st.warmup_min > 0) parts.push(`${st.warmup_min} min inrijden`);
  for (const b of st.blocks) {
    if (b.pattern) {
      parts.push(`${b.reps > 1 && !st.series ? `${b.reps}× ` : ""}${b.pattern}`);
    } else if (b.off_sec > 0) {
      const rep = `${b.reps}× (${fmtSec(b.on_sec)} @ ${b.on_pct}% / ${fmtSec(b.off_sec)} @ ${b.off_pct}%)`;
      parts.push(st.series ? `${st.series} series van ${rep}` : rep);
    } else if (b.reps > 1) {
      parts.push(`${b.reps}× ${fmtSec(b.on_sec)} @ ${b.on_pct}% FTP`);
    } else {
      parts.push(`${fmtSec(b.on_sec)} @ ${b.on_pct}% FTP`);
    }
  }
  if (st.between_blocks_rest_min > 0) parts.push(`${st.between_blocks_rest_min} min rust tussen blokken`);
  if (st.cooldown_min > 0) parts.push(`${st.cooldown_min} min uitrijden`);
  return parts.join(" · ");
}

export default async function BibliotheekPage() {
  const { data: templates, error } = await db()
    .from("workout_templates")
    .select("id, name, zone, description, base_duration_min, structure")
    .order("base_duration_min");

  if (error) return <DbError message={error.message} />;

  const grouped = ZONE_ORDER.map((zone) => ({
    zone,
    items: (templates ?? []).filter((t) => t.zone === zone),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Bibliotheek</p>
        <h1 className="text-2xl font-bold">Workout-templates</h1>
        <p className="text-sm text-muted mt-2 max-w-2xl">
          Duur wordt uitsluitend geschaald door zone 2 vóór of ná de intensieve blokken toe te voegen;
          de rust tussen blokken blijft altijd gelijk.
        </p>
      </div>

      {grouped.map((g) => (
        <section key={g.zone} className="space-y-3">
          <h2 className="eyebrow !text-ink flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: TEMPLATE_ZONE_COLORS[g.zone] }} />
            {ZONE_LABELS[g.zone]}
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {g.items.map((t) => (
              <div key={t.id} className="card flex overflow-hidden">
                <div className="w-1.5 shrink-0" style={{ background: TEMPLATE_ZONE_COLORS[t.zone] }} />
                <div className="p-4 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-semibold">{t.name}</h3>
                    <span className="num text-sm text-muted shrink-0">{t.base_duration_min} min</span>
                  </div>
                  {t.description && <p className="text-sm text-muted">{t.description}</p>}
                  <p className="text-xs text-muted">{blockText(t.structure as unknown as Structure)}</p>
                  <a
                    href={`/api/export/${t.id}`}
                    className="inline-block text-xs font-medium text-ink underline underline-offset-2 hover:no-underline"
                  >
                    Exporteren (.fit)
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
