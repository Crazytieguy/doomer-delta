import type { Id } from "../_generated/dataModel";

export type CPTEntry = {
  parentStates: Record<string, boolean | null>;
  probability: number;
};

/**
 * Syncs columnOrder with parent IDs in cptEntries.
 * Preserves existing order, removes deleted parents, appends new parents.
 */
export function syncColumnOrderWithCptEntries(
  cptEntries: CPTEntry[],
  existingColumnOrder: Id<"nodes">[] | undefined,
): Id<"nodes">[] {
  const newParentIds = new Set<string>();
  for (const entry of cptEntries) {
    Object.keys(entry.parentStates).forEach((id) => newParentIds.add(id));
  }

  const existingOrder = existingColumnOrder || [];
  const newColumnOrder: Id<"nodes">[] = [];

  // Preserve existing order for parents still present
  for (const id of existingOrder) {
    if (newParentIds.has(id)) {
      newColumnOrder.push(id);
      newParentIds.delete(id);
    }
  }

  // Append new parents to the end
  for (const id of newParentIds) {
    newColumnOrder.push(id as Id<"nodes">);
  }

  return newColumnOrder;
}

export function expandEntry(entry: CPTEntry, parentIds: string[]): string[] {
  const nullIndices: number[] = [];
  const baseValues: (boolean | null)[] = [];

  for (let i = 0; i < parentIds.length; i++) {
    const val = entry.parentStates[parentIds[i]];
    baseValues.push(val);
    if (val === null) {
      nullIndices.push(i);
    }
  }

  if (nullIndices.length > 8) {
    throw new Error(
      "Too many 'any' values. Maximum 8 per rule to prevent exponential explosion.",
    );
  }

  const numExpansions = Math.pow(2, nullIndices.length);
  const combinations: string[] = [];

  for (let i = 0; i < numExpansions; i++) {
    const values = [...baseValues];
    for (let j = 0; j < nullIndices.length; j++) {
      values[nullIndices[j]] = Boolean((i >> j) & 1);
    }
    const key = values.map((v) => (v ? "T" : "F")).join("");
    combinations.push(key);
  }

  return combinations;
}

/**
 * Removes duplicate wildcard entries from root nodes (nodes with no parents).
 * Keeps only the first entry.
 */
export function deduplicateRootNodeEntries(entries: CPTEntry[]): CPTEntry[] {
  if (entries.length === 0) return entries;

  const parentIds = Object.keys(entries[0]?.parentStates || {});

  if (parentIds.length === 0 && entries.length > 1) {
    return [entries[0]];
  }

  return entries;
}

export function validateCPTEntries(
  entries: CPTEntry[],
): { valid: true } | { valid: false; error: string } {
  if (entries.length === 0) {
    return { valid: false, error: "CPT entries cannot be empty" };
  }

  const parentIds = Object.keys(entries[0]?.parentStates || {});

  for (const entry of entries) {
    if (
      isNaN(entry.probability) ||
      entry.probability < 0 ||
      entry.probability > 1
    ) {
      return {
        valid: false,
        error: `Invalid probability value: ${entry.probability}. Must be between 0 and 1.`,
      };
    }

    const entryParentIds = Object.keys(entry.parentStates);
    if (
      entryParentIds.length !== parentIds.length ||
      !entryParentIds.every((id) => parentIds.includes(id))
    ) {
      return {
        valid: false,
        error: "All CPT entries must have the same parent nodes",
      };
    }
  }

  if (parentIds.length === 0) {
    if (entries.length > 1) {
      return {
        valid: false,
        error: `Root nodes should have exactly one CPT entry, but found ${entries.length}. This can happen if edges were deleted but CPT entries weren't cleaned up.`,
      };
    }
    return { valid: true };
  }

  const coverageCount = new Map<string, number>();

  try {
    for (const entry of entries) {
      const combinations = expandEntry(entry, parentIds);
      for (const combo of combinations) {
        coverageCount.set(combo, (coverageCount.get(combo) || 0) + 1);
      }
    }
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }

  const numCombinations = Math.pow(2, parentIds.length);
  const uncovered: string[] = [];
  const multiCovered: string[] = [];

  for (let i = 0; i < numCombinations; i++) {
    const key = parentIds
      .map((_, idx) => ((i >> idx) & 1 ? "T" : "F"))
      .join("");
    const count = coverageCount.get(key) || 0;

    if (count === 0) {
      uncovered.push(key);
    } else if (count > 1) {
      multiCovered.push(key);
    }
  }

  if (uncovered.length > 0) {
    return {
      valid: false,
      error: `CPT is incomplete: ${uncovered.length} of ${numCombinations} combinations not covered. Missing: ${uncovered.slice(0, 3).join(", ")}${uncovered.length > 3 ? "..." : ""}`,
    };
  }

  if (multiCovered.length > 0) {
    return {
      valid: false,
      error: `CPT has conflicts: ${multiCovered.length} combinations covered by multiple rules. Conflicting: ${multiCovered.slice(0, 3).join(", ")}${multiCovered.length > 3 ? "..." : ""}`,
    };
  }

  return { valid: true };
}
