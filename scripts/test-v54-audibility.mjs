import fs from "node:fs";

const wasmPath =
  process.argv[2] ||
  "public/audioV2/mvpHdV2.wasm";

const bytes =
  fs.readFileSync(wasmPath);

const imports = {
  env: {
    sin: Math.sin,
    cos: Math.cos,
    pow: Math.pow,
    exp: Math.exp,
    log10: Math.log10,
  },
};

const sr = 48000;

async function inst() {
  const { instance } =
    await WebAssembly.instantiate(
      bytes,
      imports,
    );

  const e = instance.exports;

  if (e.mvp_v2_init(sr) !== 1) {
    throw new Error("init");
  }

  return e;
}

function signal(
  type = "dynamic",
  sec = 3,
) {
  const n =
    Math.floor(sr * sec);

  const L =
    new Float32Array(n);

  const R =
    new Float32Array(n);

  for (
    let i = 0;
    i < n;
    i += 1
  ) {
    const t = i / sr;

    let env = 1;

    if (type === "dynamic") {
      const beat =
        t % 0.5;

      env =
        0.46 +
        (
          beat < 0.028
            ? Math.exp(
                -beat * 90,
              )
            : 0
        );
    } else if (
      type === "hot"
    ) {
      env = 0.92;
    } else if (
      type === "brick"
    ) {
      env = 1.15;
    }

    let x =
      0.30 *
        Math.sin(
          2 *
            Math.PI *
            50 *
            t,
        ) +
      0.22 *
        Math.sin(
          2 *
            Math.PI *
            110 *
            t,
        ) +
      0.18 *
        Math.sin(
          2 *
            Math.PI *
            1000 *
            t,
        ) +
      0.12 *
        Math.sin(
          2 *
            Math.PI *
            3400 *
            t,
        ) +
      0.08 *
        Math.sin(
          2 *
            Math.PI *
            9000 *
            t,
        );

    let y =
      0.28 *
        Math.sin(
          2 *
            Math.PI *
            50 *
            t +
            0.03,
        ) +
      0.20 *
        Math.sin(
          2 *
            Math.PI *
            110 *
            t +
            0.1,
        ) +
      0.18 *
        Math.sin(
          2 *
            Math.PI *
            1000 *
            t +
            0.15,
        ) +
      0.11 *
        Math.sin(
          2 *
            Math.PI *
            3400 *
            t +
            0.4,
        ) +
      0.07 *
        Math.sin(
          2 *
            Math.PI *
            9000 *
            t +
            0.7,
        );

    x *= env;
    y *= env;

    if (type === "brick") {
      x =
        Math.max(
          -0.94,
          Math.min(
            0.94,
            x * 1.65,
          ),
        );

      y =
        Math.max(
          -0.94,
          Math.min(
            0.94,
            y * 1.65,
          ),
        );
    }

    L[i] = x;
    R[i] = y;
  }

  return { L, R };
}

