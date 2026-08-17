import Link from "next/link";
import WorkoutBuilder from "@/components/WorkoutBuilder";

export const dynamic = "force-dynamic";

export default function WorkoutBuilderPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/bibliotheek" className="text-sm text-muted hover:text-ink">&larr; Bibliotheek</Link>
        <h1 className="text-2xl font-bold mt-1">Eigen training bouwen</h1>
        <p className="text-sm text-muted mt-1">
          Stel je eigen blokken samen en sla ze op in de bibliotheek — daarna kun je 'm gewoon
          gebruiken als geplande, handmatige of shuffle-training, net als de standaardtemplates.
        </p>
      </div>
      <WorkoutBuilder />
    </div>
  );
}
