import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation } from "convex/react";
import {
  Copy,
  GitFork,
  Github,
  Globe,
  GlobeLock,
  HelpCircle,
  MoreVertical,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  DeleteModelDialog,
  type DeleteModelDialogRef,
} from "../components/DeleteModelDialog";
import { GraphEditor, NodeInspector, type ToggleInterventionFn, type UserMarks } from "../components/GraphEditor";
import { ShareDialog, type ShareDialogRef } from "../components/ShareDialog";
import { useToast } from "../components/ToastContext";

const GITHUB_ISSUES =
  "https://github.com/Crazytieguy/delta/issues/new";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

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

interface MobileActionsMenuProps {
  isOwner: boolean;
  isPublic: boolean;
  uniqueForkers?: number;
  isAuthenticated: boolean;
  onTogglePublic: () => void;
  onShare: () => void;
  onCopyLink: () => void;
  onFork: () => void;
  onHelp: () => void;
  onDelete: () => void;
}

function MobileActionsMenu({
  isOwner,
  isPublic,
  uniqueForkers,
  isAuthenticated,
  onTogglePublic,
  onShare,
  onCopyLink,
  onFork,
  onHelp,
  onDelete,
}: MobileActionsMenuProps) {
  return (
    <div className="dropdown dropdown-end sm:hidden">
      <div tabIndex={0} role="button" className="btn btn-sm btn-ghost">
        <MoreVertical className="w-4 h-4" />
      </div>
      <ul
        tabIndex={0}
        className="dropdown-content menu bg-base-100 rounded-box w-52 p-2 shadow-lg border border-base-300"
      >
        {isOwner && (
          <>
            <li>
              <button
                className="btn btn-sm btn-accent"
                onClick={onTogglePublic}
              >
                {isPublic ? (
                  <GlobeLock className="w-4 h-4" />
                ) : (
                  <Globe className="w-4 h-4" />
                )}
                {isPublic ? "Make Private" : "Make Public"}
              </button>
            </li>
            {!isPublic && (
              <li>
                <button
                  type="button"
                  className="btn btn-sm btn-outline w-full"
                  onClick={onShare}
                >
                  <UserPlus className="w-4 h-4" />
                  Share
                </button>
              </li>
            )}
          </>
        )}
        <li>
          <button className="btn btn-sm btn-outline" onClick={onCopyLink}>
            <Copy className="w-4 h-4" />
            Copy Link
          </button>
        </li>
        <li>
          <button
            className="btn btn-sm btn-secondary gap-1"
            onClick={onFork}
            disabled={!isAuthenticated}
          >
            <GitFork className="w-4 h-4" />
            Fork
            {(uniqueForkers ?? 0) > 0 && (
              <span className="badge badge-neutral badge-sm font-mono tabular-nums ml-auto">
                {uniqueForkers}
              </span>
            )}
          </button>
        </li>
        {isOwner && (
          <li>
            <button
              className="btn btn-sm btn-error btn-outline"
              onClick={onDelete}
            >
              <Trash2 className="w-4 h-4" />
              Delete Model
            </button>
          </li>
        )}
        <div className="divider my-1"></div>
        <li>
          <button className="btn btn-sm btn-ghost" onClick={onHelp}>
            <HelpCircle className="w-4 h-4" />
            Help
          </button>
        </li>
      </ul>
    </div>
  );
}

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
  const [newlyCreatedNodeId, setNewlyCreatedNodeId] =
    useState<Id<"nodes"> | null>(null);
  const [modelName, setModelName] = useState(model?.name ?? "");
  const [modelDescription, setModelDescription] = useState(
    model?.description ?? "",
  );
  const [hasModelChanges, setHasModelChanges] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [interventionNodes, setInterventionNodes] = useState<
    Set<Id<"nodes">> | undefined
  >(undefined);
  const [userMarks, setUserMarks] = useState<UserMarks>(() => {
    const nodeIds = new Set(nodes.map((n) => n._id));
    const stored = localStorage.getItem(`interventionMarks-${modelId}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { marked: Id<"nodes">[]; unmarked: Id<"nodes">[] };
        return {
          marked: new Set(parsed.marked.filter((id) => nodeIds.has(id))),
          unmarked: new Set(parsed.unmarked.filter((id) => nodeIds.has(id))),
        };
      } catch {
        return { marked: new Set(), unmarked: new Set() };
      }
    }
    return { marked: new Set(), unmarked: new Set() };
  });
  const shareDialogRef = useRef<ShareDialogRef>(null);
  const deleteDialogRef = useRef<DeleteModelDialogRef>(null);
  const toggleInterventionRef = useRef<ToggleInterventionFn | null>(null);
  const isDesktop = useMediaQuery("(min-width: 640px)");

  // Sync userMarks to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        `interventionMarks-${modelId}`,
        JSON.stringify({
          marked: Array.from(userMarks.marked),
          unmarked: Array.from(userMarks.unmarked),
        }),
      );
    } catch {
      // Storage unavailable (private browsing, quota exceeded)
    }
  }, [userMarks, modelId]);

  // Re-initialize userMarks when modelId changes (e.g., after forking)
  const prevModelIdRef = useRef(modelId);
  useEffect(() => {
    if (prevModelIdRef.current !== modelId) {
      prevModelIdRef.current = modelId;
      const nodeIds = new Set(nodes.map((n) => n._id));
      const stored = localStorage.getItem(`interventionMarks-${modelId}`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { marked: Id<"nodes">[]; unmarked: Id<"nodes">[] };
          setUserMarks({
            marked: new Set(parsed.marked.filter((id) => nodeIds.has(id))),
            unmarked: new Set(parsed.unmarked.filter((id) => nodeIds.has(id))),
          });
        } catch {
          setUserMarks({ marked: new Set(), unmarked: new Set() });
        }
      } else {
        setUserMarks({ marked: new Set(), unmarked: new Set() });
      }
    }
  }, [modelId, nodes]);

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

  const handleDelete = () => {
    deleteDialogRef.current?.openDialog();
  };

  const handleModelDeleted = () => {
    void navigate({ to: "/models/my" });
  };

  if (!model) {
    return <div>Model not found</div>;
  }

  const selectedNodeData = nodes.find((n) => n._id === selectedNode);

  const handleNodeSelect = (
    nodeId: Id<"nodes"> | null,
    isNewlyCreated = false,
  ) => {
    setSelectedNode(nodeId);
    if (isNewlyCreated) {
      setNewlyCreatedNodeId(nodeId);
    }
  };

  const handleCloseSidebar = () => {
    setSelectedNode(null);
    setNewlyCreatedNodeId(null);
  };

  return (
    <>
      {isFullScreen && (
        <div className="fixed inset-0 z-50 bg-base-100 flex">
          <div className="not-prose flex flex-1 overflow-hidden">
            <PanelGroup
              autoSaveId="model-editor-layout"
              direction="horizontal"
              className="w-full h-full"
            >
              <Panel id="graph" order={1}>
                <GraphEditor
                  modelId={modelId as Id<"models">}
                  nodes={nodes}
                  selectedNode={selectedNode}
                  onNodeSelect={handleNodeSelect}
                  isReadOnly={isReadOnly}
                  isFullScreen={isFullScreen}
                  onToggleFullScreen={() => setIsFullScreen(!isFullScreen)}
                  onInterventionNodesChange={setInterventionNodes}
                  toggleInterventionRef={toggleInterventionRef}
                  userMarks={userMarks}
                  onUserMarksChange={setUserMarks}
                />
              </Panel>

              {selectedNodeData && (
                <>
                  <PanelResizeHandle className="w-2 bg-base-300 hover:bg-accent/30 active:bg-accent/40 transition-all cursor-col-resize relative before:content-[''] before:absolute before:inset-y-0 before:left-1/2 before:-translate-x-1/2 before:w-0.5 before:my-auto before:h-8 before:bg-[repeating-linear-gradient(transparent,transparent_2px,currentColor_2px,currentColor_4px)] before:opacity-60 hover:before:opacity-90 active:before:opacity-100" />
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
                      interventionNodes={interventionNodes ?? new Set()}
                      onClose={handleCloseSidebar}
                      onUpdate={(updates) => {
                        void (async () => {
                          if (
                            !selectedNode ||
                            !nodes.some((n) => n._id === selectedNode)
                          ) {
                            return;
                          }
                          try {
                            await updateNode({ id: selectedNode, ...updates });
                            showSuccess("Node updated successfully");
                            setNewlyCreatedNodeId(null);
                          } catch (error) {
                            showError(error);
                          }
                        })();
                      }}
                      onDelete={() => {
                        void (async () => {
                          if (
                            !selectedNode ||
                            !nodes.some((n) => n._id === selectedNode)
                          ) {
                            return;
                          }
                          try {
                            await deleteNode({ id: selectedNode });
                            handleCloseSidebar();
                            showSuccess("Node deleted successfully");
                          } catch (error) {
                            showError(error);
                          }
                        })();
                      }}
                      onToggleIntervention={
                        selectedNode
                          ? () => toggleInterventionRef.current?.(selectedNode)
                          : undefined
                      }
                      isReadOnly={isReadOnly}
                      isNewlyCreated={selectedNode === newlyCreatedNodeId}
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </div>
        </div>
      )}
      <div
        className={`flex flex-col ${isFullScreen ? "hidden" : "h-[calc(100vh-7rem)]"}`}
      >
        <div className="relative z-10">
          {isReadOnly ? (
            <>
              <div className="flex gap-4 items-center justify-between mb-2">
                <h1 className="text-2xl sm:text-4xl font-bold mt-0 mb-0 flex-1">
                  {modelName}
                </h1>
                <div className="not-prose hidden sm:flex gap-2 shrink-0 items-center">
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
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => shareDialogRef.current?.openDialog()}
                        >
                          <UserPlus className="w-4 h-4" />
                          Share
                        </button>
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
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={handleCopyLink}
                  >
                    <Copy className="w-4 h-4" />
                    Copy Link
                  </button>
                  <div
                    className="tooltip"
                    data-tip={
                      !isAuthenticated
                        ? "Sign in to fork this model"
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary gap-1"
                      onClick={() => void handleFork()}
                      disabled={!isAuthenticated}
                    >
                      <GitFork className="w-4 h-4" />
                      Fork
                      {(model.uniqueForkers ?? 0) > 0 && (
                        <span className="badge badge-neutral badge-sm font-mono tabular-nums">
                          {model.uniqueForkers}
                        </span>
                      )}
                    </button>
                  </div>
                  {isOwner && (
                    <button
                      type="button"
                      className="btn btn-sm btn-error btn-outline btn-circle"
                      onClick={handleDelete}
                      aria-label="Delete model"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-circle"
                    onClick={() => setShowHelp(true)}
                    aria-label="Help"
                  >
                    <HelpCircle className="w-5 h-5" />
                  </button>
                </div>
                <MobileActionsMenu
                  isOwner={isOwner}
                  isPublic={model.isPublic}
                  uniqueForkers={model.uniqueForkers}
                  isAuthenticated={isAuthenticated}
                  onTogglePublic={() => void handleTogglePublic()}
                  onShare={() => shareDialogRef.current?.openDialog()}
                  onCopyLink={handleCopyLink}
                  onFork={() => void handleFork()}
                  onHelp={() => setShowHelp(true)}
                  onDelete={handleDelete}
                />
              </div>
              <div className="flex items-center gap-2 text-sm opacity-60 mt-0 mb-2">
                <span>by {isOwner ? "You" : model.ownerName}</span>
                <span>•</span>
                <span>
                  {new Date(model._creationTime).toLocaleDateString()}
                </span>
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
            <>
              <div className="flex gap-4 items-center justify-between mb-2">
                <form
                  className="flex-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSaveModel();
                  }}
                >
                  <input
                    type="text"
                    className="input input-ghost text-2xl sm:text-4xl font-bold w-full px-0 mb-0"
                    value={modelName}
                    onChange={(e) => handleModelNameChange(e.target.value)}
                  />
                </form>
                <div className="not-prose hidden sm:flex gap-2 shrink-0 items-center">
                  {isOwner && (
                    <>
                      <button
                        type="button"
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
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => shareDialogRef.current?.openDialog()}
                        >
                          <UserPlus className="w-4 h-4" />
                          Share
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={handleCopyLink}
                  >
                    <Copy className="w-4 h-4" />
                    Copy Link
                  </button>
                  <div
                    className="tooltip"
                    data-tip={
                      !isAuthenticated
                        ? "Sign in to fork this model"
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary gap-1"
                      onClick={() => void handleFork()}
                      disabled={!isAuthenticated}
                    >
                      <GitFork className="w-4 h-4" />
                      Fork
                      {(model.uniqueForkers ?? 0) > 0 && (
                        <span className="badge badge-neutral badge-sm font-mono tabular-nums">
                          {model.uniqueForkers}
                        </span>
                      )}
                    </button>
                  </div>
                  {isOwner && (
                    <button
                      type="button"
                      className="btn btn-sm btn-error btn-outline btn-circle"
                      onClick={handleDelete}
                      aria-label="Delete model"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-circle"
                    onClick={() => setShowHelp(true)}
                    aria-label="Help"
                  >
                    <HelpCircle className="w-5 h-5" />
                  </button>
                </div>
                <MobileActionsMenu
                  isOwner={isOwner}
                  isPublic={model.isPublic}
                  uniqueForkers={model.uniqueForkers}
                  isAuthenticated={isAuthenticated}
                  onTogglePublic={() => void handleTogglePublic()}
                  onShare={() => shareDialogRef.current?.openDialog()}
                  onCopyLink={handleCopyLink}
                  onFork={() => void handleFork()}
                  onHelp={() => setShowHelp(true)}
                  onDelete={handleDelete}
                />
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveModel();
                }}
              >
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
            </>
          )}
        </div>

        <div className="not-prose flex flex-1 overflow-hidden shadow-[4px_4px_12px_rgba(0,0,0,0.15)] relative">
          {isDesktop ? (
            /* Desktop layout with resizable panels */
            <PanelGroup
              autoSaveId="model-editor-layout"
              direction="horizontal"
              className="w-full h-full"
            >
              <Panel id="graph" order={1}>
                <GraphEditor
                  modelId={modelId as Id<"models">}
                  nodes={nodes}
                  selectedNode={selectedNode}
                  onNodeSelect={handleNodeSelect}
                  isReadOnly={isReadOnly}
                  isFullScreen={isFullScreen}
                  onToggleFullScreen={() => setIsFullScreen(!isFullScreen)}
                  onInterventionNodesChange={setInterventionNodes}
                  toggleInterventionRef={toggleInterventionRef}
                  userMarks={userMarks}
                  onUserMarksChange={setUserMarks}
                />
              </Panel>

              {selectedNodeData && (
                <>
                  <PanelResizeHandle className="w-2 bg-base-300 hover:bg-accent/30 active:bg-accent/40 transition-all cursor-col-resize relative before:content-[''] before:absolute before:inset-y-0 before:left-1/2 before:-translate-x-1/2 before:w-0.5 before:my-auto before:h-8 before:bg-[repeating-linear-gradient(transparent,transparent_2px,currentColor_2px,currentColor_4px)] before:opacity-60 hover:before:opacity-90 active:before:opacity-100" />
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
                      interventionNodes={interventionNodes ?? new Set()}
                      onClose={handleCloseSidebar}
                      onUpdate={(updates) => {
                        void (async () => {
                          if (
                            !selectedNode ||
                            !nodes.some((n) => n._id === selectedNode)
                          ) {
                            return;
                          }
                          try {
                            await updateNode({ id: selectedNode, ...updates });
                            showSuccess("Node updated successfully");
                            setNewlyCreatedNodeId(null);
                          } catch (error) {
                            showError(error);
                          }
                        })();
                      }}
                      onDelete={() => {
                        void (async () => {
                          if (
                            !selectedNode ||
                            !nodes.some((n) => n._id === selectedNode)
                          ) {
                            return;
                          }
                          try {
                            await deleteNode({ id: selectedNode });
                            handleCloseSidebar();
                            showSuccess("Node deleted successfully");
                          } catch (error) {
                            showError(error);
                          }
                        })();
                      }}
                      onToggleIntervention={
                        selectedNode
                          ? () => toggleInterventionRef.current?.(selectedNode)
                          : undefined
                      }
                      isReadOnly={isReadOnly}
                      isNewlyCreated={selectedNode === newlyCreatedNodeId}
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
          ) : (
            /* Mobile layout with overlay */
            <div className="flex-1 w-full">
              <GraphEditor
                modelId={modelId as Id<"models">}
                nodes={nodes}
                selectedNode={selectedNode}
                onNodeSelect={handleNodeSelect}
                isReadOnly={isReadOnly}
                isFullScreen={isFullScreen}
                onToggleFullScreen={() => setIsFullScreen(!isFullScreen)}
                onInterventionNodesChange={setInterventionNodes}
                toggleInterventionRef={toggleInterventionRef}
                userMarks={userMarks}
                onUserMarksChange={setUserMarks}
              />
            </div>
          )}

          {!isDesktop && selectedNodeData && (
            <>
              <div
                className="fixed inset-0 bg-black bg-opacity-50 z-20"
                onClick={handleCloseSidebar}
                onTouchMove={(e) => e.preventDefault()}
              />
              <div className="fixed inset-y-0 right-0 w-[85vw] max-w-sm h-full bg-base-100 rounded-lg border border-base-300 z-30">
                <NodeInspector
                  key={selectedNode}
                  node={selectedNodeData}
                  allNodes={nodes}
                  interventionNodes={interventionNodes ?? new Set()}
                  onClose={handleCloseSidebar}
                  onUpdate={(updates) => {
                    void (async () => {
                      if (
                        !selectedNode ||
                        !nodes.some((n) => n._id === selectedNode)
                      ) {
                        return;
                      }
                      try {
                        await updateNode({ id: selectedNode, ...updates });
                        showSuccess("Node updated successfully");
                        setNewlyCreatedNodeId(null);
                      } catch (error) {
                        showError(error);
                      }
                    })();
                  }}
                  onDelete={() => {
                    void (async () => {
                      if (
                        !selectedNode ||
                        !nodes.some((n) => n._id === selectedNode)
                      ) {
                        return;
                      }
                      try {
                        await deleteNode({ id: selectedNode });
                        handleCloseSidebar();
                        showSuccess("Node deleted successfully");
                      } catch (error) {
                        showError(error);
                      }
                    })();
                  }}
                  onToggleIntervention={
                    selectedNode
                      ? () => toggleInterventionRef.current?.(selectedNode)
                      : undefined
                  }
                  isReadOnly={isReadOnly}
                  isNewlyCreated={selectedNode === newlyCreatedNodeId}
                />
              </div>
            </>
          )}
        </div>
      </div>
      {/* ShareDialog rendered at page level to avoid dropdown nesting issues */}
      {isOwner && !model.isPublic && (
        <ShareDialog
          ref={shareDialogRef}
          modelId={modelId as Id<"models">}
          showButton={false}
        />
      )}

      {/* DeleteModelDialog for owner-only model deletion */}
      {isOwner && (
        <DeleteModelDialog
          ref={deleteDialogRef}
          modelId={modelId as Id<"models">}
          modelName={model.name}
          onDeleted={handleModelDeleted}
        />
      )}

      {/* Help modal */}
      {showHelp && (
        <dialog
          open
          className="modal modal-open"
          aria-label="Keyboard shortcuts and controls help"
        >
          <div className="modal-box">
            <h3 className="font-bold text-lg mt-0">Quick Reference</h3>
            <div className="py-4 space-y-4">
              {!isReadOnly && (
                <div>
                  <h4 className="font-semibold mb-2 mt-0">
                    Graph Interactions
                  </h4>
                  <ul className="space-y-1 text-sm">
                    <li>
                      <kbd className="kbd kbd-sm">Double-click</kbd> canvas →
                      Create node
                    </li>
                    <li>
                      <kbd className="kbd kbd-sm">Drag</kbd> from node to node →
                      Create edge
                    </li>
                    <li>
                      <kbd className="kbd kbd-sm">Click</kbd> node → Select and
                      open inspector
                    </li>
                    <li>
                      <kbd className="kbd kbd-sm">Drag</kbd> node → Reposition
                    </li>
                  </ul>
                </div>
              )}
              <div>
                <h4 className="font-semibold mb-2 mt-0">Sensitivity Analysis</h4>
                <ul className="space-y-1 text-sm">
                  <li>
                    <kbd className="kbd kbd-sm">Ctrl</kbd>/
                    <kbd className="kbd kbd-sm">Cmd</kbd> +{" "}
                    <kbd className="kbd kbd-sm">Click</kbd> node → Toggle
                    intervention status
                  </li>
                  <li>
                    Intervention nodes (marked with "I" badge) are variables you
                    can control to see how they affect other nodes
                  </li>
                  <li>
                    Root nodes (nodes with no parents) are intervention nodes by
                    default
                  </li>
                  <li>
                    View sensitivity in the "Sensitivity" tab to see the impact of
                    forcing each intervention node to true vs. false
                  </li>
                </ul>
              </div>
              {!isReadOnly && (
                <div>
                  <h4 className="font-semibold mb-2 mt-0">
                    Keyboard Shortcuts
                  </h4>
                  <ul className="space-y-1 text-sm">
                    <li>
                      <kbd className="kbd kbd-sm">Delete</kbd> → Remove selected
                      node or edge
                    </li>
                    <li>
                      <kbd className="kbd kbd-sm">Esc</kbd> → Deselect
                    </li>
                  </ul>
                </div>
              )}
              <div>
                <h4 className="font-semibold mb-2 mt-0">Canvas Controls</h4>
                <ul className="space-y-1 text-sm">
                  <li>
                    <kbd className="kbd kbd-sm">Scroll</kbd> → Zoom in/out
                  </li>
                  <li>
                    <kbd className="kbd kbd-sm">Drag</kbd> canvas → Pan view
                  </li>
                  {isReadOnly && (
                    <li>
                      <kbd className="kbd kbd-sm">Click</kbd> node → View
                      details
                    </li>
                  )}
                </ul>
              </div>
              <div className="divider my-2"></div>
              <div className="text-sm opacity-70">
                <a
                  href={GITHUB_ISSUES}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link link-primary flex items-center gap-2"
                >
                  <Github className="w-4 h-4" />
                  Report an issue or request a feature
                </a>
              </div>
            </div>
            <div className="modal-action mt-4">
              <button className="btn" onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowHelp(false)} />
        </dialog>
      )}
    </>
  );
}
