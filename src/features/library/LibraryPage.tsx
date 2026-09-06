import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";

import {
  effectiveHasMedia,
  getMuscleDetailOptions,
  matchFilters,
  resolveRowIcon,
  type EquipKey,
  type MuscleDetailKey,
  type MuscleKey,
  type UserMediaLite,
} from "../../lib/exerciseMatch";
import { AlertIcon, CheckIcon } from "../../lib/exerciseIcons";
import { rankExercises } from "../../lib/exerciseSearch";
import { applyExerciseNameOverrides } from "../../lib/exerciseNames";
import { CreateExerciseModal } from "./CreateExerciseModal";

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
  secondary_muscles?: string[] | null;
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

const PAGE_SIZE = 1000;
const DESKTOP_BATCH_SIZE = 15;
const MOBILE_BATCH_SIZE = 10;

function currentDisplayBatchSize() {
  if (typeof window === "undefined") return DESKTOP_BATCH_SIZE;
  return window.matchMedia("(max-width: 720px)").matches ? MOBILE_BATCH_SIZE : DESKTOP_BATCH_SIZE;
}

function prettyMeta(value: string) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMetaList(values: string[] | null | undefined, fallback: string) {
  const list = Array.isArray(values) ? values.filter(Boolean).map(prettyMeta) : [];
  return list.length ? list.join(", ") : fallback;
}


