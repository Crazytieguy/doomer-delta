import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { useToast } from "../components/ToastContext";

const modelsQueryOptions = convexQuery(api.models.listMyModels, {});

export const Route = createFileRoute("/models/my")({
  loader: async ({ context: { queryClient } }) => {
    if ((window as any).Clerk?.session) {
      await queryClient.ensureQueryData(modelsQueryOptions);
    }
  },
  component: MyModelsPage,
});

function MyModelsPage() {
  const { data: models } = useSuspenseQuery(modelsQueryOptions);
  const createModel = useMutation(api.models.create);
  const { showError, showSuccess } = useToast();

  const handleCreateModel = async () => {
    try {
      await createModel({ name: "New Model" });
      showSuccess("Model created successfully");
    } catch (error) {
      showError(error);
    }
  };

  return (
    <div>
      <div className="not-prose flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Your Models</h1>
        <button
          className="btn btn-primary"
          onClick={() => void handleCreateModel()}
        >
          <Plus className="w-4 h-4" />
          New Model
        </button>
      </div>

      {models.length === 0 ? (
        <div className="not-prose">
          <div className="p-8 bg-base-200 rounded-lg">
            <p className="opacity-70">
              No models yet. Create your first model!
            </p>
          </div>
        </div>
      ) : (
        <div className="not-prose grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {models.map((model) => (
            <Link
              key={model._id}
              to="/models/$modelId"
              params={{ modelId: model._id }}
              className="card card-border bg-gradient-to-br from-base-200 via-base-200 to-base-300/30 hover:shadow-lg transition-shadow duration-300"
            >
              <div className="card-body">
                <div className="flex justify-between items-start gap-2">
                  <h3 className="card-title flex-1">{model.name}</h3>
                  {model.isPublic && (
                    <span className="badge badge-success gap-1 whitespace-nowrap">
                      <span>●</span> Public
                    </span>
                  )}
                </div>
                {model.description && (
                  <p className="text-sm opacity-70">{model.description}</p>
                )}
                <div className="text-xs opacity-50 mt-2">
                  {new Date(model._creationTime).toLocaleDateString()}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
