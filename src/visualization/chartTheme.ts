// Shared chart design system — dark, minimal, engineering-focused dashboard aesthetic

export const CHART_THEME = {
  width: 1280,
  height: 760,
  margin: { top: 170, right: 160, bottom: 100, left: 120 },
  bg: "#0B0F1A",
  card: "#141922",
  cardStroke: "#1E2736",
  cardRadius: 16,
  grid: "#1E2736",
  gridOpacity: 0.6,
  axisLine: "#2A3447",
  labelFill: "#6B7B95",
  titleFill: "#E2E8F0",
  subtitleFill: "#8899AD",
  phaseFillEven: "#111827",
  phaseFillOdd: "#141C2B",
  phaseStroke: "#2A3447",
  phaseLabelFill: "#6B7B95",
  solidWidth: 2.5,
  dashedWidth: 2,
  dashArray: "8 6",
  fontFamily: "system-ui, -apple-system, sans-serif",
} as const;

export const COLOR_FAMILIES = {
  temperature: { primary: "#F59E42", muted: "#C87E35" },
  pressure: { primary: "#4A9EFF", muted: "#3578C2" },
  flow: { primary: "#2D8B4E", secondary: "#34D399", muted: "#228844" },
  weight: { primary: "#A78BFA", muted: "#C4B5FD" },
} as const;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export type SeriesPoint = { t: number; v: number };

