import type { ShotData } from "../parsers/binaryShot.js";
import type { TransformedShot } from "../transformers/shotTransformer.js";
import type { BrewData } from "./types.js";

/**
 * Format a shot number with zero-padded prefix: "#047"
 */
function formatShotNumber(shotId: string): string {
  return `#${shotId.padStart(3, "0")}`;
}

/**
 * Format a date for brew title: "Feb 14 AM"
 */
function formatBrewDate(isoDate: string): string {
  const date = new Date(isoDate);
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getDate();
  const hour = date.getHours();
  const period = hour < 12 ? "AM" : "PM";
  return `${month} ${day} ${period}`;
}

/**
 * Map GaggiMate shot data to Notion Brews DB properties
 */
export function shotToBrewData(
  shot: ShotData,
  transformed: TransformedShot,
): BrewData {
  const isoDate = transformed.metadata.timestamp;
  const shotNumber = formatShotNumber(shot.id);
  const dateLabel = formatBrewDate(isoDate);

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
