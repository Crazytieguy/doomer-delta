import { useMutation } from "convex/react";
import { Trash2, Plus } from "lucide-react";
import { useState, useRef, useEffect } from "react";
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

export function GraphEditor({ modelId, nodes, edges }: GraphEditorProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<Id<"nodes"> | null>(null);
  const [draggingNode, setDraggingNode] = useState<Id<"nodes"> | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isCreatingEdge, setIsCreatingEdge] = useState(false);
  const [edgeStart, setEdgeStart] = useState<Id<"nodes"> | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const svgRef = useRef<SVGSVGElement>(null);

  const createNode = useMutation(api.nodes.create);
  const updateNode = useMutation(api.nodes.update);
  const deleteNode = useMutation(api.nodes.remove);
  const createEdge = useMutation(api.edges.create);
  const deleteEdge = useMutation(api.edges.remove);

  const screenToWorld = (screenX: number, screenY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (screenX - rect.left - pan.x) / zoom,
      y: (screenY - rect.top - pan.y) / zoom,
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.target === svgRef.current) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (draggingNode) {
      const worldPos = screenToWorld(e.clientX, e.clientY);
      void updateNode({
        id: draggingNode,
        x: worldPos.x - dragOffset.x,
        y: worldPos.y - dragOffset.y,
      });
    } else if (isCreatingEdge) {
      setMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setDraggingNode(null);
    setIsCreatingEdge(false);
    setEdgeStart(null);
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.target === svgRef.current) {
      const worldPos = screenToWorld(e.clientX, e.clientY);
      void createNode({
        modelId,
        title: "New Node",
        x: worldPos.x,
        y: worldPos.y,
      });
    }
  };

  const handleNodeMouseDown = (
    e: React.MouseEvent,
    nodeId: Id<"nodes">,
    nodeX: number,
    nodeY: number,
  ) => {
    e.stopPropagation();
    const worldPos = screenToWorld(e.clientX, e.clientY);
    setDraggingNode(nodeId);
    setDragOffset({ x: worldPos.x - nodeX, y: worldPos.y - nodeY });
  };

  const handleNodeConnectStart = (e: React.MouseEvent, nodeId: Id<"nodes">) => {
    e.stopPropagation();
    setIsCreatingEdge(true);
    setEdgeStart(nodeId);
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleNodeConnectEnd = (nodeId: Id<"nodes">) => {
    if (isCreatingEdge && edgeStart && edgeStart !== nodeId) {
      void createEdge({
        modelId,
        parentId: edgeStart,
        childId: nodeId,
      });
    }
    setIsCreatingEdge(false);
    setEdgeStart(null);
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.1, Math.min(5, z * delta)));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" && selectedNode) {
        void deleteNode({ id: selectedNode });
        setSelectedNode(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNode, deleteNode]);

  return (
    <div className="relative w-full h-[600px] bg-base-300 rounded-lg overflow-hidden">
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <div className="bg-base-100 px-3 py-2 rounded-lg shadow text-sm">
          Zoom: {Math.round(zoom * 100)}%
        </div>
        <div className="bg-base-100 px-3 py-2 rounded-lg shadow text-sm">
          Double-click to create node
        </div>
      </div>

      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onDoubleClick={handleCanvasDoubleClick}
        onWheel={handleWheel}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {edges.map((edge) => {
            const parent = nodes.find((n) => n._id === edge.parentId);
            const child = nodes.find((n) => n._id === edge.childId);
            if (!parent || !child) return null;

            return (
              <g key={edge._id}>
                <line
                  x1={parent.x + 50}
                  y1={parent.y + 25}
                  x2={child.x + 50}
                  y2={child.y + 25}
                  stroke="currentColor"
                  strokeWidth="2"
                  markerEnd="url(#arrowhead)"
                  className="opacity-50"
                />
                <circle
                  cx={(parent.x + child.x) / 2 + 50}
                  cy={(parent.y + child.y) / 2 + 25}
                  r="8"
                  fill="hsl(var(--b2))"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="cursor-pointer hover:fill-error"
                  onClick={() => void deleteEdge({ id: edge._id })}
                />
              </g>
            );
          })}

          {isCreatingEdge && edgeStart && (
            <line
              x1={
                (nodes.find((n) => n._id === edgeStart)?.x ?? 0) + 50
              }
              y1={
                (nodes.find((n) => n._id === edgeStart)?.y ?? 0) + 25
              }
              x2={(mousePos.x - pan.x) / zoom}
              y2={(mousePos.y - pan.y) / zoom}
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="5,5"
              className="opacity-50"
            />
          )}

          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 10 3, 0 6" fill="currentColor" />
            </marker>
          </defs>

          {nodes.map((node) => (
            <g
              key={node._id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => setSelectedNode(node._id)}
            >
              <rect
                width="100"
                height="50"
                rx="8"
                fill={
                  selectedNode === node._id
                    ? "hsl(var(--p))"
                    : "hsl(var(--b2))"
                }
                stroke="currentColor"
                strokeWidth="2"
                className="cursor-move"
                onMouseDown={(e) =>
                  handleNodeMouseDown(e, node._id, node.x, node.y)
                }
              />
              <text
                x="50"
                y="25"
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-sm font-semibold pointer-events-none select-none"
                fill="currentColor"
              >
                {node.title.length > 12
                  ? node.title.substring(0, 12) + "..."
                  : node.title}
              </text>
              <circle
                cx="95"
                cy="5"
                r="8"
                fill="hsl(var(--s))"
                className="cursor-pointer"
                onMouseDown={(e) => handleNodeConnectStart(e, node._id)}
                onMouseUp={() => handleNodeConnectEnd(node._id)}
              />
              <text
                x="95"
                y="5"
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-xs font-bold pointer-events-none select-none"
                fill="hsl(var(--sc))"
              >
                +
              </text>
            </g>
          ))}
        </g>
      </svg>

      {selectedNode && (
        <NodeInspector
          node={nodes.find((n) => n._id === selectedNode)!}
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
  onUpdate: (updates: { title?: string; description?: string }) => void;
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
              } as any)
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
