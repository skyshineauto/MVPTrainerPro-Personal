import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";
import { CreateExerciseModal, type CreatedExercise } from "../library/CreateExerciseModal";
import {
  getMuscleDetailOptions,
  matchFilters,
  normalizeText,
  resolveRowIcon,
  type EquipKey,
  type MuscleDetailKey,
  type MuscleKey,
} from "../../lib/exerciseMatch";

import icoDumbbell from "../../assets/dumbbell.png";
import icoRunner from "../../assets/runner.png";
import icoMachine from "../../assets/cable-row-machine.png";
import icoChest from "../../assets/gym.png";
import icoBack from "../../assets/back (2).png";
import icoShoulders from "../../assets/shoulder.png";
import icoCore from "../../assets/human.png";
import icoArms from "../../assets/biceps.png";
import icoLegs from "../../assets/leg.png";
import icoQuads from "../../assets/front.png";
import icoCalves from "../../assets/muscles.png";

const RESULTS_BATCH_SIZE = 5;

type SessionRow = {
  id: string;
  user_id: string;
  program_block_id: string | null;
  date: string;
  session_type: string;
  template_id: string | null;
  status: string;
};

type TemplateRow = {
  id: string;
  user_id: string;
  name: string;
  template_type: string;
  focus_tags: string[];
  estimated_minutes: number;
};

type DraftExercise = {
  localId: string;
  sourceTemplateExerciseId?: string;
  exercise_id: string;
  order_index: number;
  sets: number;
  rep_min: number;
  rep_max: number;
  rest_seconds: number;
  rir_min: number;
  rir_max: number;
  tempo: string | null;
  notes: string | null;
  exercise: ExerciseRow;
};

type ExerciseRow = {
  id: string;
  name: string;
  source?: string | null;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
  equipment?: string[] | null;
  media?: any;
  template_params?: any;
};

const MUSCLE_CHIPS: { key: Exclude<MuscleKey, "all">; label: string; icon: string }[] = [
  { key: "chest", label: "CHEST", icon: icoChest },
  { key: "back", label: "BACK", icon: icoBack },
  { key: "shoulders", label: "SHOULDERS", icon: icoShoulders },
  { key: "arms", label: "ARMS", icon: icoArms },
  { key: "abs", label: "ABS / CORE", icon: icoCore },
  { key: "legs", label: "LEGS", icon: icoLegs },
  { key: "quads", label: "QUADS", icon: icoQuads },
  { key: "calves", label: "CALVES", icon: icoCalves },
];

const EQUIP_CHIPS: { key: Exclude<EquipKey, "all">; label: string; icon: string }[] = [
  { key: "machine", label: "MACHINE", icon: icoMachine },
  { key: "free_weight", label: "FREE WEIGHT", icon: icoDumbbell },
  { key: "cardio", label: "CARDIO", icon: icoRunner },
];

