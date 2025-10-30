import { useMutation } from "convex/react";
import { Trash2 } from "lucide-react";
import { useCallback, useState, useEffect } from "react";
import { CPTEditor } from "./CPTEditor";
import ReactFlow, {
  Controls,
  MiniMap,
  Node as FlowNode,
  Edge as FlowEdge,
  Connection,
  NodeChange,
  EdgeChange,
  Panel,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
} from "reactflow";
import "reactflow/dist/style.css";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

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
};

interface GraphEditorProps {
  modelId: Id<"models">;
  nodes: Node[];
  selectedNode: Id<"nodes"> | null;
  onNodeSelect: (nodeId: Id<"nodes"> | null) => void;
}

export function GraphEditor({ modelId, nodes: dbNodes, selectedNode, onNodeSelect }: GraphEditorProps) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner modelId={modelId} nodes={dbNodes} selectedNode={selectedNode} onNodeSelect={onNodeSelect} />
    </ReactFlowProvider>
  );
}

function GraphEditorInner({ modelId, nodes: dbNodes, onNodeSelect }: GraphEditorProps) {
  const { screenToFlowPosition } = useReactFlow();

  const createNode = useMutation(api.nodes.create);
  const updateNode = useMutation(api.nodes.update);
  const deleteNode = useMutation(api.nodes.remove);

  const initialNodes: FlowNode[] = dbNodes.map((node) => ({
    id: node._id,
    type: "default",
    position: { x: node.x, y: node.y },
    data: { label: node.title },
  }));

  const initialEdges: FlowEdge[] = dbNodes.flatMap((node) => {
    const allParentIds = new Set<string>();
    for (const entry of node.cptEntries) {
      Object.keys(entry.parentStates).forEach(id => allParentIds.add(id));
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
      const dbNodeIds = new Set(dbNodes.map(n => n._id));
      const currentNodeIds = new Set(currentNodes.map(n => n.id));

      // Remove nodes that no longer exist in DB
      let updatedNodes = currentNodes.filter(n => dbNodeIds.has(n.id as Id<"nodes">));

      // Add new nodes from DB
      for (const dbNode of dbNodes) {
        if (!currentNodeIds.has(dbNode._id)) {
          updatedNodes.push({
            id: dbNode._id,
            type: "default",
            position: { x: dbNode.x, y: dbNode.y },
            data: { label: dbNode.title },
          });
        }
      }

      // Update node labels (but not positions)
      updatedNodes = updatedNodes.map(node => {
        const dbNode = dbNodes.find(n => n._id === node.id);
        if (dbNode && dbNode.title !== node.data.label) {
          return { ...node, data: { label: dbNode.title } };
        }
        return node;
      });

      return updatedNodes;
    });

    const newEdges: FlowEdge[] = dbNodes.flatMap((node) => {
      const allParentIds = new Set<string>();
      for (const entry of node.cptEntries) {
        Object.keys(entry.parentStates).forEach(id => allParentIds.add(id));
      }
      return Array.from(allParentIds).map((parentId) => ({
        id: `${parentId}-${node._id}`,
        source: parentId,
        target: node._id,
        type: "default" as const,
      }));
    });
    setEdges(newEdges);
  }, [dbNodes, setNodes, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);

      changes.forEach((change) => {
        if (change.type === "position" && change.position && !change.dragging) {
          void updateNode({
            id: change.id as Id<"nodes">,
            x: change.position.x,
            y: change.position.y,
          });
        }
        if (change.type === "remove") {
          void deleteNode({ id: change.id as Id<"nodes"> });
        }
      });
    },
    [onNodesChange, updateNode, deleteNode]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);

      changes.forEach((change) => {
        if (change.type === "remove") {
          const [parentId, childId] = change.id.split("-");
          const childNode = dbNodes.find((n) => n._id === childId);
          if (childNode) {
            const newCptEntries = childNode.cptEntries.map((entry) => {
              const newParentStates = { ...entry.parentStates };
              delete newParentStates[parentId];
              return {
                parentStates: newParentStates,
                probability: entry.probability,
              };
            });
            void updateNode({
              id: childId as Id<"nodes">,
              cptEntries: newCptEntries,
            });
          }
        }
      });
    },
    [onEdgesChange, dbNodes, updateNode]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));

      if (connection.source && connection.target) {
        const sourceId = connection.source;
        const childNode = dbNodes.find((n) => n._id === connection.target);
        if (childNode) {
          const alreadyHasParent = childNode.cptEntries.some((entry) =>
            sourceId in entry.parentStates
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
    [setEdges, dbNodes, updateNode]
  );

  const handlePaneClick = useCallback((event: React.MouseEvent) => {
    if (event.detail === 2) {
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      void createNode({
        modelId,
        title: "New Node",
        x: position.x,
        y: position.y,
      });
    }
  }, [modelId, createNode, screenToFlowPosition]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: FlowNode) => {
    onNodeSelect(node.id as Id<"nodes">);
  }, [onNodeSelect]);

  return (
    <div className="w-full h-[calc(100vh-16rem)] bg-base-200 rounded-lg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onPaneClick={handlePaneClick}
        onNodeClick={onNodeClick}
        zoomOnDoubleClick={false}
        fitView
      >
        <Controls />
        <MiniMap />
        <Panel position="top-left" className="bg-base-100 px-3 py-2 rounded-lg shadow text-sm">
          Double-click canvas to create node
        </Panel>
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
  }) => void;
  onDelete: () => void;
}

