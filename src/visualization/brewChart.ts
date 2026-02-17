import type { ShotData, ShotSample } from "../parsers/binaryShot.js";
import {
  CHART_THEME,
  COLOR_FAMILIES,
  escapeXml,
  toPath,
  toAreaPath,
  renderBackground,
  renderGrid,
  renderXAxis,
  renderYAxis,
  renderLegend,
  renderPhases,
  renderAxisLines,
  type SeriesPoint,
} from "./chartTheme.js";

/** Iterative max across multiple series to avoid call stack overflow with large arrays */
function seriesMax(...arrays: SeriesPoint[][]): number {
  let max = -Infinity;
  for (const arr of arrays) {
    for (const p of arr) {
      if (p.v > max) max = p.v;
    }
  }
  return max === -Infinity ? 0 : max;
}

/** Iterative min across multiple series */
function seriesMin(...arrays: SeriesPoint[][]): number {
  let min = Infinity;
  for (const arr of arrays) {
    for (const p of arr) {
      if (p.v < min) min = p.v;
    }
  }
  return min === Infinity ? 0 : min;
}

function seriesMaxT(...arrays: SeriesPoint[][]): number {
  let max = -Infinity;
  for (const arr of arrays) {
    for (const p of arr) {
      if (p.t > max) max = p.t;
    }
  }
  return max === -Infinity ? 0 : max;
}

interface BrewSeries {
  label: string;
  color: string;
  points: SeriesPoint[];
  dashed?: boolean;
  width: number;
  axis: "left" | "right" | "far-right";
}

/**
 * Downsample points to at most `maxPoints` using min-max bucketing.
 * Each bucket contributes both its minimum and maximum point (in time order),
 * preserving peaks and valleys such as pressure dips from channeling.
 */