async function render(
  opts = {},
) {
  const e =
    await inst();

  e.mvp_v2_set_output_profile(
    opts.profile ?? 1,
  );

  e.mvp_v2_set_mode(
    opts.mode ?? 1,
  );

  e.mvp_v2_set_intensity(
    opts.intensity ?? 0.72,
  );

  e.mvp_v2_set_bass_enabled(
    opts.bass ? 1 : 0,
  );

  e.mvp_v2_set_bass_character(
    opts.bassChar ?? 0.5,
  );

  e.mvp_v2_set_impact_enabled(
    opts.impact ? 1 : 0,
  );

  e.mvp_v2_set_clarity_enabled(
    opts.clarity ? 1 : 0,
  );

  e.mvp_v2_set_spatial_enabled(
    opts.spatial ? 1 : 0,
  );

  e.mvp_v2_set_space_mode(
    opts.spaceMode ?? 0,
  );

  e.mvp_v2_set_personal_enabled(
    opts.personal ? 1 : 0,
  );

  e.mvp_v2_set_personal_bass(
    opts.pb ?? 0,
  );

  e.mvp_v2_set_personal_presence(
    opts.pp ?? 0,
  );

  e.mvp_v2_set_personal_brightness(
    opts.pbr ?? 0,
  );

  if (opts.master) {
    e.mvp_v2_set_master_prep(
      1,
      opts.master.sourceGainDb ??
        1,
      opts.master.highpassHz ??
        22,
      opts.master.lowMidDb ??
        -0.5,
      opts.master.presenceDb ??
        0.7,
      opts.master.harshnessDb ??
        -0.8,
      opts.master.balanceDb ??
        0,
      opts.master.widthScale ??
        1.03,
    );
  }

  if (opts.eq) {
    e.mvp_v2_set_eq_enabled(1);

    for (
      const [idx, gain] of
      opts.eq
    ) {
      e.mvp_v2_set_eq_band(
        idx,
        gain,
      );
    }
  }

  const sig =
    signal(
      opts.signal ??
        "dynamic",
      opts.sec ?? 3,
    );

  const n =
    sig.L.length;

  const outL =
    new Float32Array(n);

  const outR =
    new Float32Array(n);

  const max =
    e.mvp_v2_max_frames();

  const mem =
    e.memory;

  const li =
    new Float32Array(
      mem.buffer,
      e.mvp_v2_input_l(),
      max,
    );

  const ri =
    new Float32Array(
      mem.buffer,
      e.mvp_v2_input_r(),
      max,
    );

  const lo =
    new Float32Array(
      mem.buffer,
      e.mvp_v2_output_l(),
      max,
    );

  const ro =
    new Float32Array(
      mem.buffer,
      e.mvp_v2_output_r(),
      max,
    );

  for (
    let off = 0;
    off < n;
    off += max
  ) {
    const m =
      Math.min(
        max,
        n - off,
      );

    li.fill(0);
    ri.fill(0);

    li.set(
      sig.L.subarray(
        off,
        off + m,
      ),
    );

    ri.set(
      sig.R.subarray(
        off,
        off + m,
      ),
    );

    if (
      e.mvp_v2_process(m) !==
      1
    ) {
      throw new Error(
        "process",
      );
    }

    outL.set(
      lo.subarray(0, m),
      off,
    );

    outR.set(
      ro.subarray(0, m),
      off,
    );
  }

  return {
    L: outL,
    R: outR,

    buildId:
      typeof e.mvp_v2_build_id ===
      "function"
        ? Number(
            e.mvp_v2_build_id(),
          )
        : 0,

    tp:
      Number(
        e.mvp_v2_meter_true_peak_dbtp(),
      ),

    lim:
      Number(
        e.mvp_v2_meter_limiter_gr_db(),
      ),

    clips:
      Number(
        e.mvp_v2_meter_clip_count(),
      ),

    nans:
      Number(
        e.mvp_v2_meter_nan_count(),
      ),

    impact:
      Number(
        e.mvp_v2_meter_impact_boost_db(),
      ),

    width:
      Number(
        e.mvp_v2_meter_spatial_width_percent(),
      ),
  };
}

const skip = 4096;

function rms(o) {
  let sum = 0;
  let n = 0;

  for (
    let i = skip;
    i < o.L.length;
    i += 1
  ) {
    sum +=
      o.L[i] * o.L[i] +
      o.R[i] * o.R[i];

    n += 2;
  }

  return Math.sqrt(
    sum /
      Math.max(1, n),
  );
}

function sideRms(o) {
  let sum = 0;
  let n = 0;

  for (
    let i = skip;
    i < o.L.length;
    i += 1
  ) {
    const side =
      (o.L[i] -
        o.R[i]) *
      0.5;

    sum +=
      side * side;

    n += 1;
  }

  return Math.sqrt(
    sum /
      Math.max(1, n),
  );
}

function db(value) {
  return (
    20 *
    Math.log10(
      Math.max(
        1e-12,
        value,
      ),
    )
  );
}

function mag(
  o,
  frequency,
  side = false,
) {
  let cr = 0;
  let ci = 0;
  let n = 0;

  for (
    let i = skip;
    i < o.L.length;
    i += 1
  ) {
    const x =
      side
        ? (
            o.L[i] -
            o.R[i]
          ) *
          0.5
        : (
            o.L[i] +
            o.R[i]
          ) *
          0.5;

    const a =
      2 *
      Math.PI *
      frequency *
      i /
      sr;

    cr +=
      x * Math.cos(a);

    ci -=
      x * Math.sin(a);

    n += 1;
  }

  return (
    2 *
    Math.hypot(cr, ci) /
    Math.max(1, n)
  );
}

