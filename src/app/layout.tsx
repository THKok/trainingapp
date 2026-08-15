import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trainingsapp",
  description: "Wekelijks trainingsschema op basis van load, beschikbaarheid en RPE",
};

const nav = [
  { href: "/", label: "Komende week" },
  { href: "/kalender", label: "Kalender" },
  { href: "/bibliotheek", label: "Bibliotheek" },
  { href: "/profiel", label: "Profiel" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body className="min-h-screen antialiased">
        <header className="bg-white border-b border-line">
          <div className="mx-auto max-w-5xl px-4 h-14 flex items-center gap-8">
            <span className="eyebrow !text-ink">Trainingsapp</span>
            <nav className="flex gap-5 text-sm">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="text-muted hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="zone-band" aria-hidden />
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
