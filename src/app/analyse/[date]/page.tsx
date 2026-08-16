import Link from "next/link";
import AnalyseDetail from "@/components/AnalyseDetail";

export const dynamic = "force-dynamic";

export default function AnalyseDetailPage({ params }: { params: { date: string } }) {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/analyse" className="text-sm text-muted hover:text-ink">&larr; Alle ritten</Link>
        <h1 className="text-2xl font-bold mt-1">
          {new Date(params.date + "T00:00:00Z").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
        </h1>
      </div>
      <AnalyseDetail date={params.date} />
    </div>
  );
}
