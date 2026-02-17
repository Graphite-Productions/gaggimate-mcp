/**
 * Attempt to repair common UTF-8 -> Latin-1 mojibake (e.g. "â" vs "—")
 * seen in some machine-provided profile names.
 */
export function repairMojibake(value: string): string {
  if (!/(Ã.|â[\u0080-\u00BF])/u.test(value)) {
    return value;
  }

  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    if (!repaired || repaired.includes("\uFFFD")) {
      return value;
    }
    return repaired;
  } catch {
    return value;
  }
}

/**
 * Normalize a profile name for comparison: repair mojibake, normalize
 * dashes/spaces/case for safe cross-system matching.
 */
export function normalizeProfileName(name: string): string {
  const repaired = repairMojibake(name);
  return repaired
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
