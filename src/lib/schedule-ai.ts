// AI-laag: losse, vervangbare module. Model, prompt en schema-validatie op één plek.
// Input: gestructureerde JSON. Output: afgedwongen via tool use (vast JSON-schema),
// nooit vrije tekst parsen. Elke response wordt gelogd in ai_logs.

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import type { ProposedItem } from "./load";

const TOOL_NAME = "stel_weekschema_voor";

export interface ScheduleAiInput {
  week_start: string; // maandag, ISO-datum
  goal: { event: string | null; date: string | null; ftp_watts: number };
  availability: Array<{ date: string; available_hours: number }>;
  metrics: {
    acwr: number | null;
    ctl: number | null;
    atl: number | null;
    tsb: number | null;
    chronic_weekly_load: number;
    history_days: number;
    last_14_days: Array<{ date: string; srpe_load: number }>;
  };
  recent_sessions: Array<{ date: string; duration_min: number; tss: number | null; rpe: number | null }>;
  templates: Array<{ id: string; name: string; zone: string; base_duration_min: number; description: string | null }>;
}

export interface ScheduleAiResult {
  items: ProposedItem[];
  rationale: string;
  model: string;
  raw: unknown;
}

const toolSchema = {
  name: TOOL_NAME,
  description:
    "Stel het weekschema voor als lijst van sessies. Gebruik uitsluitend template-ID's uit de meegegeven bibliotheek. " +
    "Duur aanpassen kan alleen via scale_minutes: dat is zone-2-tijd die vóór of na de intensieve blokken wordt toegevoegd " +
    "(of ingekort bij negatieve waarde). De rust tussen blokken verandert nooit.",
  input_schema: {
    type: "object" as const,
    properties: {
      sessions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "ISO-datum binnen de gevraagde week" },
            template_id: { type: "string" },
            scale_minutes: { type: "integer", minimum: -30, maximum: 90 },
            reason: { type: "string", description: "Korte reden voor deze keuze, in het Nederlands" },
          },
          required: ["date", "template_id", "scale_minutes"],
        },
      },
      rationale: { type: "string", description: "Korte toelichting op het weekplan als geheel, in het Nederlands" },
    },
    required: ["sessions", "rationale"],
  },
};

export async function proposeWeekSchedule(input: ScheduleAiInput): Promise<ScheduleAiResult> {
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("ANTHROPIC_MODEL ontbreekt in .env.local");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system =
    "Je bent de planningsmodule van een wielren-trainingsapp (power-based, Coggan-zones). " +
    "Je krijgt berekende belastingsmetrics, beschikbaarheid per dag en een vaste workout-bibliotheek als JSON. " +
    "Stel een weekschema voor dat binnen de beschikbare uren per dag past, polariseer verstandig " +
    "(niet elke dag intensief), en respecteer signalen van vermoeidheid (lage TSB, hoge ACWR). " +
    "Let op metrics.history_days: dit is het aantal dagen sinds de eerste ooit gelogde sessie. " +
    "Bij een lage waarde (bijvoorbeeld onder de 21) zijn ACWR/CTL/ATL/TSB nog onbetrouwbaar door een " +
    "cold-start-effect (te weinig trainingsgeschiedenis) en mogen ze niet als hard signaal voor een hele " +
    "week rust dienen — baseer je advies dan vooral op recent_sessions en de laatst ingevulde RPE's, en " +
    "plan na een zware belasting hooguit 1-2 lichte hersteldagen voordat je normale opbouw hervat. " +
    "Een aparte deterministische laag handhaaft de harde grenzen; jouw voorstel wordt daar zo nodig gecapt. " +
    `Antwoord uitsluitend via de tool ${TOOL_NAME}.`;

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: JSON.stringify(input) }],
    tools: [toolSchema],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME
  );
  if (!toolUse) throw new Error("AI-response bevat geen tool-output");

  const parsed = validateScheduleOutput(toolUse.input, input);

  // Loggen — traceerbaarheid en drift-monitoring
  await db().from("ai_logs").insert({
    model,
    request: input as unknown as Record<string, unknown>,
    response: { content: response.content, usage: response.usage } as unknown as Record<string, unknown>,
  });

  return { items: parsed.sessions, rationale: parsed.rationale, model, raw: toolUse.input };
}

/** Schema-validatie: alleen bekende templates, datums binnen de week, scale binnen bereik. */
function validateScheduleOutput(
  raw: unknown,
  input: ScheduleAiInput
): { sessions: ProposedItem[]; rationale: string } {
  if (typeof raw !== "object" || raw === null) throw new Error("AI-output is geen object");
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.sessions)) throw new Error("AI-output mist 'sessions'");

  const validIds = new Set(input.templates.map((t) => t.id));
  const weekDates = new Set(
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(input.week_start + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    })
  );

  const sessions: ProposedItem[] = [];
  for (const s of o.sessions) {
    if (typeof s !== "object" || s === null) continue;
    const it = s as Record<string, unknown>;
    if (typeof it.date !== "string" || !weekDates.has(it.date)) continue;
    if (typeof it.template_id !== "string" || !validIds.has(it.template_id)) continue;
    const scale =
      typeof it.scale_minutes === "number" && Number.isFinite(it.scale_minutes)
        ? Math.max(-30, Math.min(90, Math.round(it.scale_minutes)))
        : 0;
    sessions.push({
      date: it.date,
      template_id: it.template_id,
      scale_minutes: scale,
      reason: typeof it.reason === "string" ? it.reason : undefined,
    });
  }

  return {
    sessions,
    rationale: typeof o.rationale === "string" ? o.rationale : "",
  };
}