function makeLocalId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function positiveInt(value: unknown, fallback: number, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

function defaultPrescription(exercise?: ExerciseRow | null) {
  const params = exercise?.template_params ?? {};
  const p =
    params?.default_prescription && typeof params.default_prescription === "object"
      ? params.default_prescription
      : params;
  return {
    sets: positiveInt(p.sets, 3, 1),
    rep_min: positiveInt(p.rep_min, 8, 1),
    rep_max: positiveInt(p.rep_max, 12, 1),
    rest_seconds: positiveInt(p.rest_seconds, 90, 0),
    rir_min: positiveInt(p.rir_min, 2, 0),
    rir_max: positiveInt(p.rir_max, 3, 0),
    tempo: typeof p.tempo === "string" ? p.tempo : null,
    notes: typeof p.notes === "string" ? p.notes : null,
  };
}

function lockDocumentForPlanner() {
  const appWindow = window as any;
  const existing = appWindow.__mvpTrainerModalLock as
    | { count: number; syncVisualViewport: () => void; releaseRoot: () => void }
    | undefined;

  if (existing) {
    existing.count += 1;
    existing.syncVisualViewport();
    return () => {
      existing.count -= 1;
      if (existing.count <= 0) existing.releaseRoot();
    };
  }

  const body = document.body;
  const html = document.documentElement;
  const scrollY = window.scrollY;
  const viewport = window.visualViewport;

  const previousBody = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    height: body.style.height,
    overflow: body.style.overflow,
    overscrollBehavior: body.style.overscrollBehavior,
  };
  const previousHtml = {
    width: html.style.width,
    height: html.style.height,
    overflow: html.style.overflow,
    overscrollBehavior: html.style.overscrollBehavior,
  };

  const syncVisualViewport = () => {
    const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
    const width = Math.max(1, Math.round(viewport?.width ?? window.innerWidth));
    const top = Math.round(viewport?.offsetTop ?? 0);
    const left = Math.round(viewport?.offsetLeft ?? 0);

    html.style.setProperty("--tr-modal-visual-height", `${height}px`);
    html.style.setProperty("--tr-modal-visual-width", `${width}px`);
    html.style.setProperty("--tr-modal-visual-top", `${top}px`);
    html.style.setProperty("--tr-modal-visual-left", `${left}px`);
  };

  html.classList.add("tr-modal-open");
  syncVisualViewport();

  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.height = "100%";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  html.style.width = "100%";
  html.style.height = "100%";
  html.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";

  window.addEventListener("resize", syncVisualViewport);
  viewport?.addEventListener("resize", syncVisualViewport);
  viewport?.addEventListener("scroll", syncVisualViewport);

  const releaseRoot = () => {
    window.removeEventListener("resize", syncVisualViewport);
    viewport?.removeEventListener("resize", syncVisualViewport);
    viewport?.removeEventListener("scroll", syncVisualViewport);

    body.style.position = previousBody.position;
    body.style.top = previousBody.top;
    body.style.left = previousBody.left;
    body.style.right = previousBody.right;
    body.style.width = previousBody.width;
    body.style.height = previousBody.height;
    body.style.overflow = previousBody.overflow;
    body.style.overscrollBehavior = previousBody.overscrollBehavior;
    html.style.width = previousHtml.width;
    html.style.height = previousHtml.height;
    html.style.overflow = previousHtml.overflow;
    html.style.overscrollBehavior = previousHtml.overscrollBehavior;
    html.classList.remove("tr-modal-open");
    delete appWindow.__mvpTrainerModalLock;
    window.scrollTo(0, scrollY);
  };

  const state = { count: 1, syncVisualViewport, releaseRoot };
  appWindow.__mvpTrainerModalLock = state;

  return () => {
    state.count -= 1;
    if (state.count <= 0) state.releaseRoot();
  };
}

