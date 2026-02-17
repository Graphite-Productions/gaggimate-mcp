import {
  CHART_THEME,
  COLOR_FAMILIES,
  escapeXml,
  clamp,
  toPath,
  renderBackground,
  renderGrid,
  renderXAxis,
  renderYAxis,
  renderLegend,
  renderPhases,
  renderAxisLines,
  type SeriesPoint,
} from "./chartTheme.js";

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

/** Extract transition from phase, handling API format variations (transition/Transition, duration as number or string) */
function getTransition(phase: any): { type?: string; duration?: number } | undefined {
  if (!phase || typeof phase !== "object") return undefined;
  const t = phase.transition ?? phase.Transition;
  if (!t || typeof t !== "object") return undefined;
  const duration = typeof t.duration === "number" ? t.duration : Number(t.duration ?? t.Duration);
  const type = typeof t.type === "string" ? t.type : (typeof t.Type === "string" ? t.Type : undefined);
  return { type, duration: Number.isFinite(duration) ? duration : undefined };
}

function transitionDuration(phase?: ChartProfilePhase): number {
  const t = getTransition(phase);
  return typeof t?.duration === "number" ? t.duration : 0;
}

function transitionType(phase?: ChartProfilePhase): string {
  const t = getTransition(phase);
  const raw = typeof t?.type === "string" ? t.type.toLowerCase() : "";
  const normalized = raw.replace(/[_\s]+/g, "-");
  if (normalized === "easein") return "ease-in";
  if (normalized === "easeout") return "ease-out";
  if (normalized === "easeinout") return "ease-in-out";
  return normalized || "instant";
}

export function buildSeries(profile: ChartProfile): {
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

    const rawPressure = Number(phase.pump?.pressure);
    const targetPressure = Number.isFinite(rawPressure)
      ? clamp(rawPressure, 0, 15)
      : currentPressure;

    const rawFlow = Number(phase.pump?.flow);
    let targetFlow = currentFlow;
    if (Number.isFinite(rawFlow)) {
      targetFlow = rawFlow === -1 ? currentFlow : clamp(rawFlow, 0, 12);
    }

    // Each phase owns its own transition. No transition = instant (documented default).
    const startTransitionType = transitionType(phase);
    const startTransitionDuration = clamp(transitionDuration(phase), 0, duration);

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

export function renderProfileChartSvg(profile: ChartProfile): string {
  const T = CHART_THEME;
  const { width, height } = T;
  const margin = T.margin;
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const { pressure, flow, totalDuration, phases } = buildSeries(profile);
  // Iterative max to avoid call-stack overflow with large point arrays
  let maxPressure = 12;
  for (const p of pressure) { if (p.v > maxPressure) maxPressure = p.v; }
  let maxFlow = 8;
  for (const p of flow) { if (p.v > maxFlow) maxFlow = p.v; }

  const x = (t: number) => margin.left + (t / totalDuration) * chartW;
  const yPressure = (v: number) => margin.top + chartH - (v / maxPressure) * chartH;
  const yFlow = (v: number) => margin.top + chartH - (v / maxFlow) * chartH;

  const pressurePath = toPath(pressure, x, yPressure);
  const flowPath = toPath(flow, x, yFlow);
  const xTickCount = 6;
  const yTickCount = 6;

  const title = escapeXml(profile.label || "Profile");
  const temp = typeof profile.temperature === "number" ? `${profile.temperature}\u00B0C` : "n/a";

  const pressureColor = COLOR_FAMILIES.pressure.primary;
  const flowColor = COLOR_FAMILIES.flow.secondary;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${renderBackground(width, height)}

  <text x="${margin.left}" y="72" font-size="32" font-weight="700" font-family="${T.fontFamily}" fill="${T.titleFill}">${title}</text>
  <text x="${margin.left}" y="104" font-size="16" font-family="${T.fontFamily}" fill="${T.subtitleFill}">Pressure + Flow Profile \u2014 Temp ${temp}</text>

  ${renderPhases(phases, x, margin, chartH)}
  ${renderGrid(margin, chartW, chartH, xTickCount, yTickCount)}
  ${renderAxisLines(margin, chartW, chartH)}

  <path d="${pressurePath}" fill="none" stroke="${pressureColor}" stroke-width="${T.solidWidth}" stroke-linecap="round" stroke-linejoin="round" />
  <path d="${flowPath}" fill="none" stroke="${flowColor}" stroke-width="${T.dashedWidth}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${T.dashArray}" />

  ${renderXAxis(margin, chartW, chartH, totalDuration, xTickCount)}
  ${renderYAxis("left", margin, chartW, chartH, maxPressure, "Pressure (bar)", yTickCount)}
  ${renderYAxis("right", margin, chartW, chartH, maxFlow, "Flow (ml/s)", yTickCount)}

  ${renderLegend([{ label: "Pressure", color: pressureColor }, { label: "Flow", color: flowColor, dashed: true }], margin.left, 140)}
</svg>`;
}
