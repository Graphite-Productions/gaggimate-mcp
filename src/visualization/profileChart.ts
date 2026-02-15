interface ChartProfilePhase {
  name?: string;
  duration?: number;
  transition?: {
    type?: string;
    duration?: number;
  };
  pump?: {
    target?: "pressure" | "flow";
    pressure?: number;
    flow?: number;
  };
}

interface ChartProfile {
  label?: string;
  temperature?: number;
  phases?: ChartProfilePhase[];
}

type SeriesPoint = { t: number; v: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function easing(type: string, x: number): number {
  const t = clamp(x, 0, 1);
  if (type === "ease-in") return t * t;
  if (type === "ease-out") return 1 - (1 - t) * (1 - t);
  if (type === "ease-in-out") {
    if (t < 0.5) return 2 * t * t;
    return 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  return t;
}

function transitionDuration(phase?: ChartProfilePhase): number {
  return Number(phase?.transition?.duration) || 0;
}

function transitionType(phase?: ChartProfilePhase): string {
  const raw = typeof phase?.transition?.type === "string" ? phase.transition.type.toLowerCase() : "";
  const normalized = raw.replace(/[_\s]+/g, "-");
  if (normalized === "easein") return "ease-in";
  if (normalized === "easeout") return "ease-out";
  if (normalized === "easeinout") return "ease-in-out";
  return normalized || "instant";
}

function hasCurvedTransition(phase?: ChartProfilePhase): boolean {
  return transitionDuration(phase) > 0 && transitionType(phase) !== "instant";
}

function buildSeries(profile: ChartProfile): {
  pressure: SeriesPoint[];
  flow: SeriesPoint[];
  totalDuration: number;
  phases: Array<{ name: string; start: number; end: number }>;
} {
  const phases = Array.isArray(profile.phases) ? profile.phases : [];
  const pressure: SeriesPoint[] = [];
  const flow: SeriesPoint[] = [];
  const phaseSpans: Array<{ name: string; start: number; end: number }> = [];
  const sampleStep = 0.25;

  let currentPressure = 0;
  let currentFlow = 0;
  let currentTime = 0;

  if (phases.length === 0) {
    return {
      pressure: [{ t: 0, v: 0 }],
      flow: [{ t: 0, v: 0 }],
      totalDuration: 1,
      phases: [],
    };
  }

  for (let i = 0; i < phases.length; i += 1) {
    const phase = phases[i];
    const duration = clamp(Number(phase.duration) || 0, 0, 300);
    if (duration <= 0) continue;

    const phaseName = phase.name?.trim() || `Phase ${i + 1}`;
    const start = currentTime;
    const end = currentTime + duration;
    phaseSpans.push({ name: phaseName, start, end });

    const targetPressure = typeof phase.pump?.pressure === "number"
      ? clamp(phase.pump.pressure, 0, 15)
      : currentPressure;

    let targetFlow = currentFlow;
    if (typeof phase.pump?.flow === "number") {
      targetFlow = phase.pump.flow === -1
        ? currentFlow
        : clamp(phase.pump.flow, 0, 12);
    }

    // GaggiMate profiles in the wild use both conventions:
    // - transition on the incoming phase
    // - transition on the outgoing previous phase
    // Prefer current phase transition, then fall back to previous.
    const previousPhase = i > 0 ? phases[i - 1] : undefined;
    const transitionSource = hasCurvedTransition(phase) || transitionDuration(phase) > 0
      ? phase
      : previousPhase;
    const startTransitionType = transitionType(transitionSource);
    const startTransitionDuration = clamp(transitionDuration(transitionSource), 0, duration);

    for (let dt = 0; dt <= duration + 1e-6; dt += sampleStep) {
      const absTime = currentTime + Math.min(dt, duration);

      let progress = 1;
      if (startTransitionType !== "instant" && startTransitionDuration > 0 && dt < startTransitionDuration) {
        progress = easing(startTransitionType, dt / startTransitionDuration);
      }

      if (startTransitionType === "instant") {
        progress = dt <= 0 ? 0 : 1;
      }

      const p = currentPressure + (targetPressure - currentPressure) * progress;
      const f = currentFlow + (targetFlow - currentFlow) * progress;

      pressure.push({ t: absTime, v: p });
      flow.push({ t: absTime, v: f });
    }

    currentPressure = targetPressure;
    currentFlow = targetFlow;
    currentTime = end;
  }

  return {
    pressure: pressure.length ? pressure : [{ t: 0, v: 0 }],
    flow: flow.length ? flow : [{ t: 0, v: 0 }],
    totalDuration: Math.max(1, currentTime),
    phases: phaseSpans,
  };
}

function toPath(points: SeriesPoint[], x: (t: number) => number, y: (v: number) => number): string {
  if (points.length === 0) return "";
  let path = `M ${x(points[0].t).toFixed(2)} ${y(points[0].v).toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    path += ` L ${x(points[i].t).toFixed(2)} ${y(points[i].v).toFixed(2)}`;
  }
  return path;
}

export function renderProfileChartSvg(profile: ChartProfile): string {
  const width = 1280;
  const height = 760;
  const margin = { top: 170, right: 160, bottom: 100, left: 120 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const { pressure, flow, totalDuration, phases } = buildSeries(profile);
  const maxPressure = Math.max(12, ...pressure.map((p) => p.v), 1);
  const maxFlow = Math.max(8, ...flow.map((p) => p.v), 1);

  const x = (t: number) => margin.left + (t / totalDuration) * chartW;
  const yPressure = (v: number) => margin.top + chartH - (v / maxPressure) * chartH;
  const yFlow = (v: number) => margin.top + chartH - (v / maxFlow) * chartH;

  const pressurePath = toPath(pressure, x, yPressure);
  const flowPath = toPath(flow, x, yFlow);
  const xTickCount = 6;
  const yTickCount = 6;
  const xAxisY = margin.top + chartH;
  const yAxisRightX = margin.left + chartW;

  const verticalGrid = Array.from({ length: xTickCount + 1 }, (_, i) => {
    const t = (totalDuration / xTickCount) * i;
    const px = x(t);
    return `<line x1="${px.toFixed(2)}" y1="${margin.top}" x2="${px.toFixed(2)}" y2="${xAxisY.toFixed(
      2,
    )}" stroke="#0D2A5A" stroke-width="1" />`;
  }).join("\n");

  const horizontalGrid = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const ratio = i / yTickCount;
    const py = margin.top + chartH - chartH * ratio;
    return `<line x1="${margin.left}" y1="${py.toFixed(2)}" x2="${yAxisRightX.toFixed(
      2,
    )}" y2="${py.toFixed(2)}" stroke="#0D2550" stroke-width="1" />`;
  }).join("\n");

  const phaseBands = phases.map((phase, i) => {
    const x1 = x(phase.start);
    const x2 = x(phase.end);
    const fill = i % 2 === 0 ? "#0A1F49" : "#0B2353";
    const labelX = x1 + 8;
    return [
      `<rect x="${x1.toFixed(2)}" y="${margin.top}" width="${(x2 - x1).toFixed(2)}" height="${chartH.toFixed(
        2,
      )}" fill="${fill}" opacity="0.72" />`,
      `<text x="${labelX.toFixed(2)}" y="${(margin.top + 18).toFixed(
        2,
      )}" font-size="12" fill="#8EA2CA">${escapeXml(phase.name)}</text>`,
    ].join("\n");
  }).join("\n");

  const phaseTransitions = phases.slice(0, -1).map((phase) => {
    const px = x(phase.end);
    return `<line x1="${px.toFixed(2)}" y1="${margin.top}" x2="${px.toFixed(2)}" y2="${xAxisY.toFixed(
      2,
    )}" stroke="#B3BDD2" stroke-width="3" opacity="0.55" />`;
  }).join("\n");

  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => {
    const t = (totalDuration / xTickCount) * i;
    const px = x(t);
    return `<text x="${px.toFixed(2)}" y="${(xAxisY + 48).toFixed(2)}" font-size="22" text-anchor="middle" fill="#7688AD">${Math.round(
      t,
    )}s</text>`;
  }).join("\n");

  const leftTicks = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const value = (maxPressure / yTickCount) * i;
    const py = yPressure(value);
    return `<text x="${(margin.left - 52).toFixed(2)}" y="${(py + 8).toFixed(
      2,
    )}" font-size="20" text-anchor="middle" fill="#7D90B5">${Math.round(value)}</text>`;
  }).join("\n");

  const rightTicks = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const value = (maxFlow / yTickCount) * i;
    const py = yFlow(value);
    return `<text x="${(yAxisRightX + 56).toFixed(2)}" y="${(py + 8).toFixed(
      2,
    )}" font-size="20" text-anchor="middle" fill="#7D90B5">${Math.round(value)}</text>`;
  }).join("\n");

  const title = escapeXml(profile.label || "Profile");
  const temp = typeof profile.temperature === "number" ? `${profile.temperature}C` : "n/a";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#041236" />
      <stop offset="100%" stop-color="#030D29" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="30" fill="#071946" stroke="#103064" stroke-width="2" />
  <rect x="${margin.left - 18}" y="${margin.top - 8}" width="${chartW + 36}" height="${chartH + 16}" rx="22" fill="#081B46" />
  <text x="${margin.left}" y="72" font-size="48" font-weight="700" fill="#D8E3FF">${title}</text>
  <text x="${margin.left}" y="112" font-size="24" fill="#8EA2CA">Pressure + Flow Profile - Temp ${temp}</text>

  ${phaseBands}
  ${phaseTransitions}
  ${verticalGrid}
  ${horizontalGrid}

  <line x1="${margin.left}" y1="${xAxisY.toFixed(2)}" x2="${yAxisRightX.toFixed(2)}" y2="${xAxisY.toFixed(2)}" stroke="#7A8DB4" stroke-width="2" />
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${xAxisY.toFixed(2)}" stroke="#7A8DB4" stroke-width="2" />
  <line x1="${yAxisRightX.toFixed(2)}" y1="${margin.top}" x2="${yAxisRightX.toFixed(2)}" y2="${xAxisY.toFixed(2)}" stroke="#7A8DB4" stroke-width="2" />

  <path d="${pressurePath}" fill="none" stroke="#52D6DD" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
  <path d="${flowPath}" fill="none" stroke="#F4C5CF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="18 14" />

  ${xTicks}
  ${leftTicks}
  ${rightTicks}

  <text x="${(margin.left - 84).toFixed(2)}" y="${(margin.top + chartH / 2).toFixed(
    2,
  )}" font-size="24" text-anchor="middle" transform="rotate(-90 ${(margin.left - 84).toFixed(2)} ${(margin.top + chartH / 2).toFixed(
    2,
  )})" fill="#91A2C9">Pressure (bar)</text>
  <text x="${(yAxisRightX + 104).toFixed(2)}" y="${(margin.top + chartH / 2).toFixed(
    2,
  )}" font-size="24" text-anchor="middle" transform="rotate(90 ${(yAxisRightX + 104).toFixed(2)} ${(margin.top + chartH / 2).toFixed(
    2,
  )})" fill="#91A2C9">Flow (ml/s)</text>

  <line x1="${(width - 390).toFixed(2)}" y1="106" x2="${(width - 330).toFixed(2)}" y2="106" stroke="#52D6DD" stroke-width="8" />
  <text x="${(width - 315).toFixed(2)}" y="114" font-size="38" fill="#C9D7F5">Pressure</text>
  <line x1="${(width - 160).toFixed(2)}" y1="106" x2="${(width - 100).toFixed(2)}" y2="106" stroke="#F4C5CF" stroke-width="8" stroke-dasharray="18 14" />
  <text x="${(width - 86).toFixed(2)}" y="114" font-size="38" fill="#C9D7F5">Flow</text>
</svg>`;
}
