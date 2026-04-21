export type RigPose = {
  head: [number, number];
  neck: [number, number];
  shL: [number, number];
  elL: [number, number];
  wrL: [number, number];
  shR: [number, number];
  elR: [number, number];
  wrR: [number, number];
  hip: [number, number];
  knL: [number, number];
  anL: [number, number];
  knR: [number, number];
  anR: [number, number];
};

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
export function oscillate(t: number) {
  return (Math.sin(t * 2 * Math.PI) + 1) / 2;
}

export function basePose(): RigPose {
  return {
    head: [0, -80],
    neck: [0, -60],
    shL: [-22, -50],
    elL: [-40, -20],
    wrL: [-46, 10],
    shR: [22, -50],
    elR: [40, -20],
    wrR: [46, 10],
    hip: [0, 0],
    knL: [-16, 35],
    anL: [-18, 70],
    knR: [16, 35],
    anR: [18, 70],
  };
}

export function poseFor(templateId: string, phase: number): RigPose {
  const p = basePose();
  const o = oscillate(phase);

  switch (templateId) {
    case "squat": {
      const d = lerp(0, 28, o);
      p.hip[1] += d;
      p.knL[1] += d * 0.8;
      p.knR[1] += d * 0.8;
      p.head[1] += d * 0.35;
      p.neck[1] += d * 0.35;
      return p;
    }
    case "hinge": {
      const d = lerp(0, 20, o);
      p.hip[1] += d * 0.6;
      p.head[0] += d * 0.25;
      p.neck[0] += d * 0.22;
      p.wrL[1] += d * 0.6;
      p.wrR[1] += d * 0.6;
      return p;
    }
    case "press": {
      const d = lerp(0, -24, o);
      p.elL[1] += d;
      p.elR[1] += d;
      p.wrL[1] += d * 1.5;
      p.wrR[1] += d * 1.5;
      return p;
    }
    case "row": {
      const d = lerp(0, -18, o);
      p.elL[0] += 10 * o;
      p.elR[0] -= 10 * o;
      p.wrL[0] += 12 * o;
      p.wrR[0] -= 12 * o;
      p.elL[1] += d * 0.5;
      p.elR[1] += d * 0.5;
      return p;
    }
    case "curl": {
      const d = lerp(0, -18, o);
      p.wrL[1] += d;
      p.wrR[1] += d;
      return p;
    }
    case "triceps": {
      const d = lerp(0, -14, o);
      p.wrL[1] += d;
      p.wrR[1] += d;
      return p;
    }
    case "lateral_raise": {
      const d = lerp(0, -22, o);
      p.wrL[0] -= 12 * o;
      p.wrR[0] += 12 * o;
      p.wrL[1] += d;
      p.wrR[1] += d;
      return p;
    }
    case "reverse_fly": {
      const d = lerp(0, -10, o);
      p.wrL[0] -= 14 * o;
      p.wrR[0] += 14 * o;
      p.wrL[1] += d;
      p.wrR[1] += d;
      return p;
    }
    case "face_pull": {
      const d = lerp(0, -10, o);
      p.wrL[0] += 14 * o;
      p.wrR[0] -= 14 * o;
      p.wrL[1] += d;
      p.wrR[1] += d;
      return p;
    }
    case "calf_raise": {
      const d = lerp(0, -10, o);
      p.anL[1] += d;
      p.anR[1] += d;
      return p;
    }
    default:
      return p;
  }
}