export function NodeInspector({
  node,
  allNodes,
  onClose,
  onUpdate,
  onDelete,
}: NodeInspectorProps) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [cptEntries, setCptEntries] = useState(node.cptEntries);
  const [hasChanges, setHasChanges] = useState(false);

  const parentNodeIds = Object.keys(node.cptEntries[0]?.parentStates || {});
  const parentNodes = allNodes.filter((n) => parentNodeIds.includes(n._id));

  const checkForChanges = (
    newTitle: string,
    newDescription: string,
    newCptEntries: typeof node.cptEntries
  ) => {
    const titleChanged = newTitle.trim() !== node.title;
    const descChanged = newDescription.trim() !== (node.description ?? "");
    const cptChanged = JSON.stringify(newCptEntries) !== JSON.stringify(node.cptEntries);
    return titleChanged || descChanged || cptChanged;
  };

  const handleSave = () => {
    if (title.trim()) {
      onUpdate({
        title: title.trim(),
        description: description.trim() || undefined,
        cptEntries,
      });
      setHasChanges(false);
    }
  };

  const handleCancel = () => {
    setTitle(node.title);
    setDescription(node.description ?? "");
    setCptEntries(node.cptEntries);
    setHasChanges(false);
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    setHasChanges(checkForChanges(value, description, cptEntries));
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    setHasChanges(checkForChanges(title, value, cptEntries));
  };

  const handleCptChange = (entries: typeof node.cptEntries) => {
    setCptEntries(entries);
    setHasChanges(checkForChanges(title, description, entries));
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-lg">Edit Node</h3>
        <button
          className="btn btn-square btn-sm btn-ghost"
          onClick={onClose}
          aria-label="Close node inspector"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3 flex-1 overflow-y-auto">
        <div>
          <label htmlFor="node-title" className="label">
            <span className="label-text">Title</span>
          </label>
          <input
            id="node-title"
            type="text"
            className="input input-border w-full"
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
            className="textarea textarea-border w-full"
            rows={3}
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
          />
        </div>

        <CPTEditor
          cptEntries={cptEntries}
          parentNodes={parentNodes}
          onChange={handleCptChange}
        />

        <div className="flex gap-2">
          <button
            className="btn btn-primary btn-sm flex-1"
            onClick={handleSave}
            disabled={!hasChanges || !title.trim()}
          >
            Save
          </button>
          <button
            className="btn btn-ghost btn-sm flex-1"
            onClick={handleCancel}
            disabled={!hasChanges}
          >
            Cancel
          </button>
          <button className="btn btn-error btn-sm flex-1" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
