import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import {
  detailToPrimaryMuscleTag,
  getMuscleDetailOptions,
  type MuscleDetailKey,
  type MuscleKey,
} from "../../lib/exerciseMatch";

export type CreatedExercise = {
  id: string;
  name: string;
  source?: string | null;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
  equipment?: string[] | null;
  media?: any;
  template_params?: any;
};

type MediaKind = "gif" | "video" | "poster";
type ExerciseMode = "strength" | "cardio";
type CreateMuscleKey = Exclude<MuscleKey, "all" | "quads" | "calves">;

type CreateExerciseModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (
    exercise: CreatedExercise,
    addToSession: boolean
  ) => Promise<void> | void;
  allowAddToSession?: boolean;
  addActionLabel?: string;
};

const MUSCLE_OPTIONS: Array<{ key: CreateMuscleKey; label: string }> = [
  { key: "chest", label: "Chest" },
  { key: "back", label: "Back" },
  { key: "shoulders", label: "Shoulders" },
  { key: "arms", label: "Arms" },
  { key: "abs", label: "Core" },
  { key: "legs", label: "Legs" },
];

const EQUIPMENT_OPTIONS = [
  { key: "machine", label: "Machine" },
  { key: "cable", label: "Cable" },
  { key: "dumbbell", label: "Dumbbell" },
  { key: "barbell", label: "Barbell" },
  { key: "kettlebell", label: "Kettlebell" },
  { key: "body only", label: "Bodyweight" },
  { key: "bands", label: "Resistance Band" },
  { key: "other", label: "Other" },
] as const;

