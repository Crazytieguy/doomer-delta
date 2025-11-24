import { GripHorizontal, GripVertical, Lock, Unlock, X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { CPTEntry } from "../../convex/shared/cptValidation";
import { validateCPTEntries } from "../../convex/shared/cptValidation";
import {
  formatProbability,
  formatProbabilityAsPercentage,
} from "@/lib/formatProbability";

interface CPTEditorProps {
  cptEntries: CPTEntry[];
  parentNodes: Array<{ _id: Id<"nodes">; title: string }>;
  columnOrder?: Id<"nodes">[];
  onChange: (entries: CPTEntry[], columnOrder: Id<"nodes">[]) => void;
  onValidationChange?: (isValid: boolean, error: string | null) => void;
  isReadOnly?: boolean;
}

interface SortableColumnHeaderProps {
  parentId: Id<"nodes">;
  parent: { _id: Id<"nodes">; title: string } | undefined;
  canRemove: boolean;
  onRemove: () => void;
  isActive: boolean;
}

function SortableColumnHeader({
  parentId,
  parent,
  canRemove,
  onRemove,
  isActive,
}: SortableColumnHeaderProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: parentId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={`relative border-r border-base-300/30 ${isActive ? "opacity-50" : ""}`}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            className="cursor-grab active:cursor-grabbing text-base-content/40 hover:text-base-content p-1"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${parent?.title}`}
          >
            <GripHorizontal className="w-3 h-3" />
          </button>
          <span className="text-center text-xs">
            {parent?.title ?? "Unknown"}
          </span>
          {canRemove && (
            <button
              type="button"
              className="btn btn-xs btn-ghost btn-circle opacity-50 hover:opacity-100"
              onClick={onRemove}
              aria-label={`Remove parent ${parent?.title}`}
            >
              ×
            </button>
          )}
        </div>
      </div>
    </th>
  );
}

interface SortableRowProps {
  rowId: string;
  entry: CPTEntry;
  entryIndex: number;
  parentIds: Id<"nodes">[];
  parentNodes: Array<{ _id: Id<"nodes">; title: string }>;
  isLocked: boolean;
  isActive: boolean;
  onParentStateChange: (
    entryIndex: number,
    parentId: string,
    value: boolean | null,
  ) => void;
  onProbabilityChange: (entryIndex: number, value: number) => void;
  onDeleteRow: (index: number) => void;
  findComplementRow: (
    entries: CPTEntry[],
    entryIndex: number,
    parentId: string,
  ) => number | null;
  localEntries: CPTEntry[];
}

function SortableRow({
  rowId,
  entry,
  entryIndex,
  parentIds,
  parentNodes,
  isLocked,
  isActive,
  onParentStateChange,
  onProbabilityChange,
  onDeleteRow,
  findComplementRow,
  localEntries,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform } = useSortable({
    id: rowId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
  };

  return (
    <tr ref={setNodeRef} style={style} className={isActive ? "opacity-50" : ""}>
      <td className="!p-0 border-r border-base-300/30">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-base-content/40 hover:text-base-content p-1 flex items-center justify-center w-full h-full"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder row ${entryIndex + 1}`}
        >
          <GripVertical className="w-3 h-3" />
        </button>
      </td>
      {!isLocked && (
        <td className="!p-0 border-r border-base-300/30">
          <button
            type="button"
            className="btn btn-xs btn-ghost btn-circle"
            onClick={() => onDeleteRow(entryIndex)}
            aria-label="Delete row"
          >
            <X className="w-3 h-3" />
          </button>
        </td>
      )}
      {parentIds.map((parentId) => {
        const parentNode = parentNodes.find((n) => n._id === parentId);
        const parentLabel = parentNode?.title || parentId;
        const currentValue = entry.parentStates[parentId];
        const hasComplement =
          currentValue !== null &&
          findComplementRow(localEntries, entryIndex, parentId) !== null;
        const isDisabled = isLocked && currentValue !== null && !hasComplement;
        const displayValue =
          currentValue === null ? "any" : currentValue ? "true" : "false";

        return (
          <td key={parentId} className="border-r border-base-300/30">
            <select
              className="select select-xs w-full min-w-16 px-2 font-mono [background-position:calc(100%_-_10px)_calc(1px_+_50%),calc(100%_-_6.1px)_calc(1px_+_50%)] disabled:bg-base-100 disabled:text-base-content/80 disabled:[background-image:none]"
              value={displayValue}
              onChange={(e) => {
                const value =
                  e.target.value === "any" ? null : e.target.value === "true";
                onParentStateChange(entryIndex, parentId, value);
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
          step="0.001"
          min="0"
          max="1"
          className="input input-xs w-full font-mono"
          value={entry.probability}
          onChange={(e) =>
            onProbabilityChange(entryIndex, parseFloat(e.target.value))
          }
          aria-label={`Probability for rule ${entryIndex + 1}`}
        />
      </td>
    </tr>
  );
}

export function CPTEditor({
  cptEntries,
  parentNodes,
  columnOrder: initialColumnOrder,
  onChange,
  onValidationChange,
  isReadOnly,
}: CPTEditorProps) {
  const [localEntries, setLocalEntries] = useState(cptEntries);
  const [isLocked, setIsLocked] = useState(true);
  const [columnOrder, setColumnOrder] = useState<Id<"nodes">[]>([]);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<Id<"nodes"> | null>(
    null,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Prevent accidental drags
      },
    }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    setLocalEntries(cptEntries);
    const savedOrder =
      initialColumnOrder ||
      (Object.keys(cptEntries[0]?.parentStates || {}) as Id<"nodes">[]);
    setColumnOrder(savedOrder);
  }, [cptEntries, initialColumnOrder]);

  const parentIds =
    columnOrder.length > 0
      ? columnOrder
      : (Object.keys(localEntries[0]?.parentStates || {}) as Id<"nodes">[]);

  const validation = useMemo(
    () =>
      isLocked ? { valid: true as const } : validateCPTEntries(localEntries),
    [isLocked, localEntries],
  );

  useEffect(() => {
    if (onValidationChange && !isLocked) {
      onValidationChange(
        validation.valid,
        validation.valid ? null : validation.error,
      );
    }
  }, [isLocked, onValidationChange, validation]);

  // Helper: Find complement row (same parentStates except specified parent is opposite)
  const findComplementRow = (
    entries: CPTEntry[],
    entryIndex: number,
    parentId: string,
  ): number | null => {
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
  const createComplement = (
    entry: CPTEntry,
    parentId: string,
    currentValue: boolean,
  ): CPTEntry => {
    return {
      parentStates: {
        ...entry.parentStates,
        [parentId]: !currentValue,
      },
      probability: entry.probability, // Copy same probability
    };
  };

  const handleParentStateChange = (
    entryIndex: number,
    parentId: string,
    value: boolean | null,
  ) => {
    const newEntries = [...localEntries];
    const currentEntry = newEntries[entryIndex];
    const oldValue = currentEntry.parentStates[parentId];

    if (isLocked) {
      // LOCKED MODE: Auto-complement behavior
      // Case 1: any → true/false (create complement)
      if (oldValue === null && value !== null) {
        const complementRow = findComplementRow(
          newEntries,
          entryIndex,
          parentId,
        );

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
          const complement = createComplement(
            newEntries[entryIndex],
            parentId,
            value,
          );
          newEntries.splice(entryIndex + 1, 0, complement);
        }
      }
      // Case 2: true ↔ false (swap complement)
      else if (oldValue !== null && value !== null && oldValue !== value) {
        const complementRow = findComplementRow(
          newEntries,
          entryIndex,
          parentId,
        );

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
        const complementRow = findComplementRow(
          newEntries,
          entryIndex,
          parentId,
        );

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
    } else {
      // UNLOCKED MODE: Free editing, just update the value
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

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    if (id.startsWith("row-")) {
      setActiveRowId(id);
    } else if (id.startsWith("col-")) {
      setActiveColumnId(id as Id<"nodes">);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      setActiveRowId(null);
      setActiveColumnId(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    // Handle row reordering
    if (activeId.startsWith("row-")) {
      setActiveRowId(null);
      // Prevent dropping rows on columns
      if (!overId.startsWith("row-")) return;

      const oldIndex = parseInt(activeId.replace("row-", ""));
      const newIndex = parseInt(overId.replace("row-", ""));

      if (isNaN(oldIndex) || isNaN(newIndex)) return;

      const newEntries = arrayMove(localEntries, oldIndex, newIndex);
      setLocalEntries(newEntries);
      onChange(newEntries, parentIds);
    }
    // Handle column reordering
    else if (activeId.startsWith("col-")) {
      setActiveColumnId(null);
      // Prevent dropping columns on rows
      if (!overId.startsWith("col-")) return;

      const actualActiveId = activeId.replace("col-", "") as Id<"nodes">;
      const actualOverId = overId.replace("col-", "") as Id<"nodes">;
      const oldIndex = columnOrder.indexOf(actualActiveId);
      const newIndex = columnOrder.indexOf(actualOverId);

      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
      setColumnOrder(newOrder);
      const reconstructed = reconstructEntriesWithColumnOrder(
        localEntries,
        newOrder,
      );
      setLocalEntries(reconstructed);
      onChange(reconstructed, newOrder);
    }
  };

  const handleAddRow = () => {
    const newParentStates: Record<string, boolean | null> = {};
    for (const parentId of parentIds) {
      newParentStates[parentId] = null;
    }
    const newEntry: CPTEntry = {
      parentStates: newParentStates,
      probability: 0.5,
    };
    const newEntries = [...localEntries, newEntry];
    setLocalEntries(newEntries);
    onChange(newEntries, parentIds);
  };

  const handleDeleteRow = (index: number) => {
    const newEntries = [...localEntries];
    newEntries.splice(index, 1);
    setLocalEntries(newEntries);
    onChange(newEntries, parentIds);
  };

  const reconstructEntriesWithColumnOrder = (
    entries: CPTEntry[],
    newOrder: Id<"nodes">[],
  ) => {
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

  if (parentNodes.length === 0) {
    const probability = localEntries[0]?.probability ?? 0.5;

    if (isReadOnly) {
      return (
        <div>
          <label className="label">
            <span className="label-text">Base Probability</span>
          </label>
          <p className="text-lg font-medium font-mono tabular-nums">
            {formatProbabilityAsPercentage(probability)} (
            {formatProbability(probability)})
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
          step="0.001"
          min="0"
          max="1"
          className="input w-full font-mono"
          value={probability}
          onChange={(e) =>
            handleProbabilityChange(0, parseFloat(e.target.value))
          }
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
          <span className="label-text font-semibold">
            Conditional Probability Table
          </span>
        </label>

        <div className="overflow-x-auto">
          <table className="table table-xs">
            <thead>
              <tr>
                {parentIds.map((parentId) => {
                  const parent = parentNodes.find((p) => p._id === parentId);
                  return <th key={parentId}>{parent?.title ?? "Unknown"}</th>;
                })}
                <th>Probability</th>
              </tr>
            </thead>
            <tbody>
              {localEntries.map((entry, entryIndex) => (
                <tr key={entryIndex}>
                  {parentIds.map((parentId) => {
                    const state = entry.parentStates[parentId];
                    const displayValue =
                      state === null ? "any" : state ? "true" : "false";
                    return (
                      <td key={parentId} className="font-mono">
                        {displayValue}
                      </td>
                    );
                  })}
                  <td className="font-semibold font-mono tabular-nums">
                    {formatProbabilityAsPercentage(entry.probability)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs opacity-70">
          Each rule specifies parent states (true/false/any) and the node
          probability, with "any" matching both true and false.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="label-text font-semibold">
          Conditional Probability Table
        </span>
        <div
          className="tooltip tooltip-left"
          data-tip={
            !isLocked && !validation.valid
              ? "Fix validation errors before locking"
              : isLocked
                ? "Unlock for free editing"
                : "Lock table"
          }
        >
          <button
            type="button"
            className={`btn btn-xs btn-ghost btn-circle ${isLocked ? "" : "btn-active"}`}
            onClick={() => setIsLocked(!isLocked)}
            disabled={!isLocked && !validation.valid}
            aria-label={isLocked ? "Unlock for free editing" : "Lock table"}
          >
            {isLocked ? (
              <Lock className="w-3 h-3" />
            ) : (
              <Unlock className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto border border-base-300/50 rounded-lg">
          <table className="table table-xs table-zebra border-collapse">
            <thead>
              <tr className="bg-base-300/40 border-b border-base-300/50">
                <th className="w-8"></th>
                {!isLocked && <th></th>}
                <SortableContext
                  items={parentIds.map((id) => `col-${id}` as Id<"nodes">)}
                  strategy={horizontalListSortingStrategy}
                >
                  {parentIds.map((parentId) => {
                    const parent = parentNodes.find((p) => p._id === parentId);
                    if (!parent) return null;
                    const canRemove = localEntries.every(
                      (entry) => entry.parentStates[parent._id] === null,
                    );
                    return (
                      <SortableColumnHeader
                        key={parent._id}
                        parentId={`col-${parentId}` as Id<"nodes">}
                        parent={parent}
                        canRemove={canRemove}
                        isActive={activeColumnId === `col-${parentId}`}
                        onRemove={() => {
                          const newEntries = localEntries.map((entry) => {
                            const newParentStates = {
                              ...entry.parentStates,
                            };
                            delete newParentStates[parent._id];
                            return {
                              parentStates: newParentStates,
                              probability: entry.probability,
                            };
                          });
                          const newOrder = parentIds.filter(
                            (id) => id !== parent._id,
                          );
                          setLocalEntries(newEntries);
                          setColumnOrder(newOrder);
                          onChange(newEntries, newOrder);
                        }}
                      />
                    );
                  })}
                </SortableContext>
                <th>
                  <span className="text-center text-xs">Probability</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <SortableContext
                items={localEntries.map((_, i) => `row-${i}`)}
                strategy={verticalListSortingStrategy}
              >
                {localEntries.map((entry, entryIndex) => (
                  <SortableRow
                    key={entryIndex}
                    rowId={`row-${entryIndex}`}
                    entry={entry}
                    entryIndex={entryIndex}
                    parentIds={parentIds}
                    parentNodes={parentNodes}
                    isLocked={isLocked}
                    isActive={activeRowId === `row-${entryIndex}`}
                    onParentStateChange={handleParentStateChange}
                    onProbabilityChange={handleProbabilityChange}
                    onDeleteRow={handleDeleteRow}
                    findComplementRow={findComplementRow}
                    localEntries={localEntries}
                  />
                ))}
              </SortableContext>
            </tbody>
          </table>
        </div>
      </DndContext>

      {!isLocked && (
        <button
          type="button"
          className="btn btn-sm btn-ghost w-full"
          onClick={handleAddRow}
        >
          + Add Row
        </button>
      )}

      <div className="text-xs opacity-70">
        Each rule specifies parent states (true/false/any) and the node
        probability, with "any" matching both true and false.
      </div>

      {!isLocked && !validation.valid && (
        <div className="alert alert-error text-sm">
          <span>{validation.error}</span>
        </div>
      )}
    </div>
  );
}
