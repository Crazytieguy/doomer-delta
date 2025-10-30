import { Plus, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { type CPTEntry, validateCPTEntries } from "../../convex/shared/cptValidation";

interface CPTEditorProps {
  cptEntries: CPTEntry[];
  parentNodes: Array<{ _id: Id<"nodes">; title: string }>;
  onChange: (entries: CPTEntry[]) => void;
}

export function CPTEditor({ cptEntries, parentNodes, onChange }: CPTEditorProps) {
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

  const handleParentStateChange = (entryIndex: number, parentId: string, value: boolean | null) => {
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
    onChange(entries);

    const result = validateCPTEntries(entries);
    if (!result.valid) {
      setValidationError(result.error);
    } else {
      setValidationError(null);
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
                {parentIds.map((parentId) => {
                  const parentNode = parentNodes.find(n => n._id === parentId);
                  const parentLabel = parentNode?.title || parentId;
                  return (
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
                        aria-label={`Parent state for ${parentLabel}, rule ${entryIndex + 1}`}
                      >
                        <option value="any">any</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    </td>
                  );
                })}
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
                    aria-label={`Probability for rule ${entryIndex + 1}`}
                  />
                </td>
                <td>
                  <button
                    className="btn btn-xs btn-ghost"
                    onClick={() => handleDeleteRow(entryIndex)}
                    disabled={localEntries.length === 1}
                    aria-label="Delete rule"
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