function downsample(points: SeriesPoint[], maxPoints: number): SeriesPoint[] {
  if (points.length <= maxPoints) return points;
  // Use half as many buckets so that min+max per bucket stays within maxPoints.
  const bucketCount = Math.max(1, Math.floor(maxPoints / 2));
  const bucketSize = points.length / bucketCount;
  const result: SeriesPoint[] = [points[0]];

  for (let i = 1; i < bucketCount - 1; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(Math.floor((i + 1) * bucketSize), points.length);
    let minV = Infinity, maxV = -Infinity;
    let minIdx = start, maxIdx = start;
    for (let j = start; j < end; j++) {
      if (points[j].v < minV) { minV = points[j].v; minIdx = j; }
      if (points[j].v > maxV) { maxV = points[j].v; maxIdx = j; }
    }
    // Add in chronological order so the path traces correctly
    if (minIdx <= maxIdx) {
      result.push(points[minIdx], points[maxIdx]);
    } else {
      result.push(points[maxIdx], points[minIdx]);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function buildTimeSeries(
  samples: ShotSample[],
  field: keyof ShotSample,
): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const s of samples) {
    const t = (s.t ?? 0) / 1000; // ms → seconds
    const v = typeof s[field] === "number" ? (s[field] as number) : 0;
    points.push({ t, v });
  }
  return points;
}

function buildPhaseSpans(
  shot: ShotData,
): Array<{ name: string; start: number; end: number }> {
  if (shot.phases.length === 0) return [];
  const spans: Array<{ name: string; start: number; end: number }> = [];
  for (let i = 0; i < shot.phases.length; i++) {
    const phase = shot.phases[i];
    const startSample = shot.samples[phase.sampleIndex];
    const nextPhase = shot.phases[i + 1];
    const endSample = nextPhase
      ? shot.samples[nextPhase.sampleIndex]
      : shot.samples[shot.samples.length - 1];
    const startT = (startSample?.t ?? 0) / 1000;
    const endT = (endSample?.t ?? 0) / 1000;
    if (endT > startT) {
      spans.push({ name: phase.phaseName, start: startT, end: endT });
    }
  }
  return spans;
}

export function renderBrewChartSvg(shot: ShotData): string {
  const T = CHART_THEME;
  const { width, height } = T;
  // Wider right margin for 3 y-axes
  const margin = { top: 170, right: 200, bottom: 100, left: 120 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const maxPts = 400;

  // Build raw series
  const ctRaw = buildTimeSeries(shot.samples, "ct");
  const ttRaw = buildTimeSeries(shot.samples, "tt");
  const cpRaw = buildTimeSeries(shot.samples, "cp");
  const tpRaw = buildTimeSeries(shot.samples, "tp");
  const flRaw = buildTimeSeries(shot.samples, "fl");
  const pfRaw = buildTimeSeries(shot.samples, "pf");
  const tfRaw = buildTimeSeries(shot.samples, "tf");
  const vRaw = buildTimeSeries(shot.samples, "v");
  const vfRaw = buildTimeSeries(shot.samples, "vf");

  // Determine axis ranges (iterative to avoid call-stack overflow with large sample arrays)
  const totalDuration = Math.max(1, seriesMaxT(ctRaw));

  const maxTemp = Math.max(80, seriesMax(ctRaw, ttRaw));
  // Round temp ceiling to nearest 10
  const tempCeil = Math.ceil(maxTemp / 10) * 10;

  // Floor the temperature axis so variation is visible — only if machine is at temp (>60°C).
  // Use 5°C below the lowest observed temperature, clamped to at least 60°C.
  const minObservedTemp = seriesMin(ctRaw);
  const tempFloor = minObservedTemp > 60
    ? Math.max(60, Math.floor(minObservedTemp / 5) * 5 - 5)
    : 0;

  const maxPressureFlow = Math.max(10, seriesMax(cpRaw, tpRaw, flRaw, pfRaw, tfRaw, vfRaw));
  const pfCeil = Math.ceil(maxPressureFlow);

  const maxWeight = Math.max(10, seriesMax(vRaw));
  const weightCeil = Math.ceil(maxWeight / 10) * 10;

  // Scale functions
  const xScale = (t: number) => margin.left + (t / totalDuration) * chartW;
  const yTemp = (v: number) =>
    margin.top + chartH - ((v - tempFloor) / (tempCeil - tempFloor)) * chartH;
  const yPF = (v: number) => margin.top + chartH - (v / pfCeil) * chartH;
  const yWeight = (v: number) => margin.top + chartH - (v / weightCeil) * chartH;

  // Pre-downsample primary series used for both the area fill and the line
  const ctPoints = downsample(ctRaw, maxPts);
  const cpPoints = downsample(cpRaw, maxPts);

  // Define all series
  const series: BrewSeries[] = [
    { label: "Temp", color: COLOR_FAMILIES.temperature.primary, points: ctPoints, width: T.solidWidth, axis: "left" },
    { label: "Target Temp", color: COLOR_FAMILIES.temperature.primary, points: downsample(ttRaw, maxPts), width: T.dashedWidth, dashed: true, axis: "left" },
    { label: "Pressure", color: COLOR_FAMILIES.pressure.primary, points: cpPoints, width: T.solidWidth, axis: "right" },
    { label: "Target Pressure", color: COLOR_FAMILIES.pressure.primary, points: downsample(tpRaw, maxPts), width: T.dashedWidth, dashed: true, axis: "right" },
    { label: "Pump Flow", color: COLOR_FAMILIES.flow.primary, points: downsample(flRaw, maxPts), width: T.solidWidth, axis: "right" },
    { label: "Puck Flow", color: COLOR_FAMILIES.flow.secondary, points: downsample(pfRaw, maxPts), width: 1.5, axis: "right" },
    { label: "Target Flow", color: COLOR_FAMILIES.flow.primary, points: downsample(tfRaw, maxPts), width: T.dashedWidth, dashed: true, axis: "right" },
    { label: "Weight", color: COLOR_FAMILIES.weight.primary, points: downsample(vRaw, maxPts), width: T.solidWidth, axis: "far-right" },
    { label: "Weight Flow", color: COLOR_FAMILIES.weight.muted, points: downsample(vfRaw, maxPts), width: 1.5, axis: "right" },
  ];

  // Filter out empty series (all zeros)
  const activeSeries = series.filter(
    (s) => s.points.some((p) => p.v > 0),
  );

  // Y-scale resolver
  function yForSeries(s: BrewSeries): (v: number) => number {
    if (s.axis === "left") return yTemp;
    if (s.axis === "far-right") return yWeight;
    return yPF;
  }

  // Render data paths
  const paths = activeSeries.map((s) => {
    const d = toPath(s.points, xScale, yForSeries(s));
    const dashAttr = s.dashed ? ` stroke-dasharray="${T.dashArray}"` : "";
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"${dashAttr} />`;
  }).join("\n  ");

  // Phase spans
  const phases = buildPhaseSpans(shot);

  // Title
  const title = escapeXml(shot.profileName || "Brew");
  const durationSec = Math.round(shot.duration / 1000);
  const weightLabel = shot.weight !== null ? `${shot.weight}g` : "";
  const subtitle = [
    `${durationSec}s`,
    weightLabel,
    `Shot #${shot.id}`,
  ].filter(Boolean).join(" \u00B7 ");

  const xTickCount = 6;
  const yTickCount = 5;

  // Legend items (only for active series)
  const legendItems = activeSeries.map((s) => ({
    label: s.label,
    color: s.color,
    dashed: s.dashed,
  }));
  // Split into two rows
  const row1 = legendItems.slice(0, 5);
  const row2 = legendItems.slice(5);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${renderBackground(width, height)}

  <text x="${margin.left}" y="72" font-size="32" font-weight="700" font-family="${T.fontFamily}" fill="${T.titleFill}">${title}</text>
  <text x="${margin.left}" y="104" font-size="16" font-family="${T.fontFamily}" fill="${T.subtitleFill}">${escapeXml(subtitle)}</text>

  ${renderPhases(phases, xScale, margin, chartH)}
  ${renderGrid(margin, chartW, chartH, xTickCount, yTickCount)}
  ${renderAxisLines(margin, chartW, chartH)}

  <path d="${toAreaPath(ctPoints, xScale, yTemp, margin.top + chartH)}" fill="${COLOR_FAMILIES.temperature.primary}" opacity="0.10" />
  <path d="${toAreaPath(cpPoints, xScale, yPF, margin.top + chartH)}" fill="${COLOR_FAMILIES.pressure.primary}" opacity="0.08" />

  ${paths}

  ${renderXAxis(margin, chartW, chartH, totalDuration, xTickCount)}
  ${renderYAxis("left", margin, chartW, chartH, tempCeil, "Temperature (\u00B0C)", yTickCount, tempFloor)}
  ${renderYAxis("right", margin, chartW, chartH, pfCeil, "Pressure / Flow", yTickCount)}
  ${renderYAxis("far-right", margin, chartW, chartH, weightCeil, "Weight (g)", yTickCount)}

  ${renderLegend(row1, margin.left, 132)}
  ${row2.length > 0 ? renderLegend(row2, margin.left, 154) : ""}
</svg>`;
}
