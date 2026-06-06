// src/features/library/LibraryPage.tsx
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";

import {
  effectiveHasMedia,
  matchFilters,
  resolveRowIcon,
  normalizeText,
  type EquipKey,
  type MuscleKey,
  type UserMediaLite,
} from "../../lib/exerciseMatch";
import { AlertIcon, CheckIcon } from "../../lib/exerciseIcons";

/** Icons for filter pills */
import icoChest from "../../assets/gym.png";
import icoBack from "../../assets/back (2).png";
import icoShoulders from "../../assets/shoulder.png";
import icoArms from "../../assets/biceps.png";
import icoAbs from "../../assets/human.png";
import icoLegs from "../../assets/leg.png";
import icoQuads from "../../assets/front.png";
import icoCalves from "../../assets/muscles.png";

import icoMachine from "../../assets/cable-row-machine.png";
import icoFreeWeight from "../../assets/dumbbell.png";
import icoCardio from "../../assets/runner.png";

type ExRow = {
  id: string;
  name: string;
  source?: string | null;
  primary_muscles?: string[] | null;
  equipment?: string[] | null;
  media?: any;
  template_params?: any;
};

type UserMediaRow = UserMediaLite;

type ToastTone = "ok" | "err";
type ToastState = { open: boolean; tone: ToastTone; text: string };

type MediaKey = "all" | "ok" | "missing" | "my_uploads";

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  if (!toast.open) return null;
  return (
    <div style={{ position: "fixed", right: 18, bottom: 86, zIndex: 10001, width: "min(520px, calc(100vw - 36px))" }}>
      <div
        className="tr-rowbox"
        style={{
          borderColor: toast.tone === "ok" ? "rgba(0,170,255,.45)" : "rgba(255,80,80,.45)",
          background: toast.tone === "ok" ? "rgba(0,170,255,.12)" : "rgba(255,80,80,.12)",
          fontWeight: 950,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ lineHeight: 1.25 }}>{toast.text}</div>
        <button className="tr-seg" style={{ height: 36 }} onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}

const MUSCLE_BUTTONS: Array<{ key: MuscleKey; label: string; icon?: string }> = [
  { key: "all", label: "ALL" },
  { key: "chest", label: "CHEST", icon: icoChest },
  { key: "back", label: "BACK", icon: icoBack },
  { key: "shoulders", label: "SHOULDERS", icon: icoShoulders },
  { key: "arms", label: "ARMS", icon: icoArms },
  { key: "abs", label: "ABS / CORE", icon: icoAbs },
  { key: "legs", label: "LEGS", icon: icoLegs },
  { key: "quads", label: "QUADS", icon: icoQuads },
  { key: "calves", label: "CALVES", icon: icoCalves },
];

const EQUIP_BUTTONS: Array<{ key: EquipKey; label: string; icon?: string }> = [
  { key: "all", label: "ALL" },
  { key: "machine", label: "MACHINE", icon: icoMachine },
  { key: "free_weight", label: "FREE WEIGHT", icon: icoFreeWeight },
  { key: "cardio", label: "CARDIO", icon: icoCardio },
];

const PAGE_SIZE = 250;

/** Expand only the stairs family (your current pain point). */
function expandSearchTerms(raw: string): string[] {
  const q = normalizeText(raw);
  if (!q) return [];

  const out = new Set<string>();
  out.add(q);

  const hasStair =
    q.includes("stair") || q.includes("climb") || q.includes("step") || q.includes("stepper") || q.includes("stepmill") || q.includes("stairmaster");

  if (hasStair) {
    [
      "stair climber",
      "stairclimber",
      "stair stepper",
      "stairmaster",
      "stair master",
      "stepmill",
      "step mill",
      "stepper",
      "climber",
    ].forEach((t) => out.add(t));
  }

  // If they type a single token like "sta", don’t explode the query
  // (synonym expansion should only kick in for meaningful cardio intent)
  return Array.from(out).filter(Boolean);
}

/** Supabase OR clause builder: name.ilike.%x%,name.ilike.%y% */
function buildNameOrIlike(terms: string[]) {
  const uniq = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));
  // Escape % and _ for LIKE: easiest is to just avoid adding them from user input.
  // Terms here are controlled (normalized + our expansions).
  return uniq.map((t) => `name.ilike.%${t.replace(/%/g, "").replace(/_/g, "")}%`).join(",");
}

