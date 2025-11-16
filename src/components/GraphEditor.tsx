import { useMutation } from "convex/react";
import { Loader2, Trash2, Maximize, Minimize } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInferenceWorker } from "@/hooks/useInferenceWorker";
import { computeProbabilisticFingerprint } from "@/lib/probabilisticFingerprint";
import { formatProbabilityAsPercentage } from "@/lib/formatProbability";
import ReactFlow, {
  addEdge,
  Connection,
  Controls,
  EdgeChange,
  Edge as FlowEdge,
  Node as FlowNode,
  Handle,
  MiniMap,
  NodeChange,
  NodeProps,
  Panel,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { syncColumnOrderWithCptEntries } from "../../convex/shared/cptValidation";
import { CPTEditor } from "./CPTEditor";
import { SensitivityPanel } from "./SensitivityPanel";
import { useToast } from "./ToastContext";

export type Node = {
  _id: Id<"nodes">;
  _creationTime: number;
  modelId: Id<"models">;
  title: string;
  description?: string;
  x: number;
  y: number;
  cptEntries: Array<{
    parentStates: Record<string, boolean | null>;
    probability: number;
  }>;
  columnOrder?: Id<"nodes">[];
};

interface GraphEditorProps {
  modelId: Id<"models">;
  nodes: Node[];
  selectedNode: Id<"nodes"> | null;
  onNodeSelect: (nodeId: Id<"nodes"> | null) => void;
  isReadOnly?: boolean;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
}

function ProbabilityNode({ data }: NodeProps) {
  const probability = data.probability as number | undefined;
  const label = data.label as string;

  return (
    <div className="px-5 py-3 shadow-md rounded-lg bg-primary/15 border-2 border-base-300/70 transition-all duration-200 hover:shadow-lg hover:border-primary/30">
      <Handle type="target" position={Position.Top} className="!bg-accent" />
      <div className="text-center">
        <div className="font-medium text-base text-base-content leading-tight">
          {label}
        </div>
        {probability !== undefined && (
          <div className="text-sm text-base-content/60 mt-2 tabular-nums">
            {formatProbabilityAsPercentage(probability)}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-accent" />
    </div>
  );
}

const nodeTypes = {
  probability: ProbabilityNode,
};

export function GraphEditor({
  modelId,
  nodes: dbNodes,
  selectedNode,
  onNodeSelect,
  isReadOnly,
  isFullScreen,
  onToggleFullScreen,
}: GraphEditorProps) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner
        modelId={modelId}
        nodes={dbNodes}
        selectedNode={selectedNode}
        onNodeSelect={onNodeSelect}
        isReadOnly={isReadOnly}
        isFullScreen={isFullScreen}
        onToggleFullScreen={onToggleFullScreen}
      />
    </ReactFlowProvider>
  );
}

function GraphEditorInner({
  modelId,
  nodes: dbNodes,
  selectedNode,
  onNodeSelect,
  isReadOnly = false,
  isFullScreen = false,
  onToggleFullScreen,
}: GraphEditorProps) {
  const { screenToFlowPosition } = useReactFlow();
  const { showError, showSuccess } = useToast();

  const createNode = useMutation(api.nodes.create);
  const updateNode = useMutation(api.nodes.update).withOptimisticUpdate(
    (localStore, args) => {
      const currentNodes = localStore.getQuery(api.nodes.listByModel, {
        modelId,
      });
      if (currentNodes) {
        const updatedNodes = currentNodes.map((node) => {
          if (node._id !== args.id) return node;

          const updates: Partial<typeof node> = {
            ...(args.title !== undefined && { title: args.title }),
            ...(args.description !== undefined && {
              description: args.description,
            }),
            ...(args.x !== undefined && { x: args.x }),
            ...(args.y !== undefined && { y: args.y }),
            ...(args.cptEntries !== undefined && {
              cptEntries: args.cptEntries,
            }),
            ...(args.columnOrder !== undefined && {
              columnOrder: args.columnOrder,
            }),
          };

          if (args.cptEntries !== undefined && args.columnOrder === undefined) {
            updates.columnOrder = syncColumnOrderWithCptEntries(
              args.cptEntries,
              node.columnOrder,
            );
          }

          return {
            ...node,
            ...updates,
          };
        });

        localStore.setQuery(api.nodes.listByModel, { modelId }, updatedNodes);
      }
    },
  );
  const deleteNode = useMutation(api.nodes.remove).withOptimisticUpdate(
    (localStore, args) => {
      const currentNodes = localStore.getQuery(api.nodes.listByModel, {
        modelId,
      });
      if (currentNodes) {
        const filteredNodes = currentNodes.filter((n) => n._id !== args.id);

        const updatedNodes = filteredNodes.map((node) => {
          const hasDeletedParent = node.cptEntries.some(
            (entry) => args.id in entry.parentStates,
          );
          if (!hasDeletedParent) return node;

          const newCptEntries = node.cptEntries.map((entry) => {
            const newParentStates = { ...entry.parentStates };
            delete newParentStates[args.id];
            return { ...entry, parentStates: newParentStates };
          });

          return {
            ...node,
            cptEntries: newCptEntries,
            columnOrder: syncColumnOrderWithCptEntries(
              newCptEntries,
              node.columnOrder,
            ),
          };
        });

        localStore.setQuery(api.nodes.listByModel, { modelId }, updatedNodes);
      }
    },
  );

  const { computeMarginals, marginalsState } = useInferenceWorker();
  const dbNodesRef = useRef(dbNodes);
  dbNodesRef.current = dbNodes;

  const probabilisticFingerprint = useMemo(
    () => computeProbabilisticFingerprint(dbNodes),
    [dbNodes],
  );

  useEffect(() => {
    computeMarginals(dbNodesRef.current);
  }, [probabilisticFingerprint, computeMarginals]);

  useEffect(() => {
    if (marginalsState.error) {
      showError(marginalsState.error);
    }
  }, [marginalsState.error, showError]);

  const initialNodes: FlowNode[] = dbNodes.map((node) => ({
    id: node._id,
    type: "probability",
    position: { x: node.x, y: node.y },
    selected: node._id === selectedNode,
    data: {
      label: node.title,
      probability: marginalsState.probabilities.get(node._id),
    },
  }));

  const initialEdges: FlowEdge[] = dbNodes.flatMap((node) => {
    const allParentIds = new Set<string>();
    for (const entry of node.cptEntries) {
      Object.keys(entry.parentStates).forEach((id) => allParentIds.add(id));
    }
    return Array.from(allParentIds).map((parentId) => ({
      id: `${parentId}-${node._id}`,
      source: parentId,
      target: node._id,
      type: "default" as const,
    }));
  });

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes((currentNodes) => {
      const dbNodeIds = new Set(dbNodes.map((n) => n._id));
      const currentNodeIds = new Set(currentNodes.map((n) => n.id));

      // Remove nodes that no longer exist in DB
      let updatedNodes = currentNodes.filter((n) =>
        dbNodeIds.has(n.id as Id<"nodes">),
      );

      // Add new nodes from DB
      for (const dbNode of dbNodes) {
        if (!currentNodeIds.has(dbNode._id)) {
          updatedNodes.push({
            id: dbNode._id,
            type: "probability",
            position: { x: dbNode.x, y: dbNode.y },
            selected: dbNode._id === selectedNode,
            data: {
              label: dbNode.title,
              probability: marginalsState.probabilities.get(dbNode._id),
            },
          });
        }
      }

      // Update node labels, probabilities, and selection state (but not positions)
      updatedNodes = updatedNodes.map((node) => {
        const dbNode = dbNodes.find((n) => n._id === node.id);
        const nodeId = node.id as Id<"nodes">;
        const probability = marginalsState.probabilities.get(nodeId);
        const isSelected = nodeId === selectedNode;
        if (
          dbNode &&
          (dbNode.title !== node.data.label ||
            probability !== node.data.probability ||
            node.selected !== isSelected)
        ) {
          return {
            ...node,
            data: { label: dbNode.title, probability },
            selected: isSelected,
          };
        }
        return node;
      });

      return updatedNodes;
    });

    const newEdges: FlowEdge[] = dbNodes.flatMap((node) => {
      const allParentIds = new Set<string>();
      for (const entry of node.cptEntries) {
        Object.keys(entry.parentStates).forEach((id) => allParentIds.add(id));
      }
      return Array.from(allParentIds).map((parentId) => ({
        id: `${parentId}-${node._id}`,
        source: parentId,
        target: node._id,
        type: "default" as const,
      }));
    });
    setEdges(newEdges);
  }, [dbNodes, marginalsState.probabilities, selectedNode, setNodes, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const nonRemoveChanges: NodeChange[] = [];

      changes.forEach((change) => {
        if (change.type === "remove") {
          const nodeId = change.id as Id<"nodes">;
          const childrenWithDependency = dbNodes.filter((childNode) =>
            childNode.cptEntries.some((entry) => {
              const parentState = entry.parentStates[nodeId];
              return parentState !== undefined && parentState !== null;
            }),
          );

          if (childrenWithDependency.length > 0) {
            const childTitles = childrenWithDependency
              .map((n) => n.title)
              .join(", ");
            showError(
              `Cannot delete: ${childTitles} ${childrenWithDependency.length > 1 ? "have" : "has"} specific probabilities for this node. Set to "any" first.`,
            );
            return;
          }

          void (async () => {
            try {
              await deleteNode({ id: nodeId });
              showSuccess("Node deleted successfully");
            } catch (error) {
              showError(error);
            }
          })();
        } else {
          nonRemoveChanges.push(change);
        }
      });

      if (nonRemoveChanges.length > 0) {
        onNodesChange(nonRemoveChanges);
      }
    },
    [onNodesChange, deleteNode, showSuccess, showError, dbNodes],
  );

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => {
      void updateNode({
        id: node.id as Id<"nodes">,
        x: node.position.x,
        y: node.position.y,
      });
    },
    [updateNode],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const nonRemovalChanges: EdgeChange[] = [];

      changes.forEach((change) => {
        if (change.type === "remove") {
          const [parentId, childId] = change.id.split("-");
          const childNode = dbNodes.find((n) => n._id === childId);

          if (childNode) {
            const canRemove = childNode.cptEntries.every(
              (entry) => entry.parentStates[parentId] === null,
            );

            if (!canRemove) {
              showError(
                `Cannot remove edge: "${childNode.title}" has specific probabilities for this parent. Set all to "any" first.`,
              );
              return;
            }

            const newCptEntries = childNode.cptEntries.map((entry) => {
              const newParentStates = { ...entry.parentStates };
              delete newParentStates[parentId];
              return {
                parentStates: newParentStates,
                probability: entry.probability,
              };
            });

            void (async () => {
              try {
                await updateNode({
                  id: childId as Id<"nodes">,
                  cptEntries: newCptEntries,
                });
                showSuccess("Edge removed successfully");
              } catch (error) {
                showError(error);
              }
            })();
          }
        } else {
          nonRemovalChanges.push(change);
        }
      });

      if (nonRemovalChanges.length > 0) {
        onEdgesChange(nonRemovalChanges);
      }
    },
    [onEdgesChange, dbNodes, updateNode, showSuccess, showError],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));

      if (connection.source && connection.target) {
        const sourceId = connection.source;
        const childNode = dbNodes.find((n) => n._id === connection.target);
        if (childNode) {
          const alreadyHasParent = childNode.cptEntries.some(
            (entry) => sourceId in entry.parentStates,
          );

          if (alreadyHasParent) {
            return;
          }

          const newCptEntries = childNode.cptEntries.map((entry) => ({
            parentStates: {
              ...entry.parentStates,
              [sourceId]: null,
            },
            probability: entry.probability,
          }));
          void updateNode({
            id: connection.target as Id<"nodes">,
            cptEntries: newCptEntries,
          });
        }
      }
    },
    [setEdges, dbNodes, updateNode],
  );

  const handlePaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.detail === 2 && !isReadOnly) {
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        void (async () => {
          const newNodeId = await createNode({
            modelId,
            title: "New Node",
            x: position.x,
            y: position.y,
          });
          onNodeSelect(newNodeId);
        })();
      } else if (event.detail === 1) {
        // Single click on pane - deselect node and close sidebar
        onNodeSelect(null);
      }
    },
    [modelId, createNode, screenToFlowPosition, onNodeSelect, isReadOnly],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => {
      onNodeSelect(node.id as Id<"nodes">);
    },
    [onNodeSelect],
  );

  return (
    <div className="w-full h-full bg-base-200 rounded-lg shadow-md">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={isReadOnly ? undefined : handleNodesChange}
        onEdgesChange={isReadOnly ? undefined : handleEdgesChange}
        onConnect={isReadOnly ? undefined : handleConnect}
        onNodeDragStop={isReadOnly ? undefined : handleNodeDragStop}
        onPaneClick={handlePaneClick}
        onNodeClick={onNodeClick}
        nodesDraggable={!isReadOnly}
        nodesConnectable={!isReadOnly}
        nodesFocusable={!isReadOnly}
        edgesFocusable={!isReadOnly}
        elementsSelectable
        zoomOnDoubleClick={false}
        fitView
      >
        <Controls />
        <MiniMap />
        {isReadOnly ? (
          <Panel
            position="top-left"
            className="bg-warning/10 border border-warning/50 px-3 py-2 rounded-lg shadow-sm text-sm text-warning"
          >
            Read-only mode
          </Panel>
        ) : (
          <Panel
            position="top-left"
            className="bg-base-100/90 backdrop-blur-sm border border-base-300/50 px-3 py-2 rounded-lg shadow-sm text-sm"
          >
            Double-click canvas to create node
          </Panel>
        )}
        {marginalsState.isLoading && (
          <Panel
            position="top-right"
            className="bg-base-100/90 backdrop-blur-sm border border-base-300/50 px-3 py-2 rounded-lg shadow-sm"
          >
            <Loader2 className="w-4 h-4 animate-spin opacity-60" />
          </Panel>
        )}
        {onToggleFullScreen && (
          <Panel
            position="top-right"
            className="bg-base-100/90 backdrop-blur-sm border border-base-300/50 rounded-lg shadow-sm ml-2"
          >
            <button
              className="btn btn-sm btn-ghost gap-1"
              onClick={onToggleFullScreen}
              aria-label={isFullScreen ? "Exit full screen" : "Enter full screen"}
            >
              {isFullScreen ? (
                <>
                  <Minimize className="w-4 h-4" />
                  Exit Full Screen
                </>
              ) : (
                <>
                  <Maximize className="w-4 h-4" />
                  Full Screen
                </>
              )}
            </button>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

export interface NodeInspectorProps {
  node: Node;
  allNodes: Node[];
  onClose: () => void;
  onUpdate: (updates: {
    title?: string;
    description?: string;
    cptEntries?: Array<{
      parentStates: Record<string, boolean | null>;
      probability: number;
    }>;
    columnOrder?: Id<"nodes">[];
  }) => void;
  onDelete: () => void;
  isReadOnly?: boolean;
}

export function NodeInspector({
  node,
  allNodes,
  onClose,
  onUpdate,
  onDelete,
  isReadOnly = false,
}: NodeInspectorProps) {
  const [activeTab, setActiveTab] = useState<"edit" | "sensitivity">("edit");
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [cptEntries, setCptEntries] = useState(node.cptEntries);
  const [columnOrder, setColumnOrder] = useState<Id<"nodes">[] | undefined>(
    node.columnOrder,
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [hasCptValidationError, setHasCptValidationError] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Calculate parent nodes from local cptEntries state, not from node.cptEntries
  const parentNodeIds = Object.keys(cptEntries[0]?.parentStates || {});
  const parentNodes = allNodes.filter((n) => parentNodeIds.includes(n._id));

  // Sync CPT entries when they change externally (e.g., edges added/removed)
  // This is intentional - CPT structure is determined by edges, so edge changes
  // take precedence over local CPT edits. Title/description are NOT synced.
  useEffect(() => {
    setCptEntries(node.cptEntries);
    setColumnOrder(node.columnOrder);
    setHasCptValidationError(false);
  }, [node.cptEntries, node.columnOrder]);

  useEffect(() => {
    if (node.title === "New Node" && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [node.title]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const checkForChanges = (
    newTitle: string,
    newDescription: string,
    newCptEntries: typeof node.cptEntries,
    newColumnOrder: typeof node.columnOrder,
  ) => {
    const titleChanged = newTitle.trim() !== node.title;
    const descChanged = newDescription.trim() !== (node.description ?? "");
    const cptChanged =
      JSON.stringify(newCptEntries) !== JSON.stringify(node.cptEntries);
    const columnOrderChanged =
      JSON.stringify(newColumnOrder) !== JSON.stringify(node.columnOrder);
    return titleChanged || descChanged || cptChanged || columnOrderChanged;
  };

  const handleSave = () => {
    if (title.trim() && !hasCptValidationError) {
      onUpdate({
        title: title.trim(),
        description: description.trim() || undefined,
        cptEntries,
        columnOrder,
      });
      setHasChanges(false);
    }
  };

  const handleCancel = () => {
    setTitle(node.title);
    setDescription(node.description ?? "");
    setCptEntries(node.cptEntries);
    setColumnOrder(node.columnOrder);
    setHasChanges(false);
    setHasCptValidationError(false);
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    setHasChanges(checkForChanges(value, description, cptEntries, columnOrder));
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    setHasChanges(checkForChanges(title, value, cptEntries, columnOrder));
  };

  const handleCptChange = (
    entries: typeof node.cptEntries,
    newColumnOrder: Id<"nodes">[],
  ) => {
    setCptEntries(entries);
    setColumnOrder(newColumnOrder);
    setHasChanges(checkForChanges(title, description, entries, newColumnOrder));
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex justify-between items-center mb-2 px-3">
        <div role="tablist" className="tabs tabs-lift flex-1">
          <button
            role="tab"
            className={`tab ${activeTab === "edit" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("edit")}
          >
            {isReadOnly ? "Details" : "Edit"}
          </button>
          <button
            role="tab"
            className={`tab ${activeTab === "sensitivity" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("sensitivity")}
          >
            Sensitivity
          </button>
        </div>
        <button
          className="btn btn-square btn-sm btn-ghost hover:bg-base-300/50"
          onClick={onClose}
          aria-label="Close node inspector"
        >
          ✕
        </button>
      </div>

      <div className="overflow-y-auto px-3">
        {activeTab === "edit" ? (
          <form
            className="space-y-3 flex-1 px-1"
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            {isReadOnly ? (
              <>
                <h3 className="text-xl font-semibold">{title}</h3>

                {description ? (
                  <p className="opacity-90 whitespace-pre-wrap">
                    {description}
                  </p>
                ) : (
                  <p className="opacity-50 italic">No description</p>
                )}
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="node-title" className="label">
                    <span className="label-text">Title</span>
                  </label>
                  <input
                    id="node-title"
                    ref={titleInputRef}
                    type="text"
                    className="input w-full"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    aria-required="true"
                  />
                </div>

                <div>
                  <label htmlFor="node-description" className="label">
                    <span className="label-text">Description</span>
                  </label>
                  <textarea
                    id="node-description"
                    className="textarea w-full"
                    rows={3}
                    value={description}
                    onChange={(e) => handleDescriptionChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSave();
                      } else if (e.key === "Escape") {
                        e.stopPropagation();
                      }
                    }}
                  />
                </div>
              </>
            )}

            <CPTEditor
              cptEntries={cptEntries}
              parentNodes={parentNodes}
              columnOrder={columnOrder}
              onChange={handleCptChange}
              onValidationChange={(isValid) =>
                setHasCptValidationError(!isValid)
              }
              isReadOnly={isReadOnly}
            />

            {!isReadOnly && (
              <div className="flex gap-2 mb-4">
                <button
                  type="submit"
                  className="btn btn-primary btn-sm flex-1"
                  disabled={
                    !hasChanges || !title.trim() || hasCptValidationError
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm flex-1"
                  onClick={handleCancel}
                  disabled={!hasChanges}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-error btn-sm flex-1"
                  onClick={onDelete}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            )}
          </form>
        ) : (
          <div className="flex-1 px-1">
            <SensitivityPanel nodes={allNodes} targetNodeId={node._id} />
          </div>
        )}
      </div>
    </div>
  );
}
