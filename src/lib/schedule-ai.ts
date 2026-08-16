// AI-laag: losse, vervangbare module. Model, prompt en schema-validatie op één plek.
// Input: gestructureerde JSON, met CTL/ATL/TSB/FTP live van intervals.icu (bron van
// waarheid). Output: afgedwongen via tool use (vast JSON-schema), nooit vrije tekst
// parsen. Elke response wordt gelogd in ai_logs.

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import type { ProposedItem } from "./load";

const TOOL_NAME = "stel_weekschema_voor";

export interface ScheduleAiInput {
  ws: string; // week_start, maandag ISO-datum
  ftp: number;
  wkg: number | null;
  age: number | null;
  targetHoursWeek: number | null;
  goal?: { event: string; date: string | null };
  avail: Array<{ d: string; h: number }>;
  m: {
    ctl: number | null;
    atl: number | null;
    tsb: number | null; // ctl - atl
    rampRate: number | null; // intervals.icu: CTL-stijging per week
    chronicWk: number; // ctl × 7, benadering "normale" weeklast
  };
  recent: Array<{ d: string; min: number | null; tss: number | null }>;
  tpl: Array<{ id: string; name: string; zone: string; min: number }>;
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
    "Stel het weekschema voor als lijst van sessies. Gebruik uitsluitend id's uit tpl. " +
    "scale = zone-2-tijd die vóór/na de intensieve blokken wordt toegevoegd (negatief = ingekort); " +
    "rust tussen blokken verandert nooit.",
  input_schema: {
    type: "object" as const,
    properties: {
      sessions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "ISO-datum binnen de week" },
            tpl: { type: "string", description: "template-id uit de bibliotheek" },
            scale: { type: "integer", minimum: -30, maximum: 90 },
          },
          required: ["date", "tpl", "scale"],
        },
      },
      rationale: { type: "string", description: "Max 2 zinnen, Nederlands, kernreden voor het weekplan." },
    },
    required: ["sessions", "rationale"],
  },
};

export async function proposeWeekSchedule(input: ScheduleAiInput): Promise<ScheduleAiResult> {
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("ANTHROPIC_MODEL ontbreekt in .env.local");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system =
    "Planningsmodule van een wielren-trainingsapp (power-based, Coggan-zones). Velden: ws=weekstart, " +
    "ftp=FTP watt, wkg=vermogen/kg, age=leeftijd, targetHoursWeek=streefuren per week (zachte richtlijn, " +
    "availability blijft de harde grens per dag), avail=[{d,h}] beschikbare uren per dag, " +
    "m=belastingsmetrics van intervals.icu (ctl/atl/tsb/rampRate), recent=laatste sessies met TSS, " +
    "tpl=workout-bibliotheek {id,name,zone,min}. Stel een weekschema voor dat binnen h per dag past, " +
    "streef naar targetHoursWeek als richtlijn voor totale weekbelasting, polariseer verstandig " +
    "(niet elke dag intensief) en respecteer lage tsb (vermoeidheid) en een stijgende rampRate " +
    "(snel oplopende belasting) door na zware belasting hooguit 1-2 lichte hersteldagen te plannen " +
    "voordat je normale opbouw hervat. Een deterministische laag capt je voorstel zo nodig. " +
    `Antwoord uitsluitend via de tool ${TOOL_NAME}. Kort en zakelijk, geen toelichting per sessie.`;

  const response = await client.messages.create({
    model,
    max_tokens: 700,
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

  await db().from("ai_logs").insert({
    model,
    request: input as unknown as Record<string, unknown>,
    response: { content: response.content, usage: response.usage } as unknown as Record<string, unknown>,
  });

  return { items: parsed.sessions, rationale: parsed.rationale, model, raw: toolUse.input };
}

function validateScheduleOutput(
  raw: unknown,
  input: ScheduleAiInput
): { sessions: ProposedItem[]; rationale: string } {
  if (typeof raw !== "object" || raw === null) throw new Error("AI-output is geen object");
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.sessions)) throw new Error("AI-output mist 'sessions'");

  const validIds = new Set(input.tpl.map((t) => t.id));
  const weekDates = new Set(
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(input.ws + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    })
  );

  const sessions: ProposedItem[] = [];
  for (const s of o.sessions) {
    if (typeof s !== "object" || s === null) continue;
    const it = s as Record<string, unknown>;
    if (typeof it.date !== "string" || !weekDates.has(it.date)) continue;
    if (typeof it.tpl !== "string" || !validIds.has(it.tpl)) continue;
    const scale =
      typeof it.scale === "number" && Number.isFinite(it.scale)
        ? Math.max(-30, Math.min(90, Math.round(it.scale)))
        : 0;
    sessions.push({ date: it.date, template_id: it.tpl, scale_minutes: scale });
  }

  return { sessions, rationale: typeof o.rationale === "string" ? o.rationale : "" };
}