function transientRatio(o) {
  let transientSum = 0;
  let transientN = 0;

  let sustainSum = 0;
  let sustainN = 0;

  for (
    let i = skip;
    i < o.L.length;
    i += 1
  ) {
    const beat =
      (i / sr) % 0.5;

    const x =
      (
        o.L[i] +
        o.R[i]
      ) *
      0.5;

    if (beat < 0.02) {
      transientSum +=
        x * x;

      transientN += 1;
    } else if (
      beat > 0.12 &&
      beat < 0.32
    ) {
      sustainSum +=
        x * x;

      sustainN += 1;
    }
  }

  const transient =
    Math.sqrt(
      transientSum /
        Math.max(
          1,
          transientN,
        ),
    );

  const sustain =
    Math.sqrt(
      sustainSum /
        Math.max(
          1,
          sustainN,
        ),
    );

  return (
    transient /
    Math.max(
      1e-12,
      sustain,
    )
  );
}

const cases = [];

function add(
  name,
  pass,
  data,
) {
  const row = {
    name,
    pass:
      Boolean(pass),
    data,
  };

  cases.push(row);

  console.log(
    row.pass
      ? "PASS"
      : "FAIL",
    name,
    data,
  );
}

function safety(
  output,
) {
  return (
    output.clips === 0 &&
    output.nans === 0 &&
    output.tp <= -0.30 &&
    output.lim < 9.5
  );
}

//
// BUILD ID
//

const buildProbe =
  await render({
    mode: 1,
    signal: "dynamic",
  });

add(
  "V5.8 correct WASM build",
  buildProbe.buildId === 5800,
  {
    buildId:
      buildProbe.buildId,
  },
);

//
// ORIGINAL MODE + SAFETY CONTRACT
//

for (
  const signalName of [
    "dynamic",
    "hot",
    "brick",
  ]
) {
  const pure =
    await render({
      mode: 0,
      signal: signalName,
    });

  const adaptive =
    await render({
      mode: 1,
      intensity: 0.78,
      signal: signalName,
    });

  const power =
    await render({
      mode: 2,
      intensity: 0.78,
      signal: signalName,
    });

  const adaptiveDelta =
    db(
      rms(adaptive) /
      rms(pure),
    );

  const powerDelta =
    db(
      rms(power) /
      rms(adaptive),
    );

  const powerPresence =
    db(
      mag(power, 3400) /
      mag(adaptive, 3400),
    );

  add(
    signalName + ' modes differ',
    Math.abs(
      adaptiveDelta,
    ) > 0.25 &&
      (
        Math.abs(
          powerDelta,
        ) > 0.35 ||
        Math.abs(
          powerPresence,
        ) > 0.5
      ),
    {
      adaptiveDelta,
      powerDelta,
      powerPresence,
    },
  );

  add(
    signalName + ' safe',
    safety(power),
    {
      tp:
        power.tp,
      limiter:
        power.lim,
      clips:
        power.clips,
      nans:
        power.nans,
    },
  );
}

//
// INTENSITY
//

const intensity0 =
  await render({
    mode: 2,
    intensity: 0,
    signal: "hot",
  });

const intensity1 =
  await render({
    mode: 2,
    intensity: 1,
    signal: "hot",
  });

add(
  "intensity changes power",
  Math.abs(
    db(
      rms(intensity1) /
      rms(intensity0),
    ),
  ) > 0.30 ||
    Math.abs(
      db(
        mag(
          intensity1,
          3400,
        ) /
        mag(
          intensity0,
          3400,
        ),
      ),
    ) > 0.70,
  {
    rms:
      db(
        rms(intensity1) /
        rms(intensity0),
      ),

    presence:
      db(
        mag(
          intensity1,
          3400,
        ) /
        mag(
          intensity0,
          3400,
        ),
      ),
  },
);

