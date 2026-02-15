import type { ShotData } from "../parsers/binaryShot.js";
import type { TransformedShot } from "../transformers/shotTransformer.js";
import type { BrewData } from "./types.js";

interface BrewTitleFormatOptions {
  timeZone?: string;
}

/**
 * Format a shot number with zero-padded prefix: "#047"
 */
function formatShotNumber(shotId: string): string {
  return `#${shotId.padStart(3, "0")}`;
}

/**
 * Format a date for brew title: "Feb 14 AM"
 */
function formatBrewDate(isoDate: string, options?: BrewTitleFormatOptions): string {
  const date = new Date(isoDate);
  const formatterOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    hour12: true,
  };
  if (options?.timeZone) {
    formatterOptions.timeZone = options.timeZone;
  }

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", formatterOptions).formatToParts(date);
  } catch {
    // Fallback for invalid timezone config
    parts = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      hour12: true,
    }).formatToParts(date);
  }

  const month = parts.find((p) => p.type === "month")?.value || date.toLocaleDateString("en-US", { month: "short" });
  const day = parts.find((p) => p.type === "day")?.value || String(date.getDate());
  const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value || (date.getHours() < 12 ? "AM" : "PM")).toUpperCase();
  const period = dayPeriod.startsWith("A") ? "AM" : "PM";
  return `${month} ${day} ${period}`;
}

/**
 * Map GaggiMate shot data to Notion Brews DB properties
 */
export function shotToBrewData(
  shot: ShotData,
  transformed: TransformedShot,
  options?: BrewTitleFormatOptions,
): BrewData {
  const isoDate = transformed.metadata.timestamp;
  const shotNumber = formatShotNumber(shot.id);
  const dateLabel = formatBrewDate(isoDate, options);

  return {
    activityId: shot.id,
    title: `${shotNumber} - ${dateLabel}`,
    date: isoDate,
    brewTime: transformed.metadata.duration_seconds,
    yieldOut: transformed.metadata.final_weight_grams,
    brewTemp: Math.round(transformed.summary.temperature.average_celsius * 10) / 10,
    peakPressure: Math.round(transformed.summary.pressure.max_bar * 10) / 10,
    preinfusionTime: Math.round(transformed.summary.extraction.preinfusion_time_seconds * 10) / 10,
    totalVolume: transformed.summary.flow.total_volume_ml,
    profileName: transformed.metadata.profile_name,
    source: "Auto",
  };
}

/**
 * Convert BrewData to Notion page properties
 */
export function brewDataToNotionProperties(brew: BrewData): Record<string, any> {
  const properties: Record<string, any> = {
    // Title property
    Brew: {
      title: [{ text: { content: brew.title } }],
    },
    // Activity ID for dedup
    "Activity ID": {
      rich_text: [{ text: { content: brew.activityId } }],
    },
    // Date with time
    Date: {
      date: { start: brew.date },
    },
    // Brew metrics
    "Brew Time": {
      number: brew.brewTime,
    },
    "Brew Temp": {
      number: brew.brewTemp,
    },
    "Peak Pressure": {
      number: brew.peakPressure,
    },
    "Pre-infusion Time": {
      number: brew.preinfusionTime,
    },
    "Total Volume": {
      number: brew.totalVolume,
    },
    // Source
    Source: {
      select: { name: brew.source },
    },
  };

  // Only include Yield Out if we have weight data
  if (brew.yieldOut !== null) {
    properties["Yield Out"] = {
      number: brew.yieldOut,
    };
  }

  return properties;
}
