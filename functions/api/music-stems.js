// MVP_V61_GITHUB_DEMUCS_QUEUE
// Free separation backend: Cloudflare validates the signed-in user and queues
// a GitHub Actions CPU Demucs job. The phone never runs Demucs.

const MUSIC_WORKER_URL = "https://mvp-trainer-music-stream.autodetail.workers.dev";
const GITHUB_OWNER = "skyshineauto";
const GITHUB_REPO = "MVPTrainerPro-Personal";
const GITHUB_WORKFLOW = "mvp-v6-stems.yml";
const STEMS = ["vocals", "drums", "bass", "other"];
const ACTIVE_JOB_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function cleanStoragePath(value) {
  return String(value || "").replace(/^\/+/, "").trim();
}

function stemPrefix(trackId, storagePath) {
  const clean = cleanStoragePath(storagePath);
  const owner = clean.includes("/") ? clean.split("/")[0] : "";
  if (!owner || !trackId) throw new Error("Invalid music object path.");
  return `${owner}/stems/${trackId}`;
}

function stemKeys(trackId, storagePath) {
  const prefix = stemPrefix(trackId, storagePath);
  return Object.fromEntries(STEMS.map((stem) => [stem, `${prefix}/${stem}.mp3`]));
}

function jobStatusKey(trackId, storagePath) {
  return `${stemPrefix(trackId, storagePath)}/status.json`;
}

async function workerSign(key, authorization) {
  const response = await fetch(`${MUSIC_WORKER_URL}/sign`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.url) return null;
  return payload;
}

async function signedObjectExists(signed) {
  if (!signed?.url) return false;
  if (Number(signed.size || 0) > 0) return true;
  const probe = await fetch(signed.url, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  }).catch(() => null);
  return Boolean(probe && (probe.status === 200 || probe.status === 206));
}

async function probeBundle(trackId, storagePath, authorization) {
  const keys = stemKeys(trackId, storagePath);
  const signed = {};
  for (const stem of STEMS) {
    const row = await workerSign(keys[stem], authorization);
    if (!row || !(await signedObjectExists(row))) return { ready: false, keys };
    signed[stem] = row.url;
  }
  return { ready: true, keys, bundle: signed };
}

async function workerPutJson(key, value, authorization) {
  const response = await fetch(`${MUSIC_WORKER_URL}/object?key=${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not write Object Audio job status (${response.status}) ${detail}`.trim());
  }
}

async function readJobStatus(trackId, storagePath, authorization) {
  const signed = await workerSign(jobStatusKey(trackId, storagePath), authorization);
  if (!signed || !(await signedObjectExists(signed))) return null;
  const response = await fetch(signed.url, { cf: { cacheTtl: 0 } }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === "object" ? payload : null;
}

function jobIsStillActive(status) {
  if (!status || (status.status !== "queued" && status.status !== "processing")) return false;
  const updated = Date.parse(String(status.updatedAt || status.createdAt || ""));
  return Number.isFinite(updated) && Date.now() - updated < ACTIVE_JOB_MAX_AGE_MS;
}

async function dispatchStemJob(token, trackId, storagePath, jobId) {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "MVPTrainerPro-V6-Stems",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          track_id: trackId,
          storage_path: storagePath,
          job_id: jobId,
        },
      }),
    },
  );

  if (response.status === 204) return;
  const detail = await response.text().catch(() => "");
  throw new Error(`GitHub stem queue failed (${response.status}) ${detail}`.trim());
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "Sign in before preparing Object Audio." }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const action = String(body.action || "");
  const trackId = String(body.trackId || "").trim();
  const storagePath = cleanStoragePath(body.storagePath);
  if (!trackId || !storagePath) {
    return json({ error: "Track information is missing." }, 400);
  }

  try {
    if (action === "probe") {
      const probe = await probeBundle(trackId, storagePath, authorization);
      return json(
        probe.ready
          ? { ok: true, status: "ready", bundle: probe.bundle }
          : { ok: true, status: "missing" },
      );
    }

    if (action === "start") {
      const existing = await probeBundle(trackId, storagePath, authorization);
      if (existing.ready) {
        return json({ ok: true, status: "ready", bundle: existing.bundle });
      }

      // This also proves that the signed-in user is allowed to access the
      // original private music object before any GitHub job is queued.
      const original = await workerSign(storagePath, authorization);
      if (!original?.url || !(await signedObjectExists(original))) {
        return json({ error: "Could not authorize the source track." }, 403);
      }

      const prior = await readJobStatus(trackId, storagePath, authorization);
      if (jobIsStillActive(prior)) {
        return json({
          ok: true,
          status: String(prior.status || "processing"),
          predictionId: String(prior.jobId || trackId),
        });
      }

      const token = String(env.GITHUB_STEM_TOKEN || "").trim();
      if (!token) {
        return json(
          {
            error:
              "Object Audio queue is not configured yet. Add GITHUB_STEM_TOKEN to Cloudflare Pages secrets.",
          },
          503,
        );
      }

      const jobId = crypto.randomUUID();
      const queuedAt = new Date().toISOString();
      await workerPutJson(
        jobStatusKey(trackId, storagePath),
        {
          status: "queued",
          jobId,
          trackId,
          createdAt: queuedAt,
          updatedAt: queuedAt,
        },
        authorization,
      );

      try {
        await dispatchStemJob(token, trackId, storagePath, jobId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await workerPutJson(
          jobStatusKey(trackId, storagePath),
          {
            status: "failed",
            jobId,
            trackId,
            error: message,
            updatedAt: new Date().toISOString(),
          },
          authorization,
        ).catch(() => {});
        throw error;
      }

      return json({ ok: true, status: "queued", predictionId: jobId });
    }

    if (action === "status") {
      const existing = await probeBundle(trackId, storagePath, authorization);
      if (existing.ready) {
        return json({ ok: true, status: "ready", bundle: existing.bundle });
      }

      const job = await readJobStatus(trackId, storagePath, authorization);
      if (job?.status === "failed") {
        return json({
          ok: false,
          status: "failed",
          error: String(job.error || "Object Audio separation failed."),
        });
      }

      if (job?.status === "queued" || job?.status === "processing") {
        return json({ ok: true, status: job.status });
      }

      return json({ ok: true, status: "processing" });
    }

    return json({ error: "Unsupported Object Audio action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