function positiveInt(value: string, fallback: number, minimum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

function safeFileExtension(file: File) {
  const raw = file.name.split(".").pop()?.toLowerCase() || "bin";
  return raw.replace(/[^a-z0-9]/g, "") || "bin";
}

function exactMuscleTag(
  broad: CreateMuscleKey,
  detail: MuscleDetailKey
): string[] {
  if (detail === "front_delts") return ["shoulders", "front delts"];
  if (detail === "side_delts") return ["shoulders", "side delts"];
  if (detail === "rear_delts") return ["shoulders", "rear delts"];
  return [detailToPrimaryMuscleTag(detail, broad)];
}

function lockDocumentForCreateModal() {
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

function MediaPicker({
  kind,
  label,
  file,
  onChange,
  disabled,
}: {
  kind: MediaKind;
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled: boolean;
}) {
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const accept =
    kind === "video"
      ? "video/mp4,video/webm,video/quicktime"
      : kind === "gif"
      ? "image/gif"
      : "image/jpeg,image/png,image/webp";

  return (
    <div className={`tr-createMediaTile ${file ? "has-file" : ""}`}>
      <div className="tr-createMediaPreview">
        {previewUrl ? (
          kind === "video" ? (
            <video src={previewUrl} muted loop autoPlay playsInline />
          ) : (
            <img src={previewUrl} alt={`${label} preview`} />
          )
        ) : (
          <div className="tr-createMediaPlaceholder">No file selected</div>
        )}
      </div>

      <div className="tr-createMediaCopy">
        <div className="tr-kicker">{label}</div>
        <div className="tr-sub tr-createMediaName">
          {file ? file.name : kind === "poster" ? "JPG, PNG, or WEBP" : kind.toUpperCase()}
        </div>
      </div>

      <div className="tr-createMediaActions">
        <label className="tr-btn tr-btn--blueOutline">
          {file ? "Replace" : "Choose File"}
          <input
            type="file"
            accept={accept}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              onChange(next);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {file ? (
          <button className="tr-btn" type="button" onClick={() => onChange(null)} disabled={disabled}>
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CreateExerciseModal({
  open,
  onClose,
  onCreated,
  allowAddToSession = false,
  addActionLabel = "Save & Add to Session",
}: CreateExerciseModalProps) {
  const [mode, setMode] = useState<ExerciseMode>("strength");
  const [name, setName] = useState("");
  const [primaryMuscle, setPrimaryMuscle] = useState<CreateMuscleKey>("back");
  const [primaryDetail, setPrimaryDetail] = useState<MuscleDetailKey>("all");
  const [secondaryEnabled, setSecondaryEnabled] = useState(false);
  const [secondaryMuscle, setSecondaryMuscle] = useState<CreateMuscleKey>("arms");
  const [secondaryDetail, setSecondaryDetail] = useState<MuscleDetailKey>("all");
  const [equipment, setEquipment] = useState("machine");

  const [sets, setSets] = useState("3");
  const [repMin, setRepMin] = useState("8");
  const [repMax, setRepMax] = useState("12");
  const [restSeconds, setRestSeconds] = useState("90");
  const [targetRepsLeft, setTargetRepsLeft] = useState("2");
  const [durationMinutes, setDurationMinutes] = useState("10");

  const [instructions, setInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [gifFile, setGifFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const primaryDetailOptions = useMemo(
    () => getMuscleDetailOptions(primaryMuscle),
    [primaryMuscle]
  );
  const secondaryDetailOptions = useMemo(
    () => getMuscleDetailOptions(secondaryMuscle),
    [secondaryMuscle]
  );

  useEffect(() => {
    if (!open) return;
    return lockDocumentForCreateModal();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setMode("strength");
    setName("");
    setPrimaryMuscle("back");
    setPrimaryDetail("all");
    setSecondaryEnabled(false);
    setSecondaryMuscle("arms");
    setSecondaryDetail("all");
    setEquipment("machine");
    setSets("3");
    setRepMin("8");
    setRepMax("12");
    setRestSeconds("90");
    setTargetRepsLeft("2");
    setDurationMinutes("10");
    setInstructions("");
    setNotes("");
    setGifFile(null);
    setVideoFile(null);
    setPosterFile(null);
    setBusy(false);
    setStatus(null);
    setError(null);
  }, [open]);

  function choosePrimaryMuscle(next: CreateMuscleKey) {
    setPrimaryMuscle(next);
    setPrimaryDetail("all");
  }

  function chooseSecondaryMuscle(next: CreateMuscleKey) {
    setSecondaryMuscle(next);
    setSecondaryDetail("all");
  }

  async function uploadMedia(
    userId: string,
    exerciseId: string,
    kind: MediaKind,
    file: File
  ) {
    const extension = safeFileExtension(file);
    const storagePath = `${userId}/${exerciseId}/${Date.now()}-${kind}.${extension}`;

    const uploadResult = await supabase.storage
      .from("exercise-media")
      .upload(storagePath, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
    if (uploadResult.error) throw uploadResult.error;

    const mediaResult = await supabase.rpc("rpc_exercise_user_media_upsert", {
      p_exercise_id: exerciseId,
      p_kind: kind,
      p_storage_path: storagePath,
      p_mime: file.type || "",
      p_use_user_upload: true,
      p_license: null,
      p_attribution: null,
    });
    if (mediaResult.error) throw mediaResult.error;
  }

  async function submit(addToSession: boolean) {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Exercise name is required.");
      return;
    }

    const setCount = positiveInt(sets, 3, 1);
    const minimumReps = positiveInt(repMin, 8, 1);
    const maximumReps = positiveInt(repMax, 12, 1);
    const rest = positiveInt(restSeconds, 90, 0);
    const repsLeftTarget = Math.min(5, positiveInt(targetRepsLeft, 2, 0));
    const minutes = positiveInt(durationMinutes, 10, 1);

    if (mode === "strength" && minimumReps > maximumReps) {
      setError("Minimum reps cannot be higher than maximum reps.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Creating exercise…");

    let createdExerciseId: string | null = null;

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("Sign in first.");

      const primaryTags =
        mode === "cardio"
          ? ["cardio"]
          : exactMuscleTag(primaryMuscle, primaryDetail);
      const secondaryTags =
        mode === "cardio" || !secondaryEnabled
          ? []
          : exactMuscleTag(secondaryMuscle, secondaryDetail);

      const payload: any = {
        name: cleanName,
        equipment: [mode === "cardio" ? "cardio" : equipment],
        primary_muscles: primaryTags,
        secondary_muscles: secondaryTags,
        description: instructions.trim(),
        notes: notes.trim() || null,
      };

      if (mode === "cardio") {
        payload.duration_minutes = minutes;
      } else {
        payload.sets = setCount;
        payload.rep_min = minimumReps;
        payload.rep_max = maximumReps;
        payload.rest_seconds = rest;
        // The database/RPC still expects a minimum and maximum.
        // Store the single clear target in both fields so the rest of the app
        // remains compatible without asking the user to manage a range.
        payload.rir_min = repsLeftTarget;
        payload.rir_max = repsLeftTarget;
      }

      const createResult = await supabase.rpc("rpc_exercise_create_custom", {
        p_payload: payload,
      });
      if (createResult.error) throw createResult.error;

      createdExerciseId =
        typeof createResult.data === "string"
          ? createResult.data
          : (createResult.data as any)?.id ?? null;
      if (!createdExerciseId) {
        throw new Error("The exercise was created, but no exercise id was returned.");
      }

      const mediaQueue: Array<[MediaKind, File]> = [];
      if (gifFile) mediaQueue.push(["gif", gifFile]);
      if (videoFile) mediaQueue.push(["video", videoFile]);
      if (posterFile) mediaQueue.push(["poster", posterFile]);

      for (let index = 0; index < mediaQueue.length; index += 1) {
        const [kind, file] = mediaQueue[index];
        setStatus(`Uploading ${kind.toUpperCase()} ${index + 1} of ${mediaQueue.length}…`);
        await uploadMedia(userData.user.id, createdExerciseId, kind, file);
      }

      setStatus("Loading saved exercise…");
      const { data: exerciseRow, error: exerciseError } = await supabase
        .from("exercises")
        .select(
          "id,name,source,primary_muscles,secondary_muscles,equipment,media,template_params"
        )
        .eq("id", createdExerciseId)
        .single();
      if (exerciseError) throw exerciseError;

      await onCreated(exerciseRow as CreatedExercise, addToSession);
      setStatus("Exercise saved.");
      onClose();
    } catch (caught: any) {
      const message = caught?.message ?? String(caught);
      setError(
        createdExerciseId
          ? `The exercise was created, but the remaining step failed: ${message}`
          : message
      );
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="tr-modalOverlay tr-modalOverlay--locked tr-createExerciseOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="Create exercise"
    >
      <div className="tr-modal tr-modal--viewport tr-createExerciseModal">
        <div className="tr-modalHead">
          <div style={{ display: "grid", gap: 3 }}>
            <div style={{ fontWeight: 950 }}>Create Exercise</div>
            <div className="tr-sub">
              Add the exercise, its workout defaults, and media in one place.
            </div>
          </div>
          <button className="tr-btn" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="tr-modalBody tr-createExerciseBody">
          {error ? <div className="tr-createExerciseError">{error}</div> : null}
          {status ? <div className="tr-createExerciseStatus">{status}</div> : null}

          <section className="tr-createSection">
            <div className="tr-createSectionHead">
              <div>
                <div className="tr-kicker">BASIC INFORMATION</div>
                <div className="tr-createSectionTitle">Exercise identity</div>
              </div>
              <div className="tr-createModeSwitch">
                <button
                  type="button"
                  className={`tr-seg ${mode === "strength" ? "is-active" : ""}`}
                  onClick={() => setMode("strength")}
                  disabled={busy}
                >
                  Strength
                </button>
                <button
                  type="button"
                  className={`tr-seg ${mode === "cardio" ? "is-active" : ""}`}
                  onClick={() => setMode("cardio")}
                  disabled={busy}
                >
                  Cardio
                </button>
              </div>
            </div>

            <label className="tr-createField tr-createField--full">
              <span>EXERCISE NAME *</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g., Chest-Supported High Row"
                disabled={busy}
              />
            </label>
          </section>

          {mode === "strength" ? (
            <section className="tr-createSection">
              <div className="tr-createSectionHead">
                <div>
                  <div className="tr-kicker">CLASSIFICATION</div>
                  <div className="tr-createSectionTitle">Muscles and equipment</div>
                </div>
              </div>

              <div className="tr-createField">
                <span>PRIMARY MUSCLE GROUP *</span>
                <div className="tr-createChoiceRow">
                  {MUSCLE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`tr-seg ${primaryMuscle === option.key ? "is-active" : ""}`}
                      onClick={() => choosePrimaryMuscle(option.key)}
                      disabled={busy}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {primaryDetailOptions.length > 1 ? (
                <div className="tr-createField">
                  <span>EXACT TARGET</span>
                  <div className="tr-createChoiceRow tr-muscleDetailRow">
                    {primaryDetailOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className={`tr-seg ${primaryDetail === option.key ? "is-active" : ""}`}
                        onClick={() => setPrimaryDetail(option.key)}
                        disabled={busy}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="tr-createSecondaryToggle">
                <label>
                  <input
                    type="checkbox"
                    checked={secondaryEnabled}
                    onChange={(event) => setSecondaryEnabled(event.target.checked)}
                    disabled={busy}
                  />
                  <span>Add a secondary muscle group</span>
                </label>
              </div>

              {secondaryEnabled ? (
                <div className="tr-createSecondaryGrid">
                  <div className="tr-createField">
                    <span>SECONDARY MUSCLE</span>
                    <div className="tr-createChoiceRow">
                      {MUSCLE_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={`tr-seg ${secondaryMuscle === option.key ? "is-active" : ""}`}
                          onClick={() => chooseSecondaryMuscle(option.key)}
                          disabled={busy}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {secondaryDetailOptions.length > 1 ? (
                    <div className="tr-createField">
                      <span>SECONDARY TARGET</span>
                      <div className="tr-createChoiceRow tr-muscleDetailRow">
                        {secondaryDetailOptions.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            className={`tr-seg ${secondaryDetail === option.key ? "is-active" : ""}`}
                            onClick={() => setSecondaryDetail(option.key)}
                            disabled={busy}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="tr-createField">
                <span>EQUIPMENT *</span>
                <div className="tr-createChoiceRow">
                  {EQUIPMENT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`tr-seg ${equipment === option.key ? "is-active" : ""}`}
                      onClick={() => setEquipment(option.key)}
                      disabled={busy}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <section className="tr-createSection">
            <div className="tr-createSectionHead">
              <div>
                <div className="tr-kicker">DEFAULT PRESCRIPTION</div>
                <div className="tr-createSectionTitle">
                  {mode === "cardio" ? "Cardio target" : "Sets, reps, rest, and target effort"}
                </div>
              </div>
            </div>

            {mode === "cardio" ? (
              <div className="tr-createPrescriptionGrid tr-createPrescriptionGrid--cardio">
                <label className="tr-createField">
                  <span>DURATION (MINUTES)</span>
                  <input
                    inputMode="numeric"
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value.replace(/[^\d]/g, ""))}
                    disabled={busy}
                  />
                </label>
              </div>
            ) : (
              <div className="tr-createPrescriptionGrid">
                <label className="tr-createField">
                  <span>SETS</span>
                  <input
                    inputMode="numeric"
                    value={sets}
                    onChange={(event) => setSets(event.target.value.replace(/[^\d]/g, ""))}
                    disabled={busy}
                  />
                </label>
                <label className="tr-createField">
                  <span>REP MIN</span>
                  <input
                    inputMode="numeric"
                    value={repMin}
                    onChange={(event) => setRepMin(event.target.value.replace(/[^\d]/g, ""))}
                    disabled={busy}
                  />
                </label>
                <label className="tr-createField">
                  <span>REP MAX</span>
                  <input
                    inputMode="numeric"
                    value={repMax}
                    onChange={(event) => setRepMax(event.target.value.replace(/[^\d]/g, ""))}
                    disabled={busy}
                  />
                </label>
                <label className="tr-createField">
                  <span>REST (SECONDS)</span>
                  <input
                    inputMode="numeric"
                    value={restSeconds}
                    onChange={(event) => setRestSeconds(event.target.value.replace(/[^\d]/g, ""))}
                    disabled={busy}
                  />
                </label>
                <label className="tr-createField" style={{ gridColumn: "span 2" }}>
                  <span>TARGET REPS LEFT</span>
                  <input
                    inputMode="numeric"
                    value={targetRepsLeft}
                    onChange={(event) =>
                      setTargetRepsLeft(event.target.value.replace(/[^\d]/g, ""))
                    }
                    disabled={busy}
                    aria-describedby="tr-target-reps-left-help"
                  />
                  <div id="tr-target-reps-left-help" className="tr-sub">
                    Default: 2. Finish each working set with about this many clean reps still possible.
                  </div>
                </label>
              </div>
            )}
          </section>

          <section className="tr-createSection">
            <div className="tr-createSectionHead">
              <div>
                <div className="tr-kicker">DEMO MEDIA</div>
                <div className="tr-createSectionTitle">Upload now or add it later</div>
              </div>
            </div>

            <div className="tr-createMediaGrid">
              <MediaPicker
                kind="gif"
                label="DEMO GIF"
                file={gifFile}
                onChange={setGifFile}
                disabled={busy}
              />
              <MediaPicker
                kind="video"
                label="DEMO VIDEO"
                file={videoFile}
                onChange={setVideoFile}
                disabled={busy}
              />
              <MediaPicker
                kind="poster"
                label="COVER IMAGE"
                file={posterFile}
                onChange={setPosterFile}
                disabled={busy}
              />
            </div>
          </section>

          <section className="tr-createSection">
            <div className="tr-createSectionHead">
              <div>
                <div className="tr-kicker">COACHING DETAILS</div>
                <div className="tr-createSectionTitle">Instructions and personal setup</div>
              </div>
            </div>

            <div className="tr-createNotesGrid">
              <label className="tr-createField">
                <span>INSTRUCTIONS / FORM CUES</span>
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="Setup, movement path, and technique cues."
                  disabled={busy}
                />
              </label>
              <label className="tr-createField">
                <span>PERSONAL NOTES</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Seat position, handle setting, comfort notes, or reminders."
                  disabled={busy}
                />
              </label>
            </div>
          </section>
        </div>

        <div className="tr-modalFooter tr-createExerciseFooter">
          <button className="tr-btn" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="tr-btn tr-btn--blueOutline"
            type="button"
            onClick={() => void submit(false)}
            disabled={busy}
          >
            {busy ? "Saving…" : "Save Exercise"}
          </button>
          {allowAddToSession ? (
            <button
              className="tr-btn tr-btn--primary"
              type="button"
              onClick={() => void submit(true)}
              disabled={busy}
            >
              {busy ? "Saving…" : addActionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
