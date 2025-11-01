import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { CPTEntry } from "../../convex/shared/cptValidation";

interface CPTEditorProps {
  cptEntries: CPTEntry[];
  parentNodes: Array<{ _id: Id<"nodes">; title: string }>;
  columnOrder?: Id<"nodes">[];
  onChange: (entries: CPTEntry[], columnOrder: Id<"nodes">[]) => void;
  onValidationChange?: (isValid: boolean, error: string | null) => void;
  isReadOnly?: boolean;
}

export function CPTEditor({ cptEntries, parentNodes, columnOrder: initialColumnOrder, onChange, isReadOnly }: CPTEditorProps) {
  const [localEntries, setLocalEntries] = useState(cptEntries);
  const [isReorderingMode, setIsReorderingMode] = useState(false);
  const [columnOrder, setColumnOrder] = useState<Id<"nodes">[]>([]);

  useEffect(() => {
    setLocalEntries(cptEntries);
    const savedOrder = initialColumnOrder || Object.keys(cptEntries[0]?.parentStates || {}) as Id<"nodes">[];
    if (savedOrder.length > 0) {
      setColumnOrder(savedOrder);
    }
  }, [cptEntries, initialColumnOrder]);

  const parentIds = columnOrder.length > 0 ? columnOrder : Object.keys(localEntries[0]?.parentStates || {}) as Id<"nodes">[];

  // Helper: Find complement row (same parentStates except specified parent is opposite)
  const findComplementRow = (entries: CPTEntry[], entryIndex: number, parentId: string): number | null => {
    const targetEntry = entries[entryIndex];
    const targetValue = targetEntry.parentStates[parentId];

    // Only true/false have complements
    if (targetValue === null) return null;

    for (let i = 0; i < entries.length; i++) {
      if (i === entryIndex) continue;

      const entry = entries[i];
      let isComplement = true;

      for (const pid of Object.keys(targetEntry.parentStates)) {
        if (pid === parentId) {
          // This parent should be opposite
          if (entry.parentStates[pid] !== !targetValue) {
            isComplement = false;
            break;
          }
        } else {
          // All other parents should match
          if (entry.parentStates[pid] !== targetEntry.parentStates[pid]) {
            isComplement = false;
            break;
          }
        }
      }

      if (isComplement) return i;
    }

    return null;
  };

  // Helper: Create complement entry
  const createComplement = (entry: CPTEntry, parentId: string, currentValue: boolean): CPTEntry => {
    return {
      parentStates: {
        ...entry.parentStates,
        [parentId]: !currentValue,
      },
      probability: entry.probability, // Copy same probability
    };
  };

  const handleParentStateChange = (entryIndex: number, parentId: string, value: boolean | null) => {
    const newEntries = [...localEntries];
    const currentEntry = newEntries[entryIndex];
    const oldValue = currentEntry.parentStates[parentId];

    // Case 1: any → true/false (create complement)
    if (oldValue === null && value !== null) {
      const complementRow = findComplementRow(newEntries, entryIndex, parentId);

      // Update current row
      newEntries[entryIndex] = {
        ...currentEntry,
        parentStates: {
          ...currentEntry.parentStates,
          [parentId]: value,
        },
      };

      // Create complement if it doesn't exist
      if (complementRow === null) {
        const complement = createComplement(newEntries[entryIndex], parentId, value);
        newEntries.splice(entryIndex + 1, 0, complement);
      }
    }
    // Case 2: true ↔ false (swap complement)
    else if (oldValue !== null && value !== null && oldValue !== value) {
      const complementRow = findComplementRow(newEntries, entryIndex, parentId);

      // Update current row
      newEntries[entryIndex] = {
        ...currentEntry,
        parentStates: {
          ...currentEntry.parentStates,
          [parentId]: value,
        },
      };

      // Swap complement row if it exists
      if (complementRow !== null) {
        newEntries[complementRow] = {
          ...newEntries[complementRow],
          parentStates: {
            ...newEntries[complementRow].parentStates,
            [parentId]: !value,
          },
        };
      }
    }
    // Case 3: true/false → any (delete complement)
    else if (oldValue !== null && value === null) {
      const complementRow = findComplementRow(newEntries, entryIndex, parentId);

      // Update current row
      newEntries[entryIndex] = {
        ...currentEntry,
        parentStates: {
          ...currentEntry.parentStates,
          [parentId]: value,
        },
      };

      // Delete complement row if it exists
      if (complementRow !== null) {
        newEntries.splice(complementRow, 1);
      }
    }
    // Case 4: any → any (no change, shouldn't happen but handle it)
    else {
      newEntries[entryIndex] = {
        ...currentEntry,
        parentStates: {
          ...currentEntry.parentStates,
          [parentId]: value,
        },
      };
    }

    setLocalEntries(newEntries);
    onChange(newEntries, parentIds);
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
    setLocalEntries(newEntries);
    onChange(newEntries, parentIds);
  };

  const handleMoveRowUp = (index: number) => {
    if (index === 0) return;
    const newEntries = [...localEntries];
    [newEntries[index - 1], newEntries[index]] = [newEntries[index], newEntries[index - 1]];
    setLocalEntries(newEntries);
    onChange(newEntries, parentIds);
  };

  const handleMoveRowDown = (index: number) => {
    if (index === localEntries.length - 1) return;
    const newEntries = [...localEntries];
    [newEntries[index], newEntries[index + 1]] = [newEntries[index + 1], newEntries[index]];
    setLocalEntries(newEntries);
    onChange(newEntries, parentIds);
  };

  const reconstructEntriesWithColumnOrder = (entries: CPTEntry[], newOrder: Id<"nodes">[]) => {
    return entries.map((entry) => {
      const newParentStates: Record<string, boolean | null> = {};
      for (const parentId of newOrder) {
        if (parentId in entry.parentStates) {
          newParentStates[parentId] = entry.parentStates[parentId];
        }
      }
      return {
        parentStates: newParentStates,
        probability: entry.probability,
      };
    });
  };

  const handleMoveColumnLeft = (columnIndex: number) => {
    if (columnIndex === 0) return;
    const newOrder = [...columnOrder];
    [newOrder[columnIndex - 1], newOrder[columnIndex]] = [newOrder[columnIndex], newOrder[columnIndex - 1]];
    setColumnOrder(newOrder);
    const reconstructed = reconstructEntriesWithColumnOrder(localEntries, newOrder);
    setLocalEntries(reconstructed);
    onChange(reconstructed, newOrder);
  };

  const handleMoveColumnRight = (columnIndex: number) => {
    if (columnIndex === parentIds.length - 1) return;
    const newOrder = [...columnOrder];
    [newOrder[columnIndex], newOrder[columnIndex + 1]] = [newOrder[columnIndex + 1], newOrder[columnIndex]];
    setColumnOrder(newOrder);
    const reconstructed = reconstructEntriesWithColumnOrder(localEntries, newOrder);
    setLocalEntries(reconstructed);
    onChange(reconstructed, newOrder);
  };

  if (parentNodes.length === 0) {
    const probability = localEntries[0]?.probability ?? 0.5;

    if (isReadOnly) {
      return (
        <div>
          <label className="label">
            <span className="label-text">Base Probability</span>
          </label>
          <p className="text-lg font-semibold">
            {(probability * 100).toFixed(1)}% ({probability.toFixed(2)})
          </p>
          <span className="label-text-alt opacity-70">
            Prior probability (no parents)
          </span>
        </div>
      );
    }

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
          value={probability}
          onChange={(e) => handleProbabilityChange(0, parseFloat(e.target.value))}
        />
        <span className="label-text-alt opacity-70">
          Prior probability (no parents)
        </span>
      </div>
    );
  }

  if (isReadOnly) {
    return (
      <div className="space-y-3">
        <label className="label">
          <span className="label-text font-semibold">Conditional Probability Table</span>
        </label>

        <div className="overflow-x-auto">
          <table className="table table-xs">
            <thead>
              <tr>
                {parentNodes.map((parent) => (
                  <th key={parent._id}>{parent.title}</th>
                ))}
                <th>Probability</th>
              </tr>
            </thead>
            <tbody>
              {localEntries.map((entry, entryIndex) => (
                <tr key={entryIndex}>
                  {parentIds.map((parentId) => {
                    const state = entry.parentStates[parentId];
                    const displayValue = state === null ? "any" : state ? "true" : "false";
                    return (
                      <td key={parentId} className="font-mono">
                        {displayValue}
                      </td>
                    );
                  })}
                  <td className="font-semibold">
                    {(entry.probability * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs opacity-70">
          Each rule specifies parent states (true/false/any) and the node probability, with "any" matching
          both true and false.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="label-text font-semibold">Conditional Probability Table</span>
        <button
          type="button"
          className={`btn btn-xs btn-ghost btn-circle ${isReorderingMode ? "btn-active" : ""}`}
          onClick={() => setIsReorderingMode(!isReorderingMode)}
          aria-label={isReorderingMode ? "Hide reordering controls" : "Show reordering controls"}
          title={isReorderingMode ? "Hide reordering controls" : "Show reordering controls"}
        >
          <ArrowUpDown className="w-3 h-3" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table table-xs table-zebra">
          <thead>
            <tr className="bg-base-300/40">
              {isReorderingMode && <th></th>}
              {parentIds.map((parentId, columnIndex) => {
                const parent = parentNodes.find(p => p._id === parentId);
                if (!parent) return null;
                const canRemove = localEntries.every(
                  (entry) => entry.parentStates[parent._id] === null
                );
                return (
                  <th key={parent._id} className="relative">
                    <div className="flex flex-col">
                      {isReorderingMode && (
                        <div className="flex justify-center gap-1">
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost px-1"
                            onClick={() => handleMoveColumnLeft(columnIndex)}
                            disabled={columnIndex === 0}
                            aria-label="Move column left"
                          >
                            <ArrowLeft className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost px-1"
                            onClick={() => handleMoveColumnRight(columnIndex)}
                            disabled={columnIndex === parentIds.length - 1}
                            aria-label="Move column right"
                          >
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-center text-xs">{parent.title}</span>
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
                              const newOrder = parentIds.filter(id => id !== parent._id);
                              setLocalEntries(newEntries);
                              setColumnOrder(newOrder);
                              onChange(newEntries, newOrder);
                            }}
                            aria-label={`Remove parent ${parent.title}`}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  </th>
                );
              })}
              <th>
                <div className="flex flex-col">
                  {isReorderingMode && <div className="h-[24px]"></div>}
                  <span className="text-center text-xs">Probability</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {localEntries.map((entry, entryIndex) => (
              <tr key={entryIndex}>
                {isReorderingMode && (
                  <td className="!p-0">
                    <div className="flex">
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost px-1"
                        onClick={() => handleMoveRowUp(entryIndex)}
                        disabled={entryIndex === 0}
                        aria-label="Move rule up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost px-1"
                        onClick={() => handleMoveRowDown(entryIndex)}
                        disabled={entryIndex === localEntries.length - 1}
                        aria-label="Move rule down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                )}
                {parentIds.map((parentId) => {
                  const parentNode = parentNodes.find(n => n._id === parentId);
                  const parentLabel = parentNode?.title || parentId;
                  const currentValue = entry.parentStates[parentId];
                  const hasComplement = currentValue !== null && findComplementRow(localEntries, entryIndex, parentId) !== null;
                  const isDisabled = currentValue !== null && !hasComplement;
                  const displayValue = currentValue === null ? "any" : currentValue ? "true" : "false";

                  return (
                    <td key={parentId}>
                      <select
                        className="select select-xs w-full min-w-12 px-2 bg-gradient-to-r from-base-100 to-base-100/80 [background-position:calc(100%_-_10px)_calc(1px_+_50%),calc(100%_-_6.1px)_calc(1px_+_50%)] disabled:bg-base-100 disabled:text-base-content/80 disabled:[background-image:none]"
                        value={displayValue}
                        onChange={(e) => {
                          const value =
                            e.target.value === "any"
                              ? null
                              : e.target.value === "true";
                          handleParentStateChange(entryIndex, parentId, value);
                        }}
                        disabled={isDisabled}
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs opacity-70">
        Each rule specifies parent states (true/false/any) and the node probability, with "any" matching
        both true and false.
      </div>
    </div>
  );
}