function displayDate(date: string) {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PlannedSessionEditor({
  sessionId,
  onClose,
  onSaved,
}: {
  sessionId: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionRow | null>(null);
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [draft, setDraft] = useState<DraftExercise[]>([]);
  const [catalog, setCatalog] = useState<ExerciseRow[]>([]);

  const [mobileTab, setMobileTab] = useState<"current" | "add">("current");
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleKey>("all");
  const [muscleDetail, setMuscleDetail] = useState<MuscleDetailKey>("all");
  const [equip, setEquip] = useState<EquipKey>("all");
  const [visibleCount, setVisibleCount] = useState(RESULTS_BATCH_SIZE);
  const [createExerciseOpen, setCreateExerciseOpen] = useState(false);

  useEffect(() => lockDocumentForPlanner(), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!userData.user) throw new Error("Sign in first.");

        const { data: sessionData, error: sessionError } = await supabase
          .from("scheduled_sessions")
          .select("id,user_id,program_block_id,date,session_type,template_id,status")
          .eq("id", sessionId)
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (sessionError) throw sessionError;
        if (!sessionData) throw new Error("Scheduled session not found.");
        if (!sessionData.template_id) throw new Error("This session does not have a workout template.");

        const { data: templateData, error: templateError } = await supabase
          .from("workout_templates")
          .select("id,user_id,name,template_type,focus_tags,estimated_minutes")
          .eq("id", sessionData.template_id)
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (templateError) throw templateError;
        if (!templateData) throw new Error("Workout template not found.");

        const { data: templateExercises, error: templateExercisesError } = await supabase
          .from("template_exercises")
          .select("id,template_id,order_index,exercise_id,sets,rep_min,rep_max,rest_seconds,rir_min,rir_max,tempo,notes")
          .eq("template_id", templateData.id)
          .order("order_index", { ascending: true });
        if (templateExercisesError) throw templateExercisesError;

        const exerciseIds = Array.from(
          new Set((templateExercises ?? []).map((row: any) => row.exercise_id).filter(Boolean))
        );

        let exerciseRows: ExerciseRow[] = [];
        if (exerciseIds.length) {
          const { data, error: exerciseError } = await supabase
            .from("exercises")
            .select("id,name,source,primary_muscles,secondary_muscles,equipment,media,template_params")
            .in("id", exerciseIds);
          if (exerciseError) throw exerciseError;
          exerciseRows = (data ?? []) as ExerciseRow[];
        }

        const exerciseMap = new Map(exerciseRows.map((exercise) => [exercise.id, exercise]));
        const nextDraft: DraftExercise[] = (templateExercises ?? []).map((row: any, index: number) => ({
          localId: makeLocalId(),
          sourceTemplateExerciseId: row.id,
          exercise_id: row.exercise_id,
          order_index: index,
          sets: positiveInt(row.sets, 3, 1),
          rep_min: positiveInt(row.rep_min, 8, 1),
          rep_max: positiveInt(row.rep_max, 12, 1),
          rest_seconds: positiveInt(row.rest_seconds, 90, 0),
          rir_min: positiveInt(row.rir_min, 2, 0),
          rir_max: positiveInt(row.rir_max, 3, 0),
          tempo: typeof row.tempo === "string" ? row.tempo : null,
          notes: typeof row.notes === "string" ? row.notes : null,
          exercise:
            exerciseMap.get(row.exercise_id) ??
            ({ id: row.exercise_id, name: "Unknown exercise" } as ExerciseRow),
        }));

        const { data: allExercises, error: catalogError } = await supabase
          .from("exercises")
          .select("id,name,source,primary_muscles,secondary_muscles,equipment,media,template_params")
          .order("name", { ascending: true })
          .limit(1000);
        if (catalogError) throw catalogError;

        if (cancelled) return;
        setSession(sessionData as SessionRow);
        setTemplate(templateData as TemplateRow);
        setDraft(nextDraft);
        setCatalog((allExercises ?? []) as ExerciseRow[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const detailOptions = useMemo(() => getMuscleDetailOptions(muscle), [muscle]);

  const filteredCatalog = useMemo(() => {
    const term = normalizeText(query);
    return catalog.filter((exercise) => {
      if (term && !normalizeText(exercise.name).includes(term)) return false;
      return matchFilters(exercise, muscle, equip, muscleDetail);
    });
  }, [catalog, query, muscle, equip, muscleDetail]);

  const visibleResults = useMemo(
    () => filteredCatalog.slice(0, visibleCount),
    [filteredCatalog, visibleCount]
  );
  const hasMore = visibleCount < filteredCatalog.length;

  useEffect(() => {
    setVisibleCount(RESULTS_BATCH_SIZE);
  }, [query, muscle, muscleDetail, equip]);

  function selectMuscle(next: MuscleKey) {
    setMuscle(next);
    setMuscleDetail("all");
  }

  function reindex(items: DraftExercise[]) {
    return items.map((item, index) => ({ ...item, order_index: index }));
  }

  function moveExercise(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = current.slice();
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return reindex(copy);
    });
  }

  function deleteExercise(index: number) {
    setDraft((current) => reindex(current.filter((_, itemIndex) => itemIndex !== index)));
    if (swapIndex === index) setSwapIndex(null);
    else if (swapIndex != null && swapIndex > index) setSwapIndex(swapIndex - 1);
  }

  function updateExerciseNumber(
    index: number,
    key: "sets" | "rep_min" | "rep_max" | "rest_seconds",
    rawValue: string
  ) {
    const minimum = key === "rest_seconds" ? 0 : 1;
    const parsed = positiveInt(rawValue, minimum, minimum);
    setDraft((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: parsed } : item
      )
    );
  }

  function pickExercise(exercise: ExerciseRow) {
    if (swapIndex != null) {
      setDraft((current) =>
        current.map((item, index) =>
          index === swapIndex
            ? { ...item, exercise_id: exercise.id, exercise }
            : item
        )
      );
      setSwapIndex(null);
      setMobileTab("current");
      return;
    }

    const defaults = defaultPrescription(exercise);
    setDraft((current) =>
      reindex([
        ...current,
        {
          localId: makeLocalId(),
          exercise_id: exercise.id,
          order_index: current.length,
          ...defaults,
          exercise,
        },
      ])
    );
  }

  async function handleCreatedExercise(
    exercise: CreatedExercise,
    addToSession: boolean
  ) {
    const normalized: ExerciseRow = {
      id: exercise.id,
      name: exercise.name,
      source: exercise.source ?? "custom",
      primary_muscles: exercise.primary_muscles ?? [],
      secondary_muscles: exercise.secondary_muscles ?? [],
      equipment: exercise.equipment ?? [],
      media: exercise.media ?? null,
      template_params: exercise.template_params ?? {},
    };

    setCatalog((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== normalized.id);
      return [...withoutDuplicate, normalized].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    });

    setQuery(normalized.name);
    setVisibleCount(RESULTS_BATCH_SIZE);

    if (addToSession) {
      pickExercise(normalized);
    }
  }

  async function createTemplateFromDraft(label: string) {
    if (!session || !template) throw new Error("Session template is not loaded.");

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!userData.user) throw new Error("Sign in first.");

    const { data: newTemplate, error: templateInsertError } = await supabase
      .from("workout_templates")
      .insert({
        user_id: userData.user.id,
        name: `${template.name} • ${label}`,
        template_type: template.template_type,
        focus_tags: Array.isArray(template.focus_tags) ? template.focus_tags : [],
        estimated_minutes: positiveInt(template.estimated_minutes, 45, 1),
      })
      .select("id")
      .single();
    if (templateInsertError) throw templateInsertError;

    const newTemplateId = newTemplate.id as string;
    const p_items = reindex(draft).map((item) => ({
      order_index: item.order_index,
      exercise_id: item.exercise_id,
      sets: positiveInt(item.sets, 3, 1),
      rep_min: positiveInt(item.rep_min, 8, 1),
      rep_max: positiveInt(item.rep_max, 12, 1),
      rest_seconds: positiveInt(item.rest_seconds, 90, 0),
      rir_min: positiveInt(item.rir_min, 2, 0),
      rir_max: positiveInt(item.rir_max, 3, 0),
    }));

    const { error: rowsError } = await supabase.rpc("rpc_template_exercises_replace", {
      p_template_id: newTemplateId,
      p_items,
    });
    if (rowsError) {
      await supabase.from("workout_templates").delete().eq("id", newTemplateId);
      throw rowsError;
    }

    return { newTemplateId, userId: userData.user.id };
  }

  async function saveThisSession() {
    if (!session) return;
    setSaving(true);
    setError(null);

    try {
      const { newTemplateId, userId } = await createTemplateFromDraft(
        `${session.session_type} • ${session.date}`
      );

      const { data: updatedRows, error: updateError } = await supabase
        .from("scheduled_sessions")
        .update({ template_id: newTemplateId })
        .eq("id", session.id)
        .eq("user_id", userId)
        .select("id");
      if (updateError || !updatedRows?.length) {
        await supabase.from("workout_templates").delete().eq("id", newTemplateId);
        throw updateError ?? new Error("The scheduled session could not be updated.");
      }

      await onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveAllFuture() {
    if (!session) return;
    if (!session.program_block_id) {
      setError("This session is not attached to a program block.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { newTemplateId, userId } = await createTemplateFromDraft(
        `${session.session_type} • future`
      );

      const { data: updatedRows, error: updateError } = await supabase
        .from("scheduled_sessions")
        .update({ template_id: newTemplateId })
        .eq("user_id", userId)
        .eq("program_block_id", session.program_block_id)
        .eq("session_type", session.session_type)
        .gte("date", session.date)
        .select("id");
      if (updateError || !updatedRows?.length) {
        await supabase.from("workout_templates").delete().eq("id", newTemplateId);
        throw updateError ?? new Error("No matching future sessions were updated.");
      }

      await onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="tr-modalOverlay tr-modalOverlay--locked" role="dialog" aria-modal="true" aria-label="Edit upcoming session">
      <div className={`tr-modal tr-modal--viewport tr-editModal tr-plannedEditor tr-editModal--mobile-${mobileTab}`}>
        <div className="tr-modalHead">
          <div style={{ display: "grid", gap: 3 }}>
            <div style={{ fontWeight: 950 }}>Edit Upcoming Session</div>
            <div className="tr-sub">
              {session ? `${session.session_type} • ${displayDate(session.date)}` : "Loading session…"}
            </div>
            {error ? (
              <div style={{ color: "rgba(255,120,120,.96)", fontSize: 11, fontWeight: 900 }}>
                {error}
              </div>
            ) : null}
          </div>

          <div className="tr-editModalActions" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="tr-btn tr-btn--primary" onClick={saveThisSession} disabled={saving || loading || !!error && !session}>
              {saving ? "Saving…" : "Save This Session"}
            </button>
            <button className="tr-btn" onClick={saveAllFuture} disabled={saving || loading || !!error && !session}>
              Save to All Future Sessions
            </button>
            <button className="tr-btn" onClick={onClose} disabled={saving}>
              Close
            </button>
          </div>
        </div>

        <div className="tr-modalBody tr-editModalBody">
          <div className="tr-editMobileTabs" role="tablist" aria-label="Upcoming workout editor sections">
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "current"}
              className={`tr-seg ${mobileTab === "current" ? "is-active" : ""}`}
              onClick={() => setMobileTab("current")}
            >
              Current Workout ({draft.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "add"}
              className={`tr-seg ${mobileTab === "add" ? "is-active" : ""}`}
              onClick={() => setMobileTab("add")}
            >
              {swapIndex != null ? "Pick Replacement" : "Add Exercise"}
            </button>
          </div>

          <div className="tr-editCurrentPanel">
            <Card title="Current workout exercises" tone="base">
              <div className="tr-editCurrentList">
                {loading ? <div className="tr-sub">Loading workout…</div> : null}
                {error ? (
                  <div className="tr-rowbox" style={{ borderColor: "rgba(255,80,80,.40)", background: "rgba(255,80,80,.10)" }}>
                    {error}
                  </div>
                ) : null}

                {!loading && !error
                  ? draft.map((item, index) => {
                      const icon = resolveRowIcon(item.exercise);
                      return (
                        <div key={item.localId} className="tr-plannedExerciseCard">
                          <div className="tr-plannedExerciseMain">
                            <div className="tr-plannedExerciseTitle">
                              {icon.icon ? <img className="tr-ico" src={icon.icon} alt={icon.alt} /> : null}
                              <span>{index + 1}. {item.exercise.name}</span>
                            </div>
                            <div className="tr-sub">
                              {(item.exercise.primary_muscles ?? []).join(", ") || "—"} • {(item.exercise.equipment ?? []).join(", ") || "—"}
                            </div>
                          </div>

                          <div className="tr-plannedPrescriptionGrid">
                            <label>
                              <span>SETS</span>
                              <input
                                value={item.sets}
                                inputMode="numeric"
                                onChange={(event) => updateExerciseNumber(index, "sets", event.target.value)}
                              />
                            </label>
                            <label>
                              <span>REP MIN</span>
                              <input
                                value={item.rep_min}
                                inputMode="numeric"
                                onChange={(event) => updateExerciseNumber(index, "rep_min", event.target.value)}
                              />
                            </label>
                            <label>
                              <span>REP MAX</span>
                              <input
                                value={item.rep_max}
                                inputMode="numeric"
                                onChange={(event) => updateExerciseNumber(index, "rep_max", event.target.value)}
                              />
                            </label>
                            <label>
                              <span>REST</span>
                              <input
                                value={item.rest_seconds}
                                inputMode="numeric"
                                onChange={(event) => updateExerciseNumber(index, "rest_seconds", event.target.value)}
                              />
                            </label>
                          </div>

                          <div className="tr-plannedExerciseActions">
                            <button className="tr-seg" onClick={() => moveExercise(index, -1)} disabled={index === 0}>Up</button>
                            <button className="tr-seg" onClick={() => moveExercise(index, 1)} disabled={index === draft.length - 1}>Down</button>
                            <button
                              className={`tr-seg ${swapIndex === index ? "is-active" : ""}`}
                              onClick={() => {
                                setSwapIndex(index);
                                setMobileTab("add");
                              }}
                            >
                              Swap
                            </button>
                            <button className="tr-danger" onClick={() => deleteExercise(index)}>Delete</button>
                          </div>
                        </div>
                      );
                    })
                  : null}

                {!loading && !error && !draft.length ? <div className="tr-sub">No exercises yet. Open Add Exercise to build this workout.</div> : null}
              </div>
            </Card>
          </div>

          <div className="tr-editAddPanel">
            <Card title={swapIndex != null ? "Pick replacement" : "Add an exercise"} tone="blue">
              <div className="tr-editAddLayout">
                <div className="tr-rowbox tr-plannedFilterBox tr-editFilterScroll" style={{ display: "grid", gap: 8 }}>
                  <div className="tr-createInlineBar">
                    <div>
                      <div className="tr-kicker">CUSTOM EXERCISE</div>
                      <div className="tr-sub">Create one with media and workout defaults.</div>
                    </div>
                    <button
                      type="button"
                      className="tr-btn tr-btn--blueOutline"
                      onClick={() => setCreateExerciseOpen(true)}
                    >
                      + Create New Exercise
                    </button>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="tr-kicker">MUSCLE</div>
                    <div className="tr-chipRow tr-chipRow--wrap">
                      <button className={`tr-seg ${muscle === "all" ? "is-active" : ""}`} onClick={() => selectMuscle("all")}>ALL</button>
                      {MUSCLE_CHIPS.map((item) => (
                        <button key={item.key} className={`tr-seg ${muscle === item.key ? "is-active" : ""}`} onClick={() => selectMuscle(item.key)}>
                          <img className="tr-ico" src={item.icon} alt="" /> {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {detailOptions.length > 1 ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div className="tr-kicker">TARGET MUSCLE</div>
                      <div className="tr-chipRow tr-chipRow--wrap tr-muscleDetailRow">
                        {detailOptions.map((option) => (
                          <button
                            key={option.key}
                            className={`tr-seg ${muscleDetail === option.key ? "is-active" : ""}`}
                            onClick={() => setMuscleDetail(option.key)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="tr-kicker">EQUIPMENT</div>
                    <div className="tr-chipRow tr-chipRow--wrap">
                      <button className={`tr-seg ${equip === "all" ? "is-active" : ""}`} onClick={() => setEquip("all")}>ALL</button>
                      {EQUIP_CHIPS.map((item) => (
                        <button key={item.key} className={`tr-seg ${equip === item.key ? "is-active" : ""}`} onClick={() => setEquip(item.key)}>
                          <img className="tr-ico" src={item.icon} alt="" /> {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search exercises…"
                  style={{ height: 44 }}
                />

                <div className="tr-sub">
                  {swapIndex != null ? "Pick a replacement exercise." : `Showing ${Math.min(visibleResults.length, filteredCatalog.length)} of ${filteredCatalog.length} matching exercises.`}
                </div>

                <div className="tr-editResultsViewport">
                  {visibleResults.map((exercise) => {
                    const icon = resolveRowIcon(exercise);
                    const alreadyAdded = draft.some((item) => item.exercise_id === exercise.id);
                    return (
                      <button
                        key={exercise.id}
                        className="tr-rowBtn"
                        onClick={() => pickExercise(exercise)}
                      >
                        <div className="tr-rowbox tr-plannedResultRow">
                          <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ fontWeight: 950, display: "flex", alignItems: "center", gap: 9 }}>
                              {icon.icon ? <img className="tr-ico" src={icon.icon} alt={icon.alt} /> : null}
                              {exercise.name}
                            </div>
                            <div className="tr-sub">
                              {(exercise.primary_muscles ?? []).join(", ") || "—"} • {(exercise.equipment ?? []).join(", ") || "—"}
                            </div>
                          </div>
                          <span className={`tr-addedBadge ${alreadyAdded ? "is-on" : ""}`}>
                            {swapIndex != null ? "SWAP" : alreadyAdded ? "ADD AGAIN" : "ADD"}
                          </span>
                        </div>
                      </button>
                    );
                  })}

                  {!loading && !visibleResults.length ? <div className="tr-sub">No matching exercises.</div> : null}
                </div>
              </div>
            </Card>
          </div>
        </div>

        <div className="tr-modalFooter tr-modalFooter--center tr-editModalFooter">
          <button
            type="button"
            className="tr-btn tr-btn--primary tr-editFooterCurrentAction"
            onClick={() => setMobileTab("add")}
          >
            Add Exercise
          </button>

          <button
            type="button"
            className="tr-btn tr-btn--primary tr-editFooterLoadMore"
            onClick={() => setVisibleCount((count) => count + RESULTS_BATCH_SIZE)}
            disabled={!hasMore}
          >
            {hasMore ? "Load More Exercises" : "All Matching Exercises Loaded"}
          </button>
        </div>
      </div>

      <CreateExerciseModal
        open={createExerciseOpen}
        onClose={() => setCreateExerciseOpen(false)}
        onCreated={handleCreatedExercise}
        allowAddToSession
        addActionLabel={swapIndex != null ? "Save & Use as Replacement" : "Save & Add to Session"}
      />
    </div>,
    document.body
  );
}
