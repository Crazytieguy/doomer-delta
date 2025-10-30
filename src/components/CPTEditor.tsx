import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { type CPTEntry, validateCPTEntries } from "../../convex/shared/cptValidation";

interface CPTEditorProps {
  cptEntries: CPTEntry[];
  parentNodes: Array<{ _id: Id<"nodes">; title: string }>;
  onChange: (entries: CPTEntry[]) => void;
  onValidationChange?: (isValid: boolean, error: string | null) => void;
}

export function CPTEditor({ cptEntries, parentNodes, onChange, onValidationChange }: CPTEditorProps) {
  const [localEntries, setLocalEntries] = useState(cptEntries);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setLocalEntries(cptEntries);

    // Validate the new entries instead of blindly clearing errors
    const result = validateCPTEntries(cptEntries);
    if (!result.valid) {
      setValidationError(result.error);
      onValidationChange?.(false, result.error);
    } else {
      setValidationError(null);
      onValidationChange?.(true, null);
    }
  }, [cptEntries]); // eslint-disable-line react-hooks/exhaustive-deps

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
      onValidationChange?.(false, result.error);
    } else {
      setValidationError(null);
      onValidationChange?.(true, null);
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
          className="input w-full"
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
      <label className="label">
        <span className="label-text font-semibold">Conditional Probability Table</span>
      </label>

      <div className="overflow-x-auto">
        <table className="table table-xs">
          <thead>
            <tr>
              {parentNodes.map((parent) => {
                const canRemove = localEntries.every(
                  (entry) => entry.parentStates[parent._id] === null
                );
                return (
                  <th key={parent._id} className="relative">
                    <div className="flex items-center gap-1">
                      <span>{parent.title}</span>
                      {canRemove && (
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost btn-circle opacity-50 hover:opacity-100"
                          onClick={() => {
                            const newEntries = localEntries.map((entry) => {
                              const newParentStates = { ...entry.parentStates };
                              delete newParentStates[parent._id];
                              return {
                                parentStates: newParentStates,
                                probability: entry.probability,
                              };
                            });
                            validateAndUpdate(newEntries);
                          }}
                          aria-label={`Remove parent ${parent.title}`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </th>
                );
              })}
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
                        className="select select-xs w-full min-w-20"
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
                    className="input input-xs w-20"
                    value={entry.probability}
                    onChange={(e) =>
                      handleProbabilityChange(entryIndex, parseFloat(e.target.value))
                    }
                    aria-label={`Probability for rule ${entryIndex + 1}`}
                  />
                </td>
                <td>
                  <button
                    type="button"
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

      <button
        type="button"
        className="btn btn-xs btn-ghost gap-1"
        onClick={handleAddRow}
      >
        <Plus className="w-3 h-3" />
        Add rule
      </button>

      {validationError && (
        <div className={`text-sm ${validationError.includes('conflicts') ? 'text-error' : 'text-warning'}`}>
          {validationError}
        </div>
      )}

      <div className="text-xs opacity-70">
        Each rule specifies parent states (true/false/any) and the node probability, with "any" matching
        both true and false.
      </div>
    </div>
  );
}

