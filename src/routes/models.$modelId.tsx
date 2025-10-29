import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GraphEditor } from "../components/GraphEditor";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const modelQueryOptions = (modelId: Id<"models">) =>
  convexQuery(api.models.get, { id: modelId });

const nodesQueryOptions = (modelId: Id<"models">) =>
  convexQuery(api.nodes.listByModel, { modelId });

const edgesQueryOptions = (modelId: Id<"models">) =>
  convexQuery(api.edges.listByModel, { modelId });

export const Route = createFileRoute("/models/$modelId")({
  loader: async ({ context: { queryClient }, params }) => {
    if ((window as any).Clerk?.session) {
      const modelId = params.modelId as Id<"models">;
      await Promise.all([
        queryClient.ensureQueryData(modelQueryOptions(modelId)),
        queryClient.ensureQueryData(nodesQueryOptions(modelId)),
        queryClient.ensureQueryData(edgesQueryOptions(modelId)),
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
  const { data: edges } = useSuspenseQuery(
    edgesQueryOptions(modelId as Id<"models">),
  );

  if (!model) {
    return <div>Model not found</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1>{model.name}</h1>
        {model.description && <p className="opacity-70">{model.description}</p>}
      </div>

      <div className="not-prose mb-6">
        <div className="stats stats-vertical lg:stats-horizontal shadow">
          <div className="stat">
            <div className="stat-title">Nodes</div>
            <div className="stat-value">{nodes.length}</div>
          </div>
          <div className="stat">
            <div className="stat-title">Edges</div>
            <div className="stat-value">{edges.length}</div>
          </div>
        </div>
      </div>

      <div className="not-prose">
        <GraphEditor
          modelId={modelId as Id<"models">}
          nodes={nodes}
          edges={edges}
        />
      </div>
    </div>
  );
}