//
// BASS
//

for (
  const sig of [
    "dynamic",
    "hot",
    "brick",
  ]
) {
  const off =
    await render({
      mode: 2,
      intensity: 0.78,
      signal: sig,
    });

  const on =
    await render({
      mode: 2,
      intensity: 0.78,
      bass: true,
      bassChar: 0.6,
      signal: sig,
    });

  const bassDelta =
    db(
      (
        mag(on, 50) +
        mag(on, 110)
      ) /
      (
        mag(off, 50) +
        mag(off, 110)
      ),
    );

  add(
    sig + ' bass audible',
    bassDelta > 0.55 &&
      safety(on),
    {
      bassDelta,
      limiter:
        on.lim,
      tp:
        on.tp,
    },
  );
}

const tight =
  await render({
    mode: 2,
    bass: true,
    bassChar: 0,
    signal: "dynamic",
  });

const deep =
  await render({
    mode: 2,
    bass: true,
    bassChar: 1,
    signal: "dynamic",
  });

add(
  "tight deep direction",
  db(
    (
      mag(deep, 50) /
      mag(deep, 110)
    ) /
    (
      mag(tight, 50) /
      mag(tight, 110)
    ),
  ) > 0.8,
  {
    delta:
      db(
        (
          mag(deep, 50) /
          mag(deep, 110)
        ) /
        (
          mag(tight, 50) /
          mag(tight, 110)
        ),
      ),
  },
);

//
// CLARITY
//

for (
  const sig of [
    "dynamic",
    "hot",
    "brick",
  ]
) {
  const off =
    await render({
      mode: 2,
      intensity: 0.78,
      signal: sig,
    });

  const on =
    await render({
      mode: 2,
      intensity: 0.78,
      clarity: true,
      signal: sig,
    });

  const clarityDelta =
    db(
      (
        mag(on, 3400) +
        mag(on, 9000)
      ) /
      (
        mag(off, 3400) +
        mag(off, 9000)
      ),
    );

  add(
    sig + ' clarity audible',
    clarityDelta > 0.55 &&
      safety(on),
    {
      clarityDelta,
      limiter:
        on.lim,
      tp:
        on.tp,
    },
  );
}

//
// IMPACT
//

const impactOff =
  await render({
    mode: 2,
    intensity: 1,
    profile: 1,
    signal: "dynamic",
  });

const impactOn =
  await render({
    mode: 2,
    intensity: 1,
    profile: 1,
    impact: true,
    signal: "dynamic",
  });

const impactDelta =
  db(
    transientRatio(
      impactOn,
    ) /
    transientRatio(
      impactOff,
    ),
  );

add(
  "Impact obvious",
  impactDelta > 0.25 &&
    impactOn.impact > 0.35 &&
    safety(impactOn),
  {
    transientDelta:
      impactDelta,

    meterBoost:
      impactOn.impact,

    limiter:
      impactOn.lim,
  },
);

//
// SPATIAL / IMMERSION
//

const spatialOff =
  await render({
    mode: 2,
    profile: 1,
    intensity: 1,
    signal: "dynamic",
  });

const spatialOn =
  await render({
    mode: 2,
    profile: 1,
    intensity: 1,
    spatial: true,
    spaceMode: 1,
    signal: "dynamic",
  });

add(
  "Immersion increases total side energy",
  db(
    sideRms(
      spatialOn,
    ) /
    sideRms(
      spatialOff,
    ),
  ) > 0.60 &&
    spatialOn.width >
      115,
  {
    sideDelta:
      db(
        sideRms(
          spatialOn,
        ) /
        sideRms(
          spatialOff,
        ),
      ),

    width:
      spatialOn.width,
  },
);

