// Copyright (c) 2026 AIKING. The quick New agent screen: look, name and job,
// then Create agent. "More options" opens the full upstream dialog with the
// same fields filled in. Layout follows the OpenBot 0.39 reference.
import { useEffect, useRef, useState } from "react";
import { Loader2, SlidersHorizontal, X } from "lucide-react";
import { useStore } from "@/state/store";
import { BOT_ROLES, type BotRole } from "@/lib/bot-roles";
import { AIKING_COLORS, AIKING_COLOR_NAMES, type AikingColor } from "@/lib/mascot";
import { AikingAvatar } from "@/components/Avatar";
import { MascotLookAvatar } from "@/components/MascotLookAvatar";
import { MascotLookPicker } from "@/components/BotProfileAvatarCard";
import { cn } from "@/lib/cn";
import type { MascotLook } from "../../shared/mascot-look";
import { MASCOT_BODIES, MASCOT_BODY_IDS, type MascotBodyId } from "../../shared/mascot-bodies";
import { createAgent, loadAgentDefaults, LocalAutoApprovalNeedsConsent, type AgentDefaults } from "./agent-install";
import { requestFullAgentDialog, seedNewAgentPatch, takeSeededPatch, takeSeededRole } from "./marketplace-state";
import { at } from "./strings";

const SUGGESTION_LOOKS: Array<{ color: AikingColor; body: MascotBodyId }> = [
  { color: "pink", body: "drop" }, { color: "blue", body: "capsule" }, { color: "yellow", body: "circle" },
  { color: "green", body: "hexagon" }, { color: "orange", body: "blob" }, { color: "purple", body: "squircle" },
];

