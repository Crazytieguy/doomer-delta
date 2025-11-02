import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery } from "convex/react";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { api } from "../../convex/_generated/api";

const publicModelsQueryOptions = convexQuery(api.models.listPublicInitial, {});

export const Route = createFileRoute("/models/public")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(publicModelsQueryOptions);
  },
  component: PublicModelsPage,
});

function PublicModelsPage() {
  const { data: initialModels } = useSuspenseQuery(publicModelsQueryOptions);

  const { results: paginatedResults, status, loadMore } = usePaginatedQuery(
    api.models.listPublic,
    {},
    { initialNumItems: 12 },
  );

  const displayModels = status !== "LoadingFirstPage" ? paginatedResults : initialModels;

  return (
    <div>
      <div className="not-prose flex items-center gap-2 mb-4">
        <Globe className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Public Models</h1>
      </div>

      {displayModels.length === 0 ? (
        <div className="not-prose">
          <div className="p-8 bg-base-200 rounded-lg">
            <p className="opacity-70">No public models yet.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="not-prose grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayModels.map((model) => (
              <Link
                key={model._id}
                to="/models/$modelId"
                params={{ modelId: model._id }}
                className="card card-border bg-gradient-to-br from-base-200 via-base-200 to-base-300/30 hover:shadow-lg transition-shadow duration-300"
              >
                <div className="card-body">
                  <h3 className="card-title">{model.name}</h3>
                  {model.description && (
                    <p className="text-sm opacity-70">{model.description}</p>
                  )}
                  <div className="flex justify-between items-center text-xs opacity-50 mt-2">
                    <span>by {model.ownerName}</span>
                    <span>
                      {new Date(model._creationTime).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {status === "CanLoadMore" && (
            <div className="not-prose flex justify-center mt-8">
              <button onClick={() => loadMore(12)} className="btn btn-primary">
                Load More
              </button>
            </div>
          )}

          {status === "LoadingMore" && (
            <div className="not-prose flex justify-center mt-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