for (
  const profile of [1, 2]
) {
  const studio =
    await render({
      mode: 1,
      intensity: 1,
      profile,
      spatial: true,
      spaceMode: 0,
      signal: "dynamic",
    });

  const live =
    await render({
      mode: 1,
      intensity: 1,
      profile,
      spatial: true,
      spaceMode: 1,
      signal: "dynamic",
    });

  const arena =
    await render({
      mode: 1,
      intensity: 1,
      profile,
      spatial: true,
      spaceMode: 2,
      signal: "dynamic",
    });

  const liveSide =
    db(
      sideRms(live) /
      sideRms(studio),
    );

  const arenaSide =
    db(
      sideRms(arena) /
      sideRms(live),
    );

  const widthStep1 =
    live.width -
    studio.width;

  const widthStep2 =
    arena.width -
    live.width;

  add(
    profile === 1
      ? "Headphone Studio Live Arena distinct"
      : "Bluetooth Studio Live Arena distinct",
    widthStep1 > 10 &&
      widthStep2 > 10 &&
      Math.abs(
        liveSide,
      ) > 0.50 &&
      Math.abs(
        arenaSide,
      ) > 0.50 &&
      safety(studio) &&
      safety(live) &&
      safety(arena),
    {
      studioWidth:
        studio.width,

      liveWidth:
        live.width,

      arenaWidth:
        arena.width,

      liveSide,
      arenaSide,
    },
  );
}

//
// PERSONAL SOUND
//

for (
  const [
    name,
    key,
    frequency,
  ] of [
    [
      "personal bass",
      "pb",
      50,
    ],
    [
      "personal presence",
      "pp",
      3400,
    ],
    [
      "personal bright",
      "pbr",
      9000,
    ],
  ]
) {
  const base =
    await render({
      mode: 2,
      personal: true,
      signal: "dynamic",
    });

  const pos =
    await render({
      mode: 2,
      personal: true,
      [key]: 1,
      signal: "dynamic",
    });

  const neg =
    await render({
      mode: 2,
      personal: true,
      [key]: -1,
      signal: "dynamic",
    });

  const positive =
    db(
      mag(
        pos,
        frequency,
      ) /
      mag(
        base,
        frequency,
      ),
    );

  const negative =
    db(
      mag(
        neg,
        frequency,
      ) /
      mag(
        base,
        frequency,
      ),
    );

  add(
    name + ' positive',
    positive > 0.8 &&
      safety(pos),
    {
      delta:
        positive,
    },
  );

  add(
    name + ' negative',
    negative < -0.8 &&
      safety(neg),
    {
      delta:
        negative,
    },
  );
}

//
// EQ
//

const eq0 =
  await render({
    mode: 1,
    signal: "dynamic",
  });

const eq1 =
  await render({
    mode: 1,
    eq: [[17, 6]],
    signal: "dynamic",
  });

add(
  "31-band EQ audible",
  db(
    mag(eq1, 1000) /
    mag(eq0, 1000),
  ) > 2.5 &&
    safety(eq1),
  {
    delta:
      db(
        mag(eq1, 1000) /
        mag(eq0, 1000),
      ),

    limiter:
      eq1.lim,
  },
);

//
// MASTER PREP
//

const master0 =
  await render({
    mode: 1,
    signal: "dynamic",
  });

const master1 =
  await render({
    mode: 1,
    master: {
      presenceDb: 1.5,
      lowMidDb: -1,
    },
    signal: "dynamic",
  });

add(
  "master prep audible",
  Math.abs(
    db(
      mag(
        master1,
        3400,
      ) /
      mag(
        master0,
        3400,
      ),
    ),
  ) > 0.5 &&
    safety(master1),
  {
    delta:
      db(
        mag(
          master1,
          3400,
        ) /
        mag(
          master0,
          3400,
        ),
      ),
  },
);

//
// V5.7 MODE CONTRAST
//

const pure =
  await render({
    mode: 0,
    signal: "hot",
  });

const adaptive =
  await render({
    mode: 1,
    intensity: 1,
    signal: "hot",
  });

const power =
  await render({
    mode: 2,
    intensity: 1,
    signal: "hot",
  });

const adaptiveRms =
  db(
    rms(adaptive) /
    rms(pure),
  );

const adaptivePresence =
  db(
    mag(
      adaptive,
      3400,
    ) /
    mag(
      pure,
      3400,
    ),
  );

add(
  "Adaptive clearly differs from Pure",
  Math.abs(
    adaptiveRms,
  ) > 0.45 ||
    Math.abs(
      adaptivePresence,
    ) > 0.80,
  {
    rms:
      adaptiveRms,

    presence:
      adaptivePresence,
  },
);