/** Cardio browse OR clause (name-driven). */
function cardioBrowseOrIlike() {
  const terms = [
    "treadmill",
    "elliptical",
    "cross trainer",
    "arc trainer",
    "jog",
    "jogging",
    "running",
    "sprint",
    "bike",
    "bicycle",
    "cycling",
    "spin",
    "spinning",
    "air bike",
    "assault bike",
    "rower",
    "rowing",
    "erg",
    "ergometer",
    "concept2",
    "stair climber",
    "stairclimber",
    "stair stepper",
    "stairmaster",
    "stepmill",
    "step mill",
    "skierg",
    "ski erg",
  ];
  return buildNameOrIlike(terms);
}

export function LibraryPage({ navigate }: { navigate: (to: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");

  const [muscle, setMuscle] = useState<MuscleKey>("all");
  const [equip, setEquip] = useState<EquipKey>("all");
  const [media, setMedia] = useState<MediaKey>("all");

  const [rows, setRows] = useState<ExRow[]>([]);
  const [userMediaRows, setUserMediaRows] = useState<UserMediaRow[]>([]);

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [toast, setToast] = useState<ToastState>({ open: false, tone: "ok", text: "" });
  const toastTimer = useRef<any>(null);
  function showToast(text: string, tone: ToastTone = "ok") {
    try {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    } catch {}
    setToast({ open: true, tone, text });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), 2400);
  }

  /** ==========================
   *  CREATE EXERCISE MODAL (unchanged)
   *  ========================== */
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createNotes, setCreateNotes] = useState("");

  const [createMuscle, setCreateMuscle] = useState<Exclude<MuscleKey, "all">>("chest");
  const [createEquip, setCreateEquip] = useState<Exclude<EquipKey, "all">>("free_weight");

  const [createSets, setCreateSets] = useState("3");
  const [createRepMin, setCreateRepMin] = useState("8");
  const [createRepMax, setCreateRepMax] = useState("12");
  const [createRest, setCreateRest] = useState("90");

  const [createCardioMins, setCreateCardioMins] = useState("10");

  const isCreateCardio = createEquip === "cardio";

  function resetCreate() {
    setCreateName("");
    setCreateNotes("");
    setCreateMuscle("chest");
    setCreateEquip("free_weight");
    setCreateSets("3");
    setCreateRepMin("8");
    setCreateRepMax("12");
    setCreateRest("90");
    setCreateCardioMins("10");
  }

  function openCreate() {
    resetCreate();
    setCreateOpen(true);
  }

  const userMediaByExercise = useMemo(() => {
    const map = new Map<string, UserMediaRow[]>();
    for (const r of userMediaRows) {
      const id = r.exercise_id;
      if (!id) continue;
      const list = map.get(id) ?? [];
      list.push(r);
      map.set(id, list);
    }
    return map;
  }, [userMediaRows]);

  const decorated = useMemo(() => {
    return rows.map((ex) => {
      const uRows = userMediaByExercise.get(ex.id) ?? [];
      const ok = effectiveHasMedia(ex, uRows);
      const mediaSource = uRows.some((x) => x.use_user_upload) ? "YOUR UPLOAD" : ok ? "BUILT-IN" : "MISSING";
      return { ...ex, effectiveHasMedia: ok, mediaSource };
    });
  }, [rows, userMediaByExercise]);

  const filtered = useMemo(() => {
    const termRaw = q.trim();
    const term = normalizeText(termRaw);

    return decorated.filter((r: any) => {
      const nameNorm = normalizeText(r.name || "");

      // typing search (client-side term match, since we server-query broadly)
      if (term.length >= 2) {
        const family = expandSearchTerms(termRaw).map(normalizeText);
        const ok = family.some((t) => t && nameNorm.includes(t));
        if (!ok) return false;
      }

      // ✅ unified rules (the contract)
      if (!matchFilters(r, muscle, equip)) return false;

      // media filter
      if (media === "ok" && !r.effectiveHasMedia) return false;
      if (media === "missing" && r.effectiveHasMedia) return false;
      if (media === "my_uploads") {
        const uRows = userMediaByExercise.get(r.id) ?? [];
        const enabled = uRows.some((x) => x.use_user_upload);
        const hasAsset = uRows.some((x) => (x.storage_path || "").trim().length > 0);
        if (!(enabled && hasAsset)) return false;
      }

      return true;
    });
  }, [decorated, q, muscle, equip, media, userMediaByExercise]);

  const missingCount = useMemo(() => filtered.filter((r: any) => !r.effectiveHasMedia).length, [filtered]);
  const okCount = useMemo(() => filtered.filter((r: any) => r.effectiveHasMedia).length, [filtered]);

  function resetPaging() {
    setRows([]);
    setUserMediaRows([]);
    setPage(0);
    setHasMore(true);
  }

  async function fetchPage(nextPage: number) {
    const termRaw = q.trim();
    const termNorm = normalizeText(termRaw);

    const from = nextPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("exercises")
      .select("id,name,source,primary_muscles,equipment,media,template_params")
      .order("name", { ascending: true })
      .range(from, to);

    // If user is searching, broaden server query with ORs (synonym expanded).
    if (termNorm.length >= 2) {
      const terms = expandSearchTerms(termRaw);
      query = query.or(buildNameOrIlike(terms));
    } else {
      // Browse mode: if CARDIO tab, do cardio-first server query so we aren’t trapped in the first alphabet slice.
      if (equip === "cardio") {
        query = query.or(cardioBrowseOrIlike());
      }
      // For other browse modes, we fetch pages and filter client-side via matchFilters().
    }

    const { data: exs, error: exErr } = await query;
    if (exErr) throw exErr;

    const list = (exs ?? []) as ExRow[];

    // Pull user media for these IDs
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr) throw uErr;
    if (!u.user) throw new Error("Sign in first.");

    const ids = list.map((x) => x.id).filter(Boolean);
    let um: any[] = [];
    if (ids.length) {
      const { data: umData, error: umErr } = await supabase
        .from("exercise_user_media")
        .select("exercise_id,kind,storage_path,use_user_upload")
        .eq("user_id", u.user.id)
        .in("exercise_id", ids);
      if (umErr) throw umErr;
      um = umData ?? [];
    }

    return { list, um, reachedEnd: list.length < PAGE_SIZE };
  }

  async function loadInitial() {
    setLoading(true);
    setErr(null);
    try {
      resetPaging();
      const { list, um, reachedEnd } = await fetchPage(0);
      setRows(list);
      setUserMediaRows(um as any);
      setHasMore(!reachedEnd);
      setPage(0);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      showToast(e?.message ?? "Load failed", "err");
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const { list, um, reachedEnd } = await fetchPage(next);
      setRows((prev) => [...prev, ...list]);
      setUserMediaRows((prev) => [...prev, ...(um as any[])]);
      setHasMore(!reachedEnd);
      setPage(next);
    } catch (e: any) {
      showToast(e?.message ?? "Load more failed", "err");
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  // Initial load
  useEffect(() => {
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when search/filter changes
  useEffect(() => {
    const t = setTimeout(() => void loadInitial(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, muscle, equip]);

  async function createExercise() {
    const name = createName.trim();
    if (!name) {
      showToast("NAME IS REQUIRED.", "err");
      return;
    }

    if (isCreateCardio) {
      const mins = Number(createCardioMins.trim());
      if (!Number.isFinite(mins) || mins <= 0) {
        showToast("CARDIO DURATION (MINUTES) IS REQUIRED.", "err");
        return;
      }
    }

    setCreateBusy(true);
    try {
      const payload: any = {
        name,
        equipment: [createEquip],
        primary_muscles: isCreateCardio ? ["cardio"] : [createMuscle === "abs" ? "core" : createMuscle],
        notes: createNotes.trim() ? createNotes.trim() : null,
        description: "",
      };

      if (isCreateCardio) {
        payload.duration_minutes = Math.max(1, Math.floor(Number(createCardioMins.trim() || "0")));
      } else {
        payload.sets = Math.max(1, Math.floor(Number(createSets.trim() || "3")));
        payload.rep_min = Math.max(1, Math.floor(Number(createRepMin.trim() || "8")));
        payload.rep_max = Math.max(1, Math.floor(Number(createRepMax.trim() || "12")));
        payload.rest_seconds = Math.max(0, Math.floor(Number(createRest.trim() || "90")));
        payload.rir_min = 2;
        payload.rir_max = 3;
      }

      const { data: newId, error } = await supabase.rpc("rpc_exercise_create_custom", { p_payload: payload });
      if (error) throw error;

      const id = typeof newId === "string" ? newId : (newId as any)?.id || null;
      if (!id) throw new Error("Create succeeded but no id returned.");

      showToast("EXERCISE CREATED.", "ok");
      setCreateOpen(false);

      await loadInitial();
      navigate(`/library/${id}`);
    } catch (e: any) {
      showToast(e?.message ?? "CREATE FAILED.", "err");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} onClose={() => setToast((t) => ({ ...t, open: false }))} />

      <Card title="Library" tone="blue" right={<span className="tr-kicker">EXERCISES</span>}>
        {err ? (
          <div className="tr-rowbox" style={{ borderColor: "rgba(255,80,80,.35)", background: "rgba(255,80,80,.10)" }}>
            {err}
          </div>
        ) : null}

        <div className="tr-rowbox" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search exercises…"
                style={{ height: 44, width: "min(420px, 100%)" }}
              />

              <button className="tr-btn tr-btn--blueOutline" style={{ height: 44 }} onClick={openCreate}>
                ADD EXERCISE
              </button>
            </div>

            <div className="tr-sub" style={{ textAlign: "right" }}>
              Showing {filtered.length} • OK {okCount} • Missing {missingCount}
            </div>
          </div>

          {/* Filters */}
          <div className="tr-filterGroup">
            <div className="tr-filterLabel">MUSCLE FILTER</div>
            <div className="tr-filterRow">
              {MUSCLE_BUTTONS.map((b) => (
                <button key={b.key} className={`tr-seg ${muscle === b.key ? "is-active" : ""}`} onClick={() => setMuscle(b.key)}>
                  {b.icon ? <img className="tr-ico" src={b.icon} alt="" /> : null}
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="tr-filterRow" style={{ justifyContent: "space-between" }}>
            <div className="tr-filterGroup">
              <div className="tr-filterLabel">EQUIPMENT</div>
              <div className="tr-filterRow">
                {EQUIP_BUTTONS.map((b) => (
                  <button key={b.key} className={`tr-seg ${equip === b.key ? "is-active" : ""}`} onClick={() => setEquip(b.key)}>
                    {b.icon ? <img className="tr-ico" src={b.icon} alt="" /> : null}
                    {b.label}
                  </button>
                ))}
              </div>
              
            </div>
            

            <div className="tr-filterGroup">
              <div className="tr-filterLabel">MEDIA</div>
              <div className="tr-filterRow">
                <button className={`tr-seg ${media === "all" ? "is-active" : ""}`} onClick={() => setMedia("all")}>
                  ALL
                </button>
                <button className={`tr-seg ${media === "ok" ? "is-active" : ""}`} onClick={() => setMedia("ok")}>
                  OK
                </button>
                <button className={`tr-seg ${media === "missing" ? "is-active" : ""}`} onClick={() => setMedia("missing")}>
                  MISSING
                </button>
                <button className={`tr-seg ${media === "my_uploads" ? "is-active" : ""}`} onClick={() => setMedia("my_uploads")}>
                  ⬆︎ MY UPLOADS
                </button>
              </div>
          
            </div>
          </div>
        </div>

        {loading ? (
          <div className="tr-sub">Loading…</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.map((r: any) => {
              const { icon, alt } = resolveRowIcon(r);
              return (
                <button key={r.id} className="tr-rowBtn" onClick={() => navigate(`/library/${r.id}`)}>
                  <div className="tr-rowbox" style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 950, display: "flex", gap: 10, alignItems: "center" }}>
                        {icon ? <img className="tr-ico" src={icon} alt={alt} /> : null}
                        {r.name}
                      </div>

                      {r.effectiveHasMedia ? (
                        <div className="tr-pillOK" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <CheckIcon />
                          OK
                        </div>
                      ) : (
                        <div className="tr-pillMISS" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <AlertIcon />
                          MISSING
                        </div>
                      )}
                    </div>

                    <div className="tr-sub">
                      {(Array.isArray(r.primary_muscles) && r.primary_muscles.length ? r.primary_muscles.join(", ") : "—")} •{" "}
                      {(Array.isArray(r.equipment) && r.equipment.length ? r.equipment.join(", ") : "—")} • {r.source ?? "—"}
                    </div>
                  </div>
                </button>
              );
            })}

            {!filtered.length ? <div className="tr-sub">No results.</div> : null}

            {hasMore ? (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
                <button className="tr-btn tr-btn--primary" style={{ height: 44, minWidth: 220 }} onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* =========================
          CREATE EXERCISE MODAL (unchanged UI)
          ========================= */}
      {createOpen ? (
        <div className="tr-modalOverlay">
          <div className="tr-modal" style={{ width: "min(860px, 100%)" }}>
            <div className="tr-modalHead">
              <div style={{ fontWeight: 950 }}>Create Exercise</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="tr-btn" style={{ height: 44 }} onClick={() => setCreateOpen(false)} disabled={createBusy}>
                  Close
                </button>
              </div>
            </div>

            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <div className="tr-rowbox" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="tr-kicker">EXERCISE NAME (REQUIRED)</div>
                  <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g., Dumbbell Bench Press" style={{ height: 46 }} />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div className="tr-kicker">MUSCLE GROUP (REQUIRED)</div>

                  <div style={{ opacity: isCreateCardio ? 0.45 : 1, pointerEvents: isCreateCardio ? "none" : "auto", filter: isCreateCardio ? "grayscale(0.2)" : "none" }}>
                    <div className="tr-filterRow">
                      {MUSCLE_BUTTONS.filter((x) => x.key !== "all").map((b) => (
                        <button key={b.key} className={`tr-seg ${createMuscle === (b.key as any) ? "is-active" : ""}`} onClick={() => setCreateMuscle(b.key as any)} disabled={createBusy}>
                          {b.icon ? <img className="tr-ico" src={b.icon} alt="" /> : null}
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {isCreateCardio ? <div className="tr-sub">Cardio selected: muscle group is disabled.</div> : null}
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div className="tr-kicker">EQUIPMENT (REQUIRED)</div>
                  <div className="tr-filterRow">
                    {EQUIP_BUTTONS.filter((x) => x.key !== "all").map((b) => (
                      <button key={b.key} className={`tr-seg ${createEquip === (b.key as any) ? "is-active" : ""}`} onClick={() => setCreateEquip(b.key as any)} disabled={createBusy}>
                        {b.icon ? <img className="tr-ico" src={b.icon} alt="" /> : null}
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                {isCreateCardio ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="tr-kicker">DURATION (MINUTES) — REQUIRED FOR CARDIO</div>
                    <input value={createCardioMins} onChange={(e) => setCreateCardioMins(e.target.value.replace(/[^\d]/g, ""))} placeholder="e.g., 10" style={{ height: 46, width: "min(240px, 100%)" }} inputMode="numeric" disabled={createBusy} />
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="tr-kicker">DEFAULTS (STRENGTH)</div>
                    <div className="tr-sub">These defaults are used when you add this exercise into a session.</div>

                    <div className="tr-two">
                      <div>
                        <div className="tr-kicker">SETS</div>
                        <input value={createSets} onChange={(e) => setCreateSets(e.target.value.replace(/[^\d]/g, ""))} style={{ height: 46, width: "100%" }} disabled={createBusy} />
                      </div>
                      <div>
                        <div className="tr-kicker">REST (SECONDS)</div>
                        <input value={createRest} onChange={(e) => setCreateRest(e.target.value.replace(/[^\d]/g, ""))} style={{ height: 46, width: "100%" }} disabled={createBusy} />
                      </div>
                    </div>

                    <div className="tr-two">
                      <div>
                        <div className="tr-kicker">REP MIN</div>
                        <input value={createRepMin} onChange={(e) => setCreateRepMin(e.target.value.replace(/[^\d]/g, ""))} style={{ height: 46, width: "100%" }} disabled={createBusy} />
                      </div>
                      <div>
                        <div className="tr-kicker">REP MAX</div>
                        <input value={createRepMax} onChange={(e) => setCreateRepMax(e.target.value.replace(/[^\d]/g, ""))} style={{ height: 46, width: "100%" }} disabled={createBusy} />
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: "grid", gap: 6 }}>
                  <div className="tr-kicker">NOTES (OPTIONAL)</div>
                  <textarea value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} placeholder="Anything special (form cues, setup, pain notes, etc.)" style={{ width: "100%", minHeight: 110, resize: "vertical" }} disabled={createBusy} />
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button className="tr-btn" style={{ height: 46 }} onClick={() => setCreateOpen(false)} disabled={createBusy}>
                    Cancel
                  </button>
                  <button className="tr-btn tr-btn--primary" style={{ height: 46, minWidth: 220 }} onClick={createExercise} disabled={createBusy}>
                    {createBusy ? "Saving…" : "Save Exercise"}
                  </button>
                </div>

                <div className="tr-sub" style={{ marginTop: 2 }}>
                  After saving, you’ll be taken to the Exercise Detail page to upload media (GIF/video/poster).
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .tr-two{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        @media (max-width: 980px){
          .tr-two{ grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
