import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Copy, Globe, GlobeLock, GitFork } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { GraphEditor, NodeInspector } from "../components/GraphEditor";
import { useToast } from "../components/ToastContext";

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
  const navigate = useNavigate();
  const { data: model } = useSuspenseQuery(
    modelQueryOptions(modelId as Id<"models">),
  );
  const { data: nodes } = useSuspenseQuery(
    nodesQueryOptions(modelId as Id<"models">),
  );
  const { showError, showSuccess } = useToast();

  const [selectedNode, setSelectedNode] = useState<Id<"nodes"> | null>(null);
  const [modelName, setModelName] = useState(model?.name ?? "");
  const [modelDescription, setModelDescription] = useState(model?.description ?? "");
  const [hasModelChanges, setHasModelChanges] = useState(false);

  const isOwner = model?.isOwner ?? false;
  const isReadOnly = !isOwner;

  const updateNode = useMutation(api.nodes.update);
  const deleteNode = useMutation(api.nodes.remove);
  const togglePublic = useMutation(api.models.togglePublic);
  const cloneModel = useMutation(api.models.clone);
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

  const handleSaveModel = async () => {
    if (!model) return;
    const trimmedName = modelName.trim();
    const trimmedDesc = modelDescription.trim();

    if (trimmedName && (trimmedName !== model.name || trimmedDesc !== (model.description || ""))) {
      try {
        await updateModel({
          id: modelId as Id<"models">,
          name: trimmedName,
          description: trimmedDesc || undefined,
        });
        setHasModelChanges(false);
        showSuccess("Model updated successfully");
      } catch (error) {
        showError(error);
      }
    }
  };

  const handleCancelModel = () => {
    if (!model) return;
    setModelName(model.name);
    setModelDescription(model.description || "");
    setHasModelChanges(false);
  };

  const handleModelNameChange = (value: string) => {
    if (!model) return;
    setModelName(value);
    setHasModelChanges(value.trim() !== model.name || modelDescription.trim() !== (model.description || ""));
  };

  const handleModelDescriptionChange = (value: string) => {
    if (!model) return;
    setModelDescription(value);
    setHasModelChanges(modelName.trim() !== model.name || value.trim() !== (model.description || ""));
  };

  const handleTogglePublic = async () => {
    if (!model) return;
    try {
      await togglePublic({ id: modelId as Id<"models"> });
      showSuccess(model.isPublic ? "Model is now private" : "Model is now public");
    } catch (error) {
      showError(error);
    }
  };

  const handleClone = async () => {
    if (!model) return;
    try {
      const newModelId = await cloneModel({ id: modelId as Id<"models"> });
      showSuccess("Model cloned successfully");
      void navigate({ to: "/models/$modelId", params: { modelId: newModelId } });
    } catch (error) {
      showError(error);
    }
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    void navigator.clipboard.writeText(url);
    showSuccess("Link copied to clipboard");
  };

  if (!model) {
    return <div>Model not found</div>;
  }

  const selectedNodeData = nodes.find((n) => n._id === selectedNode);

  const handleNodeSelect = (nodeId: Id<"nodes"> | null) => {
    setSelectedNode(nodeId);
  };

  const handleCloseSidebar = () => {
    setSelectedNode(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="relative z-10 flex gap-4 items-start">
        <div className="flex-1 min-w-0">
          {isReadOnly ? (
            <>
              <h1 className="text-4xl font-bold mt-0 mb-2">{modelName}</h1>
              {modelDescription ? (
                <p className="opacity-70 whitespace-pre-wrap mt-0">{modelDescription}</p>
              ) : (
                <p className="opacity-50 italic mt-0">No description</p>
              )}
            </>
          ) : (
            <form onSubmit={(e) => {
              e.preventDefault();
              void handleSaveModel();
            }}>
              <input
                type="text"
                className="input input-ghost text-4xl font-bold w-full px-0 mb-2"
                value={modelName}
                onChange={(e) => handleModelNameChange(e.target.value)}
              />
              <textarea
                className="textarea textarea-ghost w-full px-0 opacity-70 resize-none"
                style={{ minHeight: 'auto', lineHeight: 1.5 }}
                rows={1}
                placeholder="Add a description..."
                value={modelDescription}
                onChange={(e) => handleModelDescriptionChange(e.target.value)}
                onInput={(e) => {
                  const target = e.currentTarget;
                  target.style.height = 'auto';
                  target.style.height = target.scrollHeight + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSaveModel();
                  }
                }}
              />
              {hasModelChanges && (
                <div className="flex gap-2 mt-2">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!modelName.trim()}>
                    Save
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={handleCancelModel}>
                    Cancel
                  </button>
                </div>
              )}
            </form>
          )}
        </div>

        <div className="not-prose flex gap-2 shrink-0">
          {isOwner && (
            <button
              className="btn btn-sm btn-outline"
              onClick={() => void handleTogglePublic()}
            >
              {model.isPublic ? <GlobeLock className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
              {model.isPublic ? "Make Private" : "Make Public"}
            </button>
          )}
          <button
            className="btn btn-sm btn-outline"
            onClick={handleCopyLink}
          >
            <Copy className="w-4 h-4" />
            Copy Link
          </button>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => void handleClone()}
          >
            <GitFork className="w-4 h-4" />
            Clone
          </button>
        </div>
      </div>

      <div className="not-prose flex flex-1 gap-4 overflow-hidden">
        <div className="flex-1">
          <GraphEditor
            modelId={modelId as Id<"models">}
            nodes={nodes}
            selectedNode={selectedNode}
            onNodeSelect={handleNodeSelect}
            isReadOnly={isReadOnly}
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
                onUpdate={(updates) => {
                  void (async () => {
                    try {
                      await updateNode({ id: selectedNode!, ...updates });
                      showSuccess("Node updated successfully");
                    } catch (error) {
                      showError(error);
                    }
                  })();
                }}
                onDelete={() => {
                  void (async () => {
                    try {
                      await deleteNode({ id: selectedNode! });
                      handleCloseSidebar();
                      showSuccess("Node deleted successfully");
                    } catch (error) {
                      showError(error);
                    }
                  })();
                }}
                isReadOnly={isReadOnly}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
