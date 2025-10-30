import { Plus, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import type { Id } from "../../convex/_generated/dataModel";

type ParentState = boolean | null;

interface CPTEntry {
  parentStates: Record<string, ParentState>;
  probability: number;
}

interface CPTEditorProps {
  cptEntries: CPTEntry[];
  parentNodes: Array<{ _id: Id<"nodes">; title: string }>;
  onUpdate: (entries: CPTEntry[]) => void;
}

function expandEntry(entry: CPTEntry, parentIds: string[]): string[] {
  const nullIndices: number[] = [];
  const baseValues: (boolean | null)[] = [];

  for (let i = 0; i < parentIds.length; i++) {
    const val = entry.parentStates[parentIds[i]];
    baseValues.push(val);
    if (val === null) {
      nullIndices.push(i);
    }
  }

  const numExpansions = Math.pow(2, nullIndices.length);
  const combinations: string[] = [];

  for (let i = 0; i < numExpansions; i++) {
    const values = [...baseValues];
    for (let j = 0; j < nullIndices.length; j++) {
      values[nullIndices[j]] = Boolean((i >> j) & 1);
    }
    const key = values.map(v => v ? 'T' : 'F').join('');
    combinations.push(key);
  }

  return combinations;
}

export function CPTEditor({ cptEntries, parentNodes, onUpdate }: CPTEditorProps) {
  const [localEntries, setLocalEntries] = useState(cptEntries);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setLocalEntries(cptEntries);
    setValidationError(null);
  }, [cptEntries]);

  const parentIds = parentNodes.map((p) => p._id);

  const handleAddRow = () => {
    const newEntry: CPTEntry = {
      parentStates: Object.fromEntries(parentIds.map((id) => [id, null])),
      probability: 0.5,
    };
    const newEntries = [...localEntries, newEntry];
    validateAndUpdate(newEntries);
  };

  const handleDeleteRow = (index: number) => {
    const newEntries = localEntries.filter((_, i) => i !== index);
    validateAndUpdate(newEntries);
  };

  const handleParentStateChange = (entryIndex: number, parentId: string, value: ParentState) => {
    const newEntries = [...localEntries];
    newEntries[entryIndex] = {
      ...newEntries[entryIndex],
      parentStates: {
        ...newEntries[entryIndex].parentStates,
        [parentId]: value,
      },
    };
    validateAndUpdate(newEntries);
  };

  const handleProbabilityChange = (entryIndex: number, value: number) => {
    let validValue: number;

    if (isNaN(value) || !isFinite(value)) {
      validValue = localEntries[entryIndex]?.probability ?? 0.5;
    } else {
      validValue = Math.max(0, Math.min(1, value));
    }

    const newEntries = [...localEntries];
    newEntries[entryIndex] = {
      ...newEntries[entryIndex],
      probability: validValue,
    };
    validateAndUpdate(newEntries);
  };

  const validateAndUpdate = (entries: CPTEntry[]) => {
    setLocalEntries(entries);

    if (parentIds.length === 0) {
      setValidationError(null);
      onUpdate(entries);
      return;
    }

    const coverageCount = new Map<string, number>();

    for (const entry of entries) {
      const combinations = expandEntry(entry, parentIds);
      for (const combo of combinations) {
        coverageCount.set(combo, (coverageCount.get(combo) || 0) + 1);
      }
    }

    const numCombinations = Math.pow(2, parentIds.length);
    const uncovered: string[] = [];
    const multiCovered: string[] = [];

    for (let i = 0; i < numCombinations; i++) {
      const key = parentIds.map((_, idx) => Boolean((i >> idx) & 1) ? 'T' : 'F').join('');
      const count = coverageCount.get(key) || 0;

      if (count === 0) {
        uncovered.push(key);
      } else if (count > 1) {
        multiCovered.push(key);
      }
    }

    if (uncovered.length > 0) {
      setValidationError(
        `Incomplete: ${uncovered.length} of ${numCombinations} combinations not covered. Missing: ${uncovered.slice(0, 3).join(', ')}${uncovered.length > 3 ? '...' : ''}`
      );
    } else if (multiCovered.length > 0) {
      setValidationError(
        `Conflicts: ${multiCovered.length} combinations covered by multiple rules. Conflicting: ${multiCovered.slice(0, 3).join(', ')}${multiCovered.length > 3 ? '...' : ''}`
      );
    } else {
      setValidationError(null);
      onUpdate(entries);
    }
  };

  if (parentNodes.length === 0) {
    return (
      <div>
        <label className="label">
          <span className="label-text">Base Probability</span>
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          max="1"
          className="input input-border w-full"
          value={localEntries[0]?.probability ?? 0.5}
          onChange={(e) => handleProbabilityChange(0, parseFloat(e.target.value))}
        />
        <span className="label-text-alt opacity-70">
          Prior probability (no parents)
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className="label">
          <span className="label-text font-semibold">Conditional Probability Table</span>
        </label>
        <button className="btn btn-sm btn-primary" onClick={handleAddRow}>
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
      </div>

      {validationError && (
        <div className="alert alert-error">
          <span>{validationError}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="table table-xs">
          <thead>
            <tr>
              {parentNodes.map((parent) => (
                <th key={parent._id}>{parent.title}</th>
              ))}
              <th>Probability</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {localEntries.map((entry, entryIndex) => (
              <tr key={entryIndex}>
                {parentIds.map((parentId) => (
                  <td key={parentId}>
                    <select
                      className="select select-xs select-border w-full"
                      value={
                        entry.parentStates[parentId] === null
                          ? "any"
                          : entry.parentStates[parentId]
                          ? "true"
                          : "false"
                      }
                      onChange={(e) => {
                        const value =
                          e.target.value === "any"
                            ? null
                            : e.target.value === "true";
                        handleParentStateChange(entryIndex, parentId, value);
                      }}
                    >
                      <option value="any">any</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </td>
                ))}
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    className="input input-xs input-border w-20"
                    value={entry.probability}
                    onChange={(e) =>
                      handleProbabilityChange(entryIndex, parseFloat(e.target.value))
                    }
                  />
                </td>
                <td>
                  <button
                    className="btn btn-xs btn-ghost"
                    onClick={() => handleDeleteRow(entryIndex)}
                    disabled={localEntries.length === 1}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs opacity-70">
        Each rule specifies parent states (true/false/any) and the probability. "any" matches
        both true and false. Rules must not conflict (two rules cannot match the same parent
        state combination).
      </div>
    </div>
  );
}

