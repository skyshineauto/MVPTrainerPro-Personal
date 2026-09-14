import fs from 'node:fs';

const wasmPath =
  process.argv[2] ||
  'public/audioV2/mvpHdV2.wasm';

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

function makeSig(kind,n=8192){
  const L=new Float32Array(n);
  const R=new Float32Array(n);

  for(let i=0;i<n;i++){
    const t=i/sr;

    const env=
      kind==='dynamic'
        ? (.45+(((t%.25)<.018)
            ? Math.exp(-(t%.25)*120)
            : 0))
        : kind==='hot'
          ? .90
          : 1.15;

    let x=(
      .30*Math.sin(2*Math.PI*50*t)+
      .22*Math.sin(2*Math.PI*110*t)+
      .18*Math.sin(2*Math.PI*1000*t)+
      .12*Math.sin(2*Math.PI*3400*t)+
      .08*Math.sin(2*Math.PI*9000*t)
    )*env;

    let y=(
      .28*Math.sin(2*Math.PI*50*t+.03)+
      .20*Math.sin(2*Math.PI*110*t+.1)+
      .18*Math.sin(2*Math.PI*1000*t+.15)+
      .11*Math.sin(2*Math.PI*3400*t+.4)+
      .07*Math.sin(2*Math.PI*9000*t+.7)
    )*env;

    if(kind==='brick'){
      x=Math.max(-.94,Math.min(.94,x*1.65));
      y=Math.max(-.94,Math.min(.94,y*1.65));
    }

    L[i]=x;
    R[i]=y;
  }

  return {L,R};
}

const sigs={
  dynamic:makeSig('dynamic'),
  hot:makeSig('hot'),
  brick:makeSig('brick'),
};

async function run(c){
  const {instance}=
    await WebAssembly.instantiate(bytes,imports);

  const e=instance.exports;

  if(e.mvp_v2_init(sr)!==1){
    throw Error(
      'init case='+JSON.stringify(c)
    );
  }

  e.mvp_v2_set_output_profile(c.p);
  e.mvp_v2_set_mode(c.m);
  e.mvp_v2_set_intensity(c.i);

  e.mvp_v2_set_bass_enabled(
    c.mask&1 ? 1 : 0
  );

  e.mvp_v2_set_bass_character(
    c.bc??.5
  );

  e.mvp_v2_set_impact_enabled(
    c.mask&2 ? 1 : 0
  );

  e.mvp_v2_set_clarity_enabled(
    c.mask&4 ? 1 : 0
  );

  e.mvp_v2_set_spatial_enabled(
    c.mask&8 ? 1 : 0
  );

  e.mvp_v2_set_space_mode(
    c.sm??0
  );

  if(c.personal){
    e.mvp_v2_set_personal_enabled(1);
    e.mvp_v2_set_personal_bass(c.pb||0);
    e.mvp_v2_set_personal_presence(c.pp||0);
    e.mvp_v2_set_personal_brightness(c.pbr||0);
  }

  if(c.eq){
    e.mvp_v2_set_eq_enabled(1);
    e.mvp_v2_set_eq_band(
      c.eq[0],
      c.eq[1]
    );
  }

  if(c.master){
    e.mvp_v2_set_master_prep(
      1,
      1.2,
      22,
      -.7,
      1.0,
      -1.0,
      .2,
      1.04
    );
  }

  const s=sigs[c.sig];

  const max=
    e.mvp_v2_max_frames();

  const mem=e.memory;

  const li=new Float32Array(
    mem.buffer,
    e.mvp_v2_input_l(),
    max
  );

  const ri=new Float32Array(
    mem.buffer,
    e.mvp_v2_input_r(),
    max
  );

  const lo=new Float32Array(
    mem.buffer,
    e.mvp_v2_output_l(),
    max
  );

  const ro=new Float32Array(
    mem.buffer,
    e.mvp_v2_output_r(),
    max
  );

  let sum=0;
  let n=0;

  for(
    let off=0;
    off<s.L.length;
    off+=max
  ){
    const z=
      Math.min(
        max,
        s.L.length-off
      );

    li.fill(0);
    ri.fill(0);

    li.set(
      s.L.subarray(off,off+z)
    );

    ri.set(
      s.R.subarray(off,off+z)
    );

    if(e.mvp_v2_process(z)!==1){
      throw Error(
        'process case='+JSON.stringify(c)
      );
    }

    for(let j=0;j<z;j++){
      const a=lo[j];
      const b=ro[j];

      if(
        !Number.isFinite(a)||
        !Number.isFinite(b)
      ){
        throw Error(
          'nan case='+JSON.stringify(c)
        );
      }

      if(
        Math.abs(a)>1.0001||
        Math.abs(b)>1.0001
      ){
        throw Error(
          'clip case='+JSON.stringify(c)
        );
      }

      if(off+j>1024){
        sum+=a*a+b*b;
        n+=2;
      }
    }
  }

  const tp=
    e.mvp_v2_meter_true_peak_dbtp();

  const lim=
    e.mvp_v2_meter_limiter_gr_db();

  /*
   * IMPORTANT:
   * These are the original safety limits.
   * They are NOT loosened by V5.5.1.
   */
  if(c.m!==0&&tp>-.30){
    throw Error(
      'tp '+tp+
      ' case='+JSON.stringify(c)
    );
  }

  if(c.m!==0&&lim>9.5){
    throw Error(
      'lim '+lim+
      ' case='+JSON.stringify(c)
    );
  }

  return Math.sqrt(
    sum/Math.max(1,n)
  );
}

let count=0;

for(const p of [0,1,2])
for(const m of [1,2])
for(const i of [0,.5,1])
for(const sig of ['dynamic','hot','brick'])
for(let mask=0;mask<16;mask++){
  await run({
    p,
    m,
    i,
    sig,
    mask,
    sm:p===0?mask%3:0,
  });

  count++;
}

for(const p of [0,1,2])
for(const m of [1,2])
for(const sig of ['dynamic','hot','brick'])
for(const bc of [0,.5,1]){
  await run({
    p,
    m,
    i:.78,
    sig,
    mask:1,
    bc,
  });

  count++;
}

for(const p of [0,1,2])
for(const m of [1,2])
for(const axis of ['pb','pp','pbr'])
for(const v of [-1,-.5,.5,1]){
  await run({
    p,
    m,
    i:.78,
    sig:'dynamic',
    mask:0,
    personal:true,
    [axis]:v,
  });

  count++;
}

for(const p of [0,1,2])
for(
  const idx of
  Array.from(
    {length:31},
    (_,i)=>i
  )
)
for(const db of [-6,6]){
  await run({
    p,
    m:1,
    i:.72,
    sig:'dynamic',
    mask:0,
    eq:[idx,db],
  });

  count++;
}

for(const p of [0,1,2])
for(const m of [1,2])
for(const sig of ['dynamic','hot','brick']){
  await run({
    p,
    m,
    i:.72,
    sig,
    mask:0,
    master:true,
  });

  count++;
}

console.log(
  'V5.5.1 matrix: '+
  count+'/'+count+
  ' PASS'
);
