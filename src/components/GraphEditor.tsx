import { useMutation } from "convex/react";
import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node as FlowNode,
  Edge as FlowEdge,
  Connection,
  NodeChange,
  EdgeChange,
  Panel,
} from "reactflow";
import "reactflow/dist/style.css";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type Node = {
  _id: Id<"nodes">;
  _creationTime: number;
  modelId: Id<"models">;
  title: string;
  description?: string;
  x: number;
  y: number;
  cptEntries: Array<{
    parentStates: Record<string, boolean>;
    probability: number;
  }>;
};

type Edge = {
  _id: Id<"edges">;
  _creationTime: number;
  modelId: Id<"models">;
  parentId: Id<"nodes">;
  childId: Id<"nodes">;
};

interface GraphEditorProps {
  modelId: Id<"models">;
  nodes: Node[];
  edges: Edge[];
}

export function GraphEditor({ modelId, nodes: dbNodes, edges: dbEdges }: GraphEditorProps) {
  const [selectedNode, setSelectedNode] = useState<Id<"nodes"> | null>(null);

  const createNode = useMutation(api.nodes.create);
  const updateNode = useMutation(api.nodes.update);
  const deleteNode = useMutation(api.nodes.remove);
  const createEdge = useMutation(api.edges.create);
  const deleteEdge = useMutation(api.edges.remove);

  const flowNodes: FlowNode[] = dbNodes.map((node) => ({
    id: node._id,
    type: "default",
    position: { x: node.x, y: node.y },
    data: { label: node.title },
  }));

  const flowEdges: FlowEdge[] = dbEdges.map((edge) => ({
    id: edge._id,
    source: edge.parentId,
    target: edge.childId,
    type: "default",
  }));

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {

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
    [updateNode, deleteNode]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      changes.forEach((change) => {
        if (change.type === "remove") {
          void deleteEdge({ id: change.id as Id<"edges"> });
        }
      });
    },
    [deleteEdge]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        void createEdge({
          modelId,
          parentId: connection.source as Id<"nodes">,
          childId: connection.target as Id<"nodes">,
        });
      }
    },
    [modelId, createEdge]
  );

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    if (event.detail === 2) {
      const reactFlowBounds = (event.target as HTMLElement).getBoundingClientRect();
      const position = {
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      };

      void createNode({
        modelId,
        title: "New Node",
        x: position.x,
        y: position.y,
      });
    }
  }, [modelId, createNode]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: FlowNode) => {
    setSelectedNode(node.id as Id<"nodes">);
  }, []);

  return (
    <div className="w-full h-[600px] bg-base-300 rounded-lg overflow-hidden">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        onNodeClick={onNodeClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
        <Panel position="top-left" className="bg-base-100 px-3 py-2 rounded-lg shadow text-sm">
          Double-click canvas to create node
        </Panel>
      </ReactFlow>

      {selectedNode && (
        <NodeInspector
          node={dbNodes.find((n) => n._id === selectedNode)!}
          onClose={() => setSelectedNode(null)}
          onUpdate={(updates) =>
            void updateNode({ id: selectedNode, ...updates })
          }
          onDelete={() => {
            void deleteNode({ id: selectedNode });
            setSelectedNode(null);
          }}
        />
      )}
    </div>
  );
}

interface NodeInspectorProps {
  node: Node;
  onClose: () => void;
  onUpdate: (updates: { title?: string; description?: string; cptEntries?: any }) => void;
  onDelete: () => void;
}

function NodeInspector({
  node,
  onClose,
  onUpdate,
  onDelete,
}: NodeInspectorProps) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");

  return (
    <div className="absolute top-4 right-4 w-80 bg-base-100 rounded-lg shadow-lg p-4 z-10">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-lg">Edit Node</h3>
        <button className="btn btn-square btn-sm btn-ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="label">
            <span className="label-text">Title</span>
          </label>
          <input
            type="text"
            className="input input-border w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => onUpdate({ title })}
          />
        </div>

        <div>
          <label className="label">
            <span className="label-text">Description</span>
          </label>
          <textarea
            className="textarea textarea-border w-full"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => onUpdate({ description })}
          />
        </div>

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
            value={node.cptEntries[0]?.probability ?? 0.5}
            onChange={(e) =>
              onUpdate({
                cptEntries: [
                  {
                    parentStates: {},
                    probability: parseFloat(e.target.value),
                  },
                ],
              })
            }
          />
          <span className="label-text-alt opacity-70">
            Probability when no parents
          </span>
        </div>

        <button className="btn btn-error btn-sm w-full" onClick={onDelete}>
          <Trash2 className="w-4 h-4" />
          Delete Node
        </button>
      </div>
    </div>
  );
}
