import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { GraphEditor, NodeInspector } from "../components/GraphEditor";

const modelQueryOptions = (modelId: Id<"models">) =>
  convexQuery(api.models.get, { id: modelId });

const nodesQueryOptions = (modelId: Id<"models">) =>
  convexQuery(api.nodes.listByModel, { modelId });

export const Route = createFileRoute("/models/$modelId")({
  loader: async ({ context: { queryClient }, params }) => {
    if ((window as any).Clerk?.session) {
      const modelId = params.modelId as Id<"models">;
      await Promise.all([
        queryClient.ensureQueryData(modelQueryOptions(modelId)),
        queryClient.ensureQueryData(nodesQueryOptions(modelId)),
      ]);
    }
  },
  component: ModelDetailPage,
});

function ModelDetailPage() {
  const { modelId } = Route.useParams();
  const { data: model } = useSuspenseQuery(
    modelQueryOptions(modelId as Id<"models">),
  );
  const { data: nodes } = useSuspenseQuery(
    nodesQueryOptions(modelId as Id<"models">),
  );

  const [selectedNode, setSelectedNode] = useState<Id<"nodes"> | null>(null);
  const [modelName, setModelName] = useState(model.name);
  const [modelDescription, setModelDescription] = useState(model.description || "");
  const [hasModelChanges, setHasModelChanges] = useState(false);

  const updateNode = useMutation(api.nodes.update);
  const deleteNode = useMutation(api.nodes.remove);
  const updateModel = useMutation(api.models.update).withOptimisticUpdate(
    (localStore, args) => {
      const currentModel = localStore.getQuery(api.models.get, { id: modelId as Id<"models"> });
      if (currentModel) {
        localStore.setQuery(api.models.get, { id: modelId as Id<"models"> }, {
          ...currentModel,
          ...(args.name !== undefined && { name: args.name }),
          ...(args.description !== undefined && { description: args.description }),
        });
      }
    }
  );

  const handleSaveModel = () => {
    const trimmedName = modelName.trim();
    const trimmedDesc = modelDescription.trim();

    if (trimmedName && (trimmedName !== model.name || trimmedDesc !== (model.description || ""))) {
      void updateModel({
        id: modelId as Id<"models">,
        name: trimmedName,
        description: trimmedDesc || undefined,
      });
      setHasModelChanges(false);
    }
  };

  const handleCancelModel = () => {
    setModelName(model.name);
    setModelDescription(model.description || "");
    setHasModelChanges(false);
  };

  const handleModelNameChange = (value: string) => {
    setModelName(value);
    setHasModelChanges(value.trim() !== model.name || modelDescription.trim() !== (model.description || ""));
  };

  const handleModelDescriptionChange = (value: string) => {
    setModelDescription(value);
    setHasModelChanges(modelName.trim() !== model.name || value.trim() !== (model.description || ""));
  };

  if (!model) {
    return <div>Model not found</div>;
  }

  const selectedNodeData = nodes.find((n) => n._id === selectedNode);
  const edgeCount = nodes.reduce(
    (sum, node) =>
      sum + Object.keys(node.cptEntries[0]?.parentStates || {}).length,
    0
  );

  const handleNodeSelect = (nodeId: Id<"nodes"> | null) => {
    setSelectedNode(nodeId);
  };

  const handleCloseSidebar = () => {
    setSelectedNode(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div>
        <input
          type="text"
          className="input input-ghost text-4xl font-bold w-full px-0 mb-2"
          value={modelName}
          onChange={(e) => handleModelNameChange(e.target.value)}
        />
        <textarea
          className="textarea textarea-ghost w-full px-0 opacity-70 resize-none"
          rows={1}
          placeholder="Add a description..."
          value={modelDescription}
          onChange={(e) => handleModelDescriptionChange(e.target.value)}
          onInput={(e) => {
            const target = e.currentTarget;
            target.style.height = 'auto';
            target.style.height = target.scrollHeight + 'px';
          }}
        />
        {hasModelChanges && (
          <div className="flex gap-2 mb-2">
            <button className="btn btn-primary btn-sm" onClick={handleSaveModel} disabled={!modelName.trim()}>
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleCancelModel}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="not-prose mb-4 flex gap-4 text-sm">
        <span><strong>Nodes:</strong> {nodes.length}</span>
        <span><strong>Edges:</strong> {edgeCount}</span>
      </div>

      <div className="not-prose flex flex-1 gap-4 overflow-hidden">
        <div className="flex-1">
          <GraphEditor
            modelId={modelId as Id<"models">}
            nodes={nodes}
            selectedNode={selectedNode}
            onNodeSelect={handleNodeSelect}
          />
        </div>

        {selectedNodeData && (
          <>
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-20 sm:hidden"
              onClick={handleCloseSidebar}
              onTouchMove={(e) => e.preventDefault()}
            />
            <div className="fixed inset-y-0 right-0 w-[85vw] max-w-sm sm:relative sm:w-96 sm:max-w-96 h-full bg-base-100 p-6 rounded-lg overflow-y-auto border border-base-300 z-30 sm:z-auto">
              <NodeInspector
                key={selectedNode}
                node={selectedNodeData}
                allNodes={nodes}
                onClose={handleCloseSidebar}
                onUpdate={(updates) =>
                  void updateNode({ id: selectedNode!, ...updates })
                }
                onDelete={() => {
                  void deleteNode({ id: selectedNode! });
                  handleCloseSidebar();
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
