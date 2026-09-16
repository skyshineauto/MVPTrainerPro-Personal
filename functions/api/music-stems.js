const MUSIC_WORKER_URL = "https://mvp-trainer-music-stream.autodetail.workers.dev";
const REPLICATE_VERSION = "abf8fe28e407afa6d8e41e86a759caccc0af8e49c3c68016006b62cb0968441e";
const STEMS = ["vocals", "drums", "bass", "other"];

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

function stemKeys(trackId, storagePath) {
  const clean = cleanStoragePath(storagePath);
  const owner = clean.includes("/") ? clean.split("/")[0] : "";
  if (!owner || !trackId) throw new Error("Invalid music object path.");
  const prefix = `${owner}/stems/${trackId}`;
  return Object.fromEntries(STEMS.map((stem) => [stem, `${prefix}/${stem}.mp3`]));
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

async function workerUpload(key, sourceUrl, authorization) {
  const source = await fetch(sourceUrl, { cf: { cacheTtl: 0 } });
  if (!source.ok) throw new Error(`Could not download separated stem (${source.status}).`);
  const bytes = await source.arrayBuffer();
  const response = await fetch(`${MUSIC_WORKER_URL}/object?key=${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": source.headers.get("content-type") || "audio/mpeg",
    },
    body: bytes,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not store separated stem (${response.status}) ${detail}`.trim());
  }
}

async function replicatePrediction(id, token) {
  const response = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.detail || payload?.error || `Replicate status failed (${response.status}).`);
  return payload;
}

function outputUrl(output, stem) {
  const value = output?.[stem];
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.url === "string") return value.url;
  return "";
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in before preparing Object Audio." }, 401);

  const token = String(env.REPLICATE_API_TOKEN || "").trim();
  if (!token) return json({ error: "Object Audio is not configured yet. Add REPLICATE_API_TOKEN to Cloudflare Pages environment variables." }, 503);

  let body = {};
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const action = String(body.action || "");
  const trackId = String(body.trackId || "").trim();
  const storagePath = cleanStoragePath(body.storagePath);
  if (!trackId || !storagePath) return json({ error: "Track information is missing." }, 400);

  try {
    if (action === "probe") {
      const probe = await probeBundle(trackId, storagePath, authorization);
      return json(probe.ready ? { ok: true, status: "ready", bundle: probe.bundle } : { ok: true, status: "missing" });
    }

    if (action === "start") {
      const existing = await probeBundle(trackId, storagePath, authorization);
      if (existing.ready) return json({ ok: true, status: "ready", bundle: existing.bundle });

      // Signing the original through the existing worker proves the caller owns
      // the music object and gives Replicate a temporary HTTPS source URL.
      const original = await workerSign(storagePath, authorization);
      if (!original?.url) return json({ error: "Could not authorize the source track." }, 403);

      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Cancel-After": "15m",
        },
        body: JSON.stringify({
          version: REPLICATE_VERSION,
          input: {
            audio: original.url,
            model_name: "htdemucs",
            shifts: 1,
            overlap: 0.25,
            clip_mode: "rescale",
            output_format: "mp3",
            mp3_bitrate: 320,
          },
        }),
      });

      const prediction = await response.json().catch(() => ({}));
      if (!response.ok || !prediction?.id) {
        return json({ error: prediction?.detail || prediction?.error || `Stem separation failed to start (${response.status}).` }, 502);
      }

      return json({ ok: true, status: prediction.status || "starting", predictionId: prediction.id });
    }

    if (action === "status") {
      const predictionId = String(body.predictionId || "").trim();
      if (!predictionId) return json({ error: "Prediction ID is missing." }, 400);

      const prediction = await replicatePrediction(predictionId, token);
      const status = String(prediction.status || "processing");

      if (status === "failed" || status === "canceled") {
        return json({ ok: false, status, error: prediction.error || `Object Audio ${status}.` });
      }

      if (status !== "succeeded" && status !== "successful") {
        return json({ ok: true, status });
      }

      const existing = await probeBundle(trackId, storagePath, authorization);
      if (existing.ready) return json({ ok: true, status: "ready", bundle: existing.bundle });

      const keys = stemKeys(trackId, storagePath);
      const output = prediction.output || {};
      for (const stem of STEMS) {
        const url = outputUrl(output, stem);
        if (!url) throw new Error(`Demucs did not return the ${stem} stem.`);
        await workerUpload(keys[stem], url, authorization);
      }

      const ready = await probeBundle(trackId, storagePath, authorization);
      if (!ready.ready) throw new Error("Separated stems uploaded but could not be verified.");
      return json({ ok: true, status: "ready", bundle: ready.bundle });
    }

    return json({ error: "Unsupported Object Audio action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
