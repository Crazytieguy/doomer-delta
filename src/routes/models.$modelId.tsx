import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation } from "convex/react";
import { Copy, GitFork, Globe, GlobeLock } from "lucide-react";
import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { GraphEditor, NodeInspector } from "../components/GraphEditor";
import { ShareDialog } from "../components/ShareDialog";
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
  const { isAuthenticated } = useConvexAuth();

  const { data: model } = useSuspenseQuery(
    modelQueryOptions(modelId as Id<"models">),
  );
  const { data: nodes } = useSuspenseQuery(
    nodesQueryOptions(modelId as Id<"models">),
  );
  const { showError, showSuccess } = useToast();

  const [selectedNode, setSelectedNode] = useState<Id<"nodes"> | null>(null);
  const [modelName, setModelName] = useState(model?.name ?? "");
  const [modelDescription, setModelDescription] = useState(
    model?.description ?? "",
  );
  const [hasModelChanges, setHasModelChanges] = useState(false);

  const isOwner = model?.isOwner ?? false;
  const isReadOnly = !isOwner;

  const updateNode = useMutation(api.nodes.update);
  const deleteNode = useMutation(api.nodes.remove);
  const togglePublic = useMutation(
    api.models.togglePublic,
  ).withOptimisticUpdate((localStore, args) => {
    const currentModel = localStore.getQuery(api.models.get, {
      id: args.id,
    });
    if (currentModel) {
      localStore.setQuery(
        api.models.get,
        { id: args.id },
        {
          ...currentModel,
          isPublic: !currentModel.isPublic,
        },
      );
    }
  });
  const forkModel = useMutation(api.models.fork);
  const updateModel = useMutation(api.models.update).withOptimisticUpdate(
    (localStore, args) => {
      const currentModel = localStore.getQuery(api.models.get, {
        id: modelId as Id<"models">,
      });
      if (currentModel) {
        localStore.setQuery(
          api.models.get,
          { id: modelId as Id<"models"> },
          {
            ...currentModel,
            ...(args.name !== undefined && { name: args.name }),
            ...(args.description !== undefined && {
              description: args.description,
            }),
          },
        );
      }
    },
  );

  const handleSaveModel = async () => {
    if (!model) return;
    const trimmedName = modelName.trim();
    const trimmedDesc = modelDescription.trim();

    if (
      trimmedName &&
      (trimmedName !== model.name || trimmedDesc !== (model.description || ""))
    ) {
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
    setHasModelChanges(
      value.trim() !== model.name ||
        modelDescription.trim() !== (model.description || ""),
    );
  };

  const handleModelDescriptionChange = (value: string) => {
    if (!model) return;
    setModelDescription(value);
    setHasModelChanges(
      modelName.trim() !== model.name ||
        value.trim() !== (model.description || ""),
    );
  };

  const handleTogglePublic = async () => {
    if (!model) return;
    try {
      await togglePublic({ id: modelId as Id<"models"> });
      showSuccess(
        model.isPublic ? "Model is now private" : "Model is now public",
      );
    } catch (error) {
      showError(error);
    }
  };

  const handleFork = async () => {
    if (!model) return;
    try {
      const newModelId = await forkModel({ id: modelId as Id<"models"> });
      showSuccess("Model forked successfully");
      void navigate({
        to: "/models/$modelId",
        params: { modelId: newModelId },
      });
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
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      <div className="relative z-10">
        {isReadOnly ? (
          <>
            <div className="flex gap-4 items-start justify-between mb-2">
              <h1 className="text-4xl font-bold mt-0 mb-0 flex-1">
                {modelName}
              </h1>
              <div className="not-prose flex gap-2 shrink-0 items-start">
                {isOwner ? (
                  <>
                    <button
                      className="btn btn-sm btn-accent"
                      onClick={() => void handleTogglePublic()}
                    >
                      {model.isPublic ? (
                        <GlobeLock className="w-4 h-4" />
                      ) : (
                        <Globe className="w-4 h-4" />
                      )}
                      {model.isPublic ? "Make Private" : "Make Public"}
                    </button>
                    {!model.isPublic && (
                      <ShareDialog modelId={modelId as Id<"models">} />
                    )}
                  </>
                ) : (
                  <span className="badge badge-accent h-8 gap-1">
                    {model.isPublic ? (
                      <Globe className="w-4 h-4" />
                    ) : (
                      <GlobeLock className="w-4 h-4" />
                    )}
                    {model.isPublic ? "Public" : "Private"}
                  </span>
                )}
                <button
                  className="btn btn-sm btn-outline"
                  onClick={handleCopyLink}
                >
                  <Copy className="w-4 h-4" />
                  Copy Link
                </button>
                <div
                  className="tooltip"
                  data-tip={
                    !isAuthenticated ? "Sign in to fork this model" : undefined
                  }
                >
                  <button
                    className="btn btn-sm btn-secondary gap-1"
                    onClick={() => void handleFork()}
                    disabled={!isAuthenticated}
                  >
                    <GitFork className="w-4 h-4" />
                    Fork
                    {(model.uniqueForkers ?? 0) > 0 && (
                      <span className="badge badge-info badge-sm">
                        {model.uniqueForkers}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm opacity-60 mt-0 mb-2">
              <span>by {isOwner ? "You" : model.ownerName}</span>
              <span>•</span>
              <span>{new Date(model._creationTime).toLocaleDateString()}</span>
            </div>
            {modelDescription ? (
              <p className="opacity-70 whitespace-pre-wrap mt-0">
                {modelDescription}
              </p>
            ) : (
              <p className="opacity-50 italic mt-0">No description</p>
            )}
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveModel();
            }}
          >
            <div className="flex gap-4 items-start justify-between mb-2">
              <input
                type="text"
                className="input input-ghost text-4xl font-bold w-full px-0 mb-0 flex-1"
                value={modelName}
                onChange={(e) => handleModelNameChange(e.target.value)}
              />
              <div className="not-prose flex gap-2 shrink-0 items-start">
                {isOwner && (
                  <>
                    <button
                      className="btn btn-sm btn-accent"
                      onClick={() => void handleTogglePublic()}
                    >
                      {model.isPublic ? (
                        <GlobeLock className="w-4 h-4" />
                      ) : (
                        <Globe className="w-4 h-4" />
                      )}
                      {model.isPublic ? "Make Private" : "Make Public"}
                    </button>
                    {!model.isPublic && (
                      <ShareDialog modelId={modelId as Id<"models">} />
                    )}
                  </>
                )}
                <button
                  className="btn btn-sm btn-outline"
                  onClick={handleCopyLink}
                >
                  <Copy className="w-4 h-4" />
                  Copy Link
                </button>
                <div
                  className="tooltip"
                  data-tip={
                    !isAuthenticated ? "Sign in to fork this model" : undefined
                  }
                >
                  <button
                    className="btn btn-sm btn-secondary gap-1"
                    onClick={() => void handleFork()}
                    disabled={!isAuthenticated}
                  >
                    <GitFork className="w-4 h-4" />
                    Fork
                    {(model.uniqueForkers ?? 0) > 0 && (
                      <span className="badge badge-info badge-sm">
                        {model.uniqueForkers}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
            <div
              className="grid mb-4 after:invisible after:whitespace-pre-wrap after:content-[attr(data-value)] after:[grid-area:1/1] after:text-sm after:border after:border-solid after:border-[#0000] after:[line-height:1.5] after:py-1"
              data-value={modelDescription || " "}
            >
              <textarea
                className="textarea textarea-ghost w-full px-0 py-1 opacity-70 resize-none overflow-hidden [grid-area:1/1] [min-height:auto]"
                style={{ lineHeight: 1.5 }}
                rows={1}
                placeholder="Add a description..."
                value={modelDescription}
                onChange={(e) => handleModelDescriptionChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSaveModel();
                  }
                }}
              />
            </div>
            {hasModelChanges && (
              <div className="flex gap-2 mt-2 mb-4">
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!modelName.trim()}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={handleCancelModel}
                >
                  Cancel
                </button>
              </div>
            )}
          </form>
        )}
      </div>

      <div className="not-prose flex flex-1 overflow-hidden shadow-[4px_4px_12px_rgba(0,0,0,0.15)]">
        {/* Desktop layout with resizable panels */}
        <PanelGroup
          autoSaveId="model-editor-layout"
          direction="horizontal"
          className="hidden sm:flex w-full h-full"
        >
          <Panel id="graph" order={1}>
            <GraphEditor
              modelId={modelId as Id<"models">}
              nodes={nodes}
              selectedNode={selectedNode}
              onNodeSelect={handleNodeSelect}
              isReadOnly={isReadOnly}
            />
          </Panel>

          {selectedNodeData && (
            <>
              <PanelResizeHandle className="w-1 bg-accent/35 hover:bg-secondary transition-colors" />
              <Panel
                id="inspector"
                order={2}
                defaultSize={30}
                minSize={20}
                className="min-w-78"
              >
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
              </Panel>
            </>
          )}
        </PanelGroup>

        {/* Mobile layout with overlay */}
        <div className="flex-1 sm:hidden w-full">
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
            <div className="fixed inset-y-0 right-0 w-[85vw] max-w-sm h-full bg-base-100 p-6 rounded-lg border border-base-300 z-30 sm:hidden">
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