export function LibraryPage({ navigate }: { navigate: (to: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");

  const [muscle, setMuscle] = useState<MuscleKey>("all");
  const [muscleDetail, setMuscleDetail] = useState<MuscleDetailKey>("all");
  const [equip, setEquip] = useState<EquipKey>("all");
  const [media, setMedia] = useState<MediaKey>("all");

  const [rows, setRows] = useState<ExRow[]>([]);
  const [userMediaRows, setUserMediaRows] = useState<UserMediaRow[]>([]);

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [displayBatchSize, setDisplayBatchSize] = useState(currentDisplayBatchSize);
  const [visibleCount, setVisibleCount] = useState(currentDisplayBatchSize);

  const [toast, setToast] = useState<ToastState>({ open: false, tone: "ok", text: "" });
  const toastTimer = useRef<any>(null);

  function showToast(text: string, tone: ToastTone = "ok") {
    try {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    } catch {}
    setToast({ open: true, tone, text });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), 2400);
  }

  const [createOpen, setCreateOpen] = useState(false);

  const muscleDetailOptions = useMemo(() => getMuscleDetailOptions(muscle), [muscle]);

  function selectMuscle(next: MuscleKey) {
    setMuscle(next);
    setMuscleDetail("all");
  }

  function openCreate() {
    setCreateOpen(true);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 720px)");
    const sync = () => setDisplayBatchSize(query.matches ? MOBILE_BATCH_SIZE : DESKTOP_BATCH_SIZE);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    setVisibleCount(displayBatchSize);
  }, [q, muscle, muscleDetail, equip, media, displayBatchSize]);

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
    const ranked = rankExercises(decorated as any[], q.trim());
    return ranked.filter((r: any) => {
      if (!matchFilters(r, muscle, equip, muscleDetail)) return false;

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
  }, [decorated, q, muscle, muscleDetail, equip, media, userMediaByExercise]);

  const visibleRows = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const missingCount = useMemo(() => filtered.filter((r: any) => !r.effectiveHasMedia).length, [filtered]);
  const okCount = useMemo(() => filtered.filter((r: any) => r.effectiveHasMedia).length, [filtered]);
  const hasMoreVisible = visibleRows.length < filtered.length || hasMore;

  function resetPaging() {
    setRows([]);
    setUserMediaRows([]);
    setPage(0);
    setHasMore(true);
  }

  async function fetchPage(nextPage: number) {
    const from = nextPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("exercises")
      .select("id,name,source,primary_muscles,secondary_muscles,equipment,media,template_params")
      .order("name", { ascending: true })
      .range(from, to);

    const { data: exs, error: exErr } = await query;
    if (exErr) throw exErr;

    const list = await applyExerciseNameOverrides((exs ?? []) as ExRow[]);

    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr) throw uErr;
    if (!u.user) throw new Error("Sign in first.");

    const ids = list.map((x) => x.id).filter(Boolean);
    const um: any[] = [];
    const chunkSize = 80;

    for (let start = 0; start < ids.length; start += chunkSize) {
      const chunk = ids.slice(start, start + chunkSize);
      const { data: umData, error: umErr } = await supabase
        .from("exercise_user_media")
        .select("exercise_id,kind,storage_path,use_user_upload")
        .eq("user_id", u.user.id)
        .in("exercise_id", chunk);
      if (umErr) throw umErr;
      um.push(...(umData ?? []));
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

  async function loadMoreServerPage() {
    if (!hasMore || loadingMore) return false;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const { list, um, reachedEnd } = await fetchPage(next);
      setRows((prev) => [...prev, ...list]);
      setUserMediaRows((prev) => [...prev, ...(um as any[])]);
      setHasMore(!reachedEnd);
      setPage(next);
      return list.length > 0;
    } catch (e: any) {
      showToast(e?.message ?? "Load more failed", "err");
      setHasMore(false);
      return false;
    } finally {
      setLoadingMore(false);
    }
  }

  async function showMoreExercises() {
    if (loadingMore) return;

    if (visibleCount < filtered.length) {
      setVisibleCount((current) => current + displayBatchSize);
      return;
    }

    if (hasMore) {
      const loaded = await loadMoreServerPage();
      if (loaded) setVisibleCount((current) => current + displayBatchSize);
    }
  }

  useEffect(() => {
    void loadInitial();
  }, []);


  return (
    <div className="tr-exerciseLibraryPage">
      <Toast toast={toast} onClose={() => setToast((t) => ({ ...t, open: false }))} />

      <Card
        title="Exercise Library"
        tone="blue"
        right={
          <div className="tr-exerciseLibraryHeaderCount">
            <strong>{filtered.length}</strong>
            <span>EXERCISES</span>
          </div>
        }
      >
        {err ? (
          <div className="tr-rowbox" style={{ borderColor: "rgba(255,80,80,.35)", background: "rgba(255,80,80,.10)" }}>
            {err}
          </div>
        ) : null}

        <section className="tr-exerciseLibraryControlDeck">
          <div className="tr-exerciseLibraryPrimaryBar">
            <label className="tr-exerciseLibrarySearch">
              <span className="tr-filterLabel">SEARCH LIBRARY</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search exercises, muscles, equipment…"
              />
            </label>

            <button className="tr-btn tr-btn--primary tr-exerciseLibraryAdd" onClick={openCreate}>
              + ADD EXERCISE
            </button>
          </div>

          <div className="tr-exerciseLibrarySummary" aria-label="Exercise library status">
            <div className="tr-exerciseLibrarySummaryCell">
              <span>RESULTS</span>
              <strong>{filtered.length}</strong>
              <small>MATCHING EXERCISES</small>
            </div>
            <div className="tr-exerciseLibrarySummaryCell is-ready">
              <span>READY</span>
              <strong>{okCount}</strong>
              <small>MEDIA COMPLETE</small>
            </div>
            <div className="tr-exerciseLibrarySummaryCell is-media">
              <span>NEED MEDIA</span>
              <strong>{missingCount}</strong>
              <small>REQUIRES ATTENTION</small>
            </div>
          </div>

          <div className="tr-exerciseLibraryFilterDeck">
            <div className="tr-filterGroup">
              <div className="tr-filterLabel">MUSCLE</div>
              <div className="tr-filterRow">
                {MUSCLE_BUTTONS.map((b) => (
                  <button key={b.key} className={`tr-seg ${muscle === b.key ? "is-active" : ""}`} onClick={() => selectMuscle(b.key)}>
                    {b.icon ? <img className="tr-ico" src={b.icon} alt="" /> : null}
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {muscleDetailOptions.length > 1 ? (
              <div className="tr-filterGroup tr-muscleDetailGroup">
                <div className="tr-filterLabel">TARGET MUSCLE</div>
                <div className="tr-filterRow tr-muscleDetailRow">
                  {muscleDetailOptions.map((option) => (
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

            <div className="tr-exerciseLibraryFilterSplit">
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
                    READY
                  </button>
                  <button className={`tr-seg ${media === "missing" ? "is-active" : ""}`} onClick={() => setMedia("missing")}>
                    NEEDS MEDIA
                  </button>
                  <button className={`tr-seg ${media === "my_uploads" ? "is-active" : ""}`} onClick={() => setMedia("my_uploads")}>
                    ⬆︎ MY UPLOADS
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="tr-exerciseLibraryLoading">Loading exercise library…</div>
        ) : (
          <section className="tr-exerciseLibraryResults">
            <div className="tr-exerciseLibraryResultsHead">
              <div>
                <span className="tr-kicker">EXERCISES</span>
                <strong>{visibleRows.length} OF {filtered.length}</strong>
              </div>
              <span>{media === "missing" ? "MEDIA WORKFLOW" : "SELECT AN EXERCISE TO OPEN"}</span>
            </div>

            <div className="tr-exerciseLibraryList">
              {visibleRows.map((r: any) => {
                const { icon, alt } = resolveRowIcon(r);
                return (
                  <button key={r.id} className="tr-rowBtn tr-exerciseLibraryRowBtn" onClick={() => navigate(`/library/${r.id}`)}>
                    <div className={`tr-exerciseLibraryRow ${r.effectiveHasMedia ? "is-ready" : "is-missing"}`}>
                      <div className="tr-exerciseLibraryRowIcon">
                        {icon ? <img className="tr-ico" src={icon} alt={alt} /> : <span aria-hidden>•</span>}
                      </div>

                      <div className="tr-exerciseLibraryRowCopy">
                        <strong>{r.name}</strong>
                        <span>
                          {formatMetaList(r.primary_muscles, "General")} • {formatMetaList(r.equipment, "Other")}
                        </span>
                      </div>

                      {r.effectiveHasMedia ? (
                        <div className="tr-exerciseLibraryStatus is-ready">
                          <CheckIcon />
                          <span>READY</span>
                        </div>
                      ) : (
                        <div className="tr-exerciseLibraryStatus is-missing">
                          <AlertIcon />
                          <span>NEEDS MEDIA</span>
                        </div>
                      )}

                      <span className="tr-exerciseLibraryChevron" aria-hidden>›</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {!filtered.length ? (
              <div className="tr-exerciseLibraryEmpty">
                <strong>NO MATCHING EXERCISES</strong>
                <span>Adjust the search or filters to broaden the library.</span>
              </div>
            ) : null}

            {filtered.length ? (
              <div className="tr-exerciseLibraryBatchFooter">
                <div className="tr-exerciseLibraryBatchMeta">
                  <strong>{Math.min(visibleRows.length, filtered.length)} OF {filtered.length} EXERCISES</strong>
                  <span>{hasMoreVisible ? `${displayBatchSize} MORE PER LOAD` : "ALL MATCHING EXERCISES LOADED"}</span>
                </div>

                <div className="tr-exerciseLibraryBatchTrack" aria-hidden>
                  <span style={{ width: `${filtered.length ? Math.min(100, (visibleRows.length / filtered.length) * 100) : 0}%` }} />
                </div>

                {hasMoreVisible ? (
                  <button className="tr-btn tr-btn--primary tr-exerciseLibraryLoadMore" onClick={() => void showMoreExercises()} disabled={loadingMore}>
                    {loadingMore ? "LOADING…" : `LOAD ${displayBatchSize} MORE`}
                  </button>
                ) : (
                  <div className="tr-exerciseLibraryLoaded">✓ ALL MATCHING EXERCISES LOADED</div>
                )}
              </div>
            ) : null}
          </section>
        )}
      </Card>

      <CreateExerciseModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (exercise) => {
          showToast("EXERCISE CREATED WITH DEFAULTS AND MEDIA.", "ok");
          setQ(exercise.name);
          await loadInitial();
        }}
      />
    </div>
  );
}
