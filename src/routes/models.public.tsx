import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery } from "convex/react";
import { Globe } from "lucide-react";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/models/public")({
  component: PublicModelsPage,
});

function PublicModelsPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.models.listPublic,
    {},
    { initialNumItems: 12 }
  );

  return (
    <div>
      <div className="not-prose flex items-center gap-2 mb-4">
        <Globe className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Public Models</h1>
      </div>

      {results && results.length === 0 ? (
        <div className="not-prose">
          <div className="p-8 bg-base-200 rounded-lg">
            <p className="opacity-70">No public models yet.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="not-prose grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {results?.map((model) => (
              <Link
                key={model._id}
                to="/models/$modelId"
                params={{ modelId: model._id }}
                className="card card-border bg-base-200 hover:bg-base-300 transition-colors"
              >
                <div className="card-body">
                  <div className="flex justify-between items-start">
                    <h3 className="card-title">{model.name}</h3>
                    <div className="status status-success"></div>
                  </div>
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
              <button
                onClick={() => loadMore(12)}
                className="btn btn-primary"
              >
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