export function toPath(
  points: SeriesPoint[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  if (points.length === 0) return "";
  let path = `M ${x(points[0].t).toFixed(2)} ${y(points[0].v).toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    path += ` L ${x(points[i].t).toFixed(2)} ${y(points[i].v).toFixed(2)}`;
  }
  return path;
}

export function renderBackground(width: number, height: number): string {
  const T = CHART_THEME;
  const pad = 24;
  return [
    `<rect width="${width}" height="${height}" fill="${T.bg}" />`,
    `<rect x="${pad}" y="${pad}" width="${width - pad * 2}" height="${height - pad * 2}" rx="${T.cardRadius}" fill="${T.card}" stroke="${T.cardStroke}" stroke-width="1.5" />`,
  ].join("\n");
}

export function renderGrid(
  margin: { top: number; right: number; bottom: number; left: number },
  chartW: number,
  chartH: number,
  xTicks: number,
  yTicks: number,
): string {
  const T = CHART_THEME;
  const lines: string[] = [];

  for (let i = 0; i <= xTicks; i++) {
    const px = margin.left + (chartW / xTicks) * i;
    lines.push(
      `<line x1="${px.toFixed(2)}" y1="${margin.top}" x2="${px.toFixed(2)}" y2="${(margin.top + chartH).toFixed(2)}" stroke="${T.grid}" stroke-width="1" opacity="${T.gridOpacity}" />`,
    );
  }
  for (let i = 0; i <= yTicks; i++) {
    const py = margin.top + chartH - (chartH / yTicks) * i;
    lines.push(
      `<line x1="${margin.left}" y1="${py.toFixed(2)}" x2="${(margin.left + chartW).toFixed(2)}" y2="${py.toFixed(2)}" stroke="${T.grid}" stroke-width="1" opacity="${T.gridOpacity}" />`,
    );
  }
  return lines.join("\n");
}

export function renderXAxis(
  margin: { top: number; bottom: number; left: number },
  chartW: number,
  chartH: number,
  totalDuration: number,
  tickCount: number,
): string {
  const T = CHART_THEME;
  const xAxisY = margin.top + chartH;
  const ticks: string[] = [];

  for (let i = 0; i <= tickCount; i++) {
    const t = (totalDuration / tickCount) * i;
    const px = margin.left + (t / totalDuration) * chartW;
    ticks.push(
      `<text x="${px.toFixed(2)}" y="${(xAxisY + 32).toFixed(2)}" font-size="14" font-family="${T.fontFamily}" text-anchor="middle" fill="${T.labelFill}">${Math.round(t)}s</text>`,
    );
  }
  return ticks.join("\n");
}

export function renderYAxis(
  side: "left" | "right" | "far-right",
  margin: { top: number; right: number; left: number },
  chartW: number,
  chartH: number,
  maxVal: number,
  unit: string,
  tickCount: number,
): string {
  const T = CHART_THEME;
  const ticks: string[] = [];
  const rightEdge = margin.left + chartW;

  let xPos: number;
  let anchor: string;
  if (side === "left") {
    xPos = margin.left - 12;
    anchor = "end";
  } else if (side === "right") {
    xPos = rightEdge + 12;
    anchor = "start";
  } else {
    xPos = rightEdge + 56;
    anchor = "start";
  }

  for (let i = 0; i <= tickCount; i++) {
    const value = (maxVal / tickCount) * i;
    const py = margin.top + chartH - (chartH / tickCount) * i;
    const label = maxVal >= 10 ? Math.round(value).toString() : value.toFixed(1);
    ticks.push(
      `<text x="${xPos.toFixed(2)}" y="${(py + 5).toFixed(2)}" font-size="13" font-family="${T.fontFamily}" text-anchor="${anchor}" fill="${T.labelFill}">${label}</text>`,
    );
  }

  // Axis unit label (rotated)
  const midY = margin.top + chartH / 2;
  if (side === "left") {
    const lx = margin.left - 50;
    ticks.push(
      `<text x="${lx.toFixed(2)}" y="${midY.toFixed(2)}" font-size="14" font-family="${T.fontFamily}" text-anchor="middle" transform="rotate(-90 ${lx.toFixed(2)} ${midY.toFixed(2)})" fill="${T.labelFill}">${escapeXml(unit)}</text>`,
    );
  } else if (side === "right") {
    const lx = rightEdge + 46;
    ticks.push(
      `<text x="${lx.toFixed(2)}" y="${midY.toFixed(2)}" font-size="14" font-family="${T.fontFamily}" text-anchor="middle" transform="rotate(90 ${lx.toFixed(2)} ${midY.toFixed(2)})" fill="${T.labelFill}">${escapeXml(unit)}</text>`,
    );
  } else {
    const lx = rightEdge + 92;
    ticks.push(
      `<text x="${lx.toFixed(2)}" y="${midY.toFixed(2)}" font-size="14" font-family="${T.fontFamily}" text-anchor="middle" transform="rotate(90 ${lx.toFixed(2)} ${midY.toFixed(2)})" fill="${T.labelFill}">${escapeXml(unit)}</text>`,
    );
  }

  return ticks.join("\n");
}

export interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
}

export function renderLegend(items: LegendItem[], startX: number, y: number): string {
  const T = CHART_THEME;
  const parts: string[] = [];
  let cx = startX;
  const lineLen = 30;
  const gap = 24;

  for (const item of items) {
    const dashAttr = item.dashed ? ` stroke-dasharray="${T.dashArray}"` : "";
    const width = item.dashed ? T.dashedWidth : T.solidWidth;
    parts.push(
      `<line x1="${cx}" y1="${y}" x2="${cx + lineLen}" y2="${y}" stroke="${item.color}" stroke-width="${width}"${dashAttr} />`,
    );
    cx += lineLen + 6;
    parts.push(
      `<text x="${cx}" y="${(y + 5).toFixed(2)}" font-size="13" font-family="${T.fontFamily}" fill="${T.subtitleFill}">${escapeXml(item.label)}</text>`,
    );
    cx += item.label.length * 7.5 + gap;
  }
  return parts.join("\n");
}

export function renderPhases(
  phases: Array<{ name: string; start: number; end: number }>,
  xScale: (t: number) => number,
  margin: { top: number },
  chartH: number,
): string {
  const T = CHART_THEME;
  const parts: string[] = [];

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const x1 = xScale(phase.start);
    const x2 = xScale(phase.end);
    const fill = i % 2 === 0 ? T.phaseFillEven : T.phaseFillOdd;

    parts.push(
      `<rect x="${x1.toFixed(2)}" y="${margin.top}" width="${(x2 - x1).toFixed(2)}" height="${chartH.toFixed(2)}" fill="${fill}" opacity="0.6" />`,
    );

    // Phase transition line (except after last phase)
    if (i < phases.length - 1) {
      parts.push(
        `<line x1="${x2.toFixed(2)}" y1="${margin.top}" x2="${x2.toFixed(2)}" y2="${(margin.top + chartH).toFixed(2)}" stroke="${T.phaseStroke}" stroke-width="1" opacity="0.7" />`,
      );
    }

    // Phase label
    parts.push(
      `<text x="${(x1 + 8).toFixed(2)}" y="${(margin.top + 16).toFixed(2)}" font-size="11" font-family="${T.fontFamily}" fill="${T.phaseLabelFill}">${escapeXml(phase.name)}</text>`,
    );
  }
  return parts.join("\n");
}

export function renderAxisLines(
  margin: { top: number; left: number },
  chartW: number,
  chartH: number,
): string {
  const T = CHART_THEME;
  const xAxisY = margin.top + chartH;
  const rightX = margin.left + chartW;
  return [
    `<line x1="${margin.left}" y1="${xAxisY.toFixed(2)}" x2="${rightX.toFixed(2)}" y2="${xAxisY.toFixed(2)}" stroke="${T.axisLine}" stroke-width="1" />`,
    `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${xAxisY.toFixed(2)}" stroke="${T.axisLine}" stroke-width="1" />`,
    `<line x1="${rightX.toFixed(2)}" y1="${margin.top}" x2="${rightX.toFixed(2)}" y2="${xAxisY.toFixed(2)}" stroke="${T.axisLine}" stroke-width="1" />`,
  ].join("\n");
}