const powerRms =
  db(
    rms(power) /
    rms(adaptive),
  );

const powerPresence =
  db(
    mag(
      power,
      3400,
    ) /
    mag(
      adaptive,
      3400,
    ),
  );

add(
  "Power clearly differs from Adaptive",
  (
    Math.abs(
      powerRms,
    ) > 0.55 ||
    Math.abs(
      powerPresence,
    ) > 0.90
  ) &&
    safety(power),
  {
    rms:
      powerRms,

    presence:
      powerPresence,

    limiter:
      power.lim,
  },
);

//
// HEADPHONE-SPECIFIC EFFECT STRENGTH
//

const hpBase =
  await render({
    mode: 1,
    profile: 1,
    intensity: 1,
    signal: "dynamic",
  });

const hpBass =
  await render({
    mode: 1,
    profile: 1,
    intensity: 1,
    bass: true,
    bassChar: 0.7,
    signal: "dynamic",
  });

const hpBassDelta =
  db(
    (
      mag(hpBass, 50) +
      mag(hpBass, 110)
    ) /
    (
      mag(hpBase, 50) +
      mag(hpBase, 110)
    ),
  );

add(
  "Headphone Bass unmistakable",
  hpBassDelta >
    1.0 &&
    safety(hpBass),
  {
    delta:
      hpBassDelta,
  },
);

const hpClarity =
  await render({
    mode: 1,
    profile: 1,
    intensity: 1,
    clarity: true,
    signal: "dynamic",
  });

const hpClarityDelta =
  db(
    (
      mag(
        hpClarity,
        3400,
      ) +
      mag(
        hpClarity,
        9000,
      )
    ) /
    (
      mag(
        hpBase,
        3400,
      ) +
      mag(
        hpBase,
        9000,
      )
    ),
  );

add(
  "Headphone Clarity unmistakable",
  hpClarityDelta >
    1.0 &&
    safety(hpClarity),
  {
    delta:
      hpClarityDelta,
  },
);

const personalBase =
  await render({
    mode: 1,
    profile: 1,
    personal: true,
    signal: "dynamic",
  });

const personalMax =
  await render({
    mode: 1,
    profile: 1,
    personal: true,
    pb: 1,
    pp: 1,
    pbr: 1,
    signal: "dynamic",
  });

const personalPresence =
  db(
    mag(
      personalMax,
      3400,
    ) /
    mag(
      personalBase,
      3400,
    ),
  );

const personalBrightness =
  db(
    mag(
      personalMax,
      9000,
    ) /
    mag(
      personalBase,
      9000,
    ),
  );

add(
  "Personal Sound unmistakable",
  personalPresence >
    1.4 &&
    personalBrightness >
      1.4 &&
    safety(personalMax),
  {
    presence:
      personalPresence,

    brightness:
      personalBrightness,
  },
);

//
// FULL STACK
//
// Safety threshold now matches the exhaustive matrix:
// limiter reduction must stay BELOW 9.5 dB.
//

const stack =
  await render({
    mode: 2,
    intensity: 1,
    bass: true,
    bassChar: 0.7,
    impact: true,
    clarity: true,
    spatial: true,
    spaceMode: 2,
    personal: true,
    pb: 0.5,
    pp: 0.5,
    pbr: 0.5,
    signal: "hot",
  });

add(
  "full stack safe",
  safety(stack),
  {
    tp:
      stack.tp,

    limiter:
      stack.lim,

    clips:
      stack.clips,

    nans:
      stack.nans,
  },
);

const failed =
  cases.filter(
    (item) =>
      !item.pass,
  );

console.log("");
console.log(
  String(cases.length - failed.length) + "/" + String(cases.length) + " PASS",
);

if (failed.length) {
  console.error("");
  console.error(
    "FAILED V5.7 AUDIBILITY CASES:",
  );

  for (
    const failure of
    failed
  ) {
    console.error(
      "-",
      failure.name,
      JSON.stringify(
        failure.data,
      ),
    );
  }

  process.exit(1);
}

console.log(
  "V5.7 perceptual audibility gate: PASS",
);