export function NewAgentScreen() {
  const { dispatch } = useStore();
  const [defaults, setDefaults] = useState<AgentDefaults | null>(null);
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [color, setColor] = useState<AikingColor>("teal");
  const [body, setBody] = useState<MascotBodyId>("squircle");
  // Optional v3 look; null keeps the classic mascot chosen by the color and shape rows above.
  const [look, setLook] = useState<MascotLook | null>(null);
  const [role, setRole] = useState<BotRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const close = () => dispatch({ type: "toggleNewBot", open: false });

  useEffect(() => {
    const seededRole = takeSeededRole();
    const seededPatch = takeSeededPatch();
    const picked = seededRole ? BOT_ROLES.find((candidate) => candidate.id === seededRole) ?? null : null;
    if (picked) choose(picked, BOT_ROLES.indexOf(picked));
    if (seededPatch?.name) setName(seededPatch.name);
    if (seededPatch?.description) setJob(seededPatch.description);
    let alive = true;
    void loadAgentDefaults()
      .then((loaded) => {
        if (!alive) return;
        setDefaults(loaded);
        setName((current) => current || loaded.suggestedName);
      })
      .catch((cause) => alive && setError(cause instanceof Error ? cause.message : String(cause)));
    nameRef.current?.focus();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || saving) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function choose(next: BotRole, index: number) {
    setRole(next);
    setName(next.name);
    setJob(next.description);
    const look = SUGGESTION_LOOKS[index % SUGGESTION_LOOKS.length]!;
    setColor(look.color);
    setBody(look.body);
  }

  const profile = () => ({
    name: name.trim(),
    title: role?.title ?? "",
    description: job.trim(),
    soul: role?.soul ?? (job.trim() ? `You help with: ${job.trim()}` : ""),
    color,
    mascotBody: body,
    ...(look ? { mascotLook: look } : {}),
  });

  const create = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    dispatch({ type: "botCreationPending", on: true });
    try {
      const { bot, warnings } = await createAgent({ profile: profile() }, defaults ?? undefined);
      dispatch({ type: "botAdded", bot });
      if (warnings.length) dispatch({ type: "error", message: warnings.join("\n") });
      close();
    } catch (cause) {
      if (cause instanceof LocalAutoApprovalNeedsConsent) moreOptions();
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      dispatch({ type: "botCreationPending", on: false });
      setSaving(false);
    }
  };

  const moreOptions = () => {
    seedNewAgentPatch(profile());
    requestFullAgentDialog(true);
  };

  return (
    <main data-new-agent-screen className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <header className="flex h-10 shrink-0 items-center gap-2 bg-[var(--color-chrome)] px-3">
        {look ? <MascotLookAvatar look={look} size={18} /> : <AikingAvatar color={color} bodyId={body} size={18} animated={false} />}
        <h1 className="text-[14px] font-medium text-ink">{at("newAgent.title")}</h1>
        <button type="button" onClick={close} aria-label={at("newAgent.close")} className="ml-auto flex size-7 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink">
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <form
          className="mx-auto flex w-full max-w-[420px] flex-col items-stretch px-4 pb-10 pt-[min(12vh,120px)]"
          onSubmit={(event) => { event.preventDefault(); void create(); }}
        >
          <div className="flex justify-center">
            {look ? <MascotLookAvatar look={look} size={64} /> : <AikingAvatar color={color} bodyId={body} state="idle" size={64} label={name || at("newAgent.title")} />}
          </div>
          <div role="radiogroup" aria-label={at("newAgent.color")} className="mt-6 flex flex-wrap justify-center gap-2">
            {AIKING_COLOR_NAMES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={candidate === color}
                aria-label={at("newAgent.colorNamed", { color: candidate })}
                onClick={() => setColor(candidate)}
                className={cn(
                  "size-5 rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-focus",
                  candidate === color && "ring-2 ring-accent-border ring-offset-2 ring-offset-app",
                )}
                style={{ backgroundColor: AIKING_COLORS[candidate] }}
              />
            ))}
          </div>
          <div role="radiogroup" aria-label={at("newAgent.shape")} className="mt-4 flex flex-wrap justify-center gap-1.5">
            {MASCOT_BODY_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={id === body}
                aria-label={at("newAgent.shapeNamed", { shape: MASCOT_BODIES[id].name })}
                onClick={() => setBody(id)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus",
                  id === body ? "bg-raised ring-1 ring-accent-border" : "hover:bg-raised",
                )}
              >
                <AikingAvatar color={color} bodyId={id} size={20} animated={false} />
              </button>
            ))}
          </div>
          <MascotLookPicker look={look} disabled={saving} onChange={setLook} />
          <label className="mt-6 text-[12px] font-medium text-ink">
            {at("newAgent.name")}<span aria-hidden="true" className="text-danger"> *</span>
            <input
              ref={nameRef}
              value={name}
              required
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 block h-9 w-full rounded-lg border border-hairline bg-raised px-3 text-[15px] font-normal text-ink outline-none placeholder:text-ink-tertiary focus:border-focus/70"
            />
          </label>
          <label className="mt-4 text-[12px] font-medium text-ink">
            {at("newAgent.job")}
            <textarea
              value={job}
              rows={2}
              maxLength={600}
              placeholder={at("newAgent.jobPlaceholder")}
              onChange={(event) => setJob(event.target.value)}
              className="mt-1.5 block min-h-[64px] w-full resize-y rounded-lg border border-hairline bg-raised px-3 py-2 text-[15px] font-normal leading-6 text-ink outline-none placeholder:text-ink-tertiary focus:border-focus/70"
            />
          </label>
          {error && <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
          <div className="mt-4 flex items-center justify-center gap-2">
            <button type="button" onClick={moreOptions} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-secondary hover:bg-raised hover:text-ink">
              <SlidersHorizontal size={14} aria-hidden="true" />{at("newAgent.more")}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving || !defaults}
              className="inline-flex h-9 min-w-[132px] items-center justify-center gap-2 rounded-lg bg-ink px-4 text-[14px] font-medium text-app hover:bg-ink/90 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {at("newAgent.create")}
            </button>
          </div>
        </form>
        <section aria-labelledby="new-agent-suggestions" className="px-6 pb-6">
          <h2 id="new-agent-suggestions" className="mb-2 text-[12px] font-medium text-ink-secondary">{at("newAgent.suggestions")}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {BOT_ROLES.map((candidate, index) => {
              const look = SUGGESTION_LOOKS[index % SUGGESTION_LOOKS.length]!;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  aria-pressed={role?.id === candidate.id}
                  onClick={() => choose(candidate, index)}
                  className={cn(
                    "flex w-[256px] shrink-0 items-center gap-4 rounded-[14px] border px-4 py-4 text-left transition-colors",
                    role?.id === candidate.id ? "border-accent-border/60 bg-raised" : "border-hairline hover:bg-raised",
                  )}
                >
                  <AikingAvatar color={look.color} bodyId={look.body} size={40} animated={false} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-ink">{candidate.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] leading-[18px] text-ink-secondary">{candidate.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
