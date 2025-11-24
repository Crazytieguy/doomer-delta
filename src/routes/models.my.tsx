import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { useToast } from "../components/ToastContext";
import { ModelCard } from "../components/ModelCard";

const modelsQueryOptions = convexQuery(api.models.listMyModels, {});
const sharedModelsQueryOptions = convexQuery(api.models.listSharedWithMe, {});

export const Route = createFileRoute("/models/my")({
  loader: async ({ context: { queryClient } }) => {
    if ((window as any).Clerk?.session) {
      await Promise.all([
        queryClient.ensureQueryData(modelsQueryOptions),
        queryClient.ensureQueryData(sharedModelsQueryOptions),
      ]);
    }
  },
  component: MyModelsPage,
});

function MyModelsPage() {
  const navigate = useNavigate();
  const { data: models } = useSuspenseQuery(modelsQueryOptions);
  const { data: sharedModels } = useSuspenseQuery(sharedModelsQueryOptions);
  const createModel = useMutation(api.models.create);
  const { showError, showSuccess } = useToast();

  const handleCreateModel = async () => {
    try {
      const modelId = await createModel({ name: "New Model" });
      showSuccess("Model created successfully");
      void navigate({ to: "/models/$modelId", params: { modelId } });
    } catch (error) {
      showError(error);
    }
  };

  return (
    <div>
      <div className="not-prose flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
        <h1 className="text-2xl font-bold">Your Models</h1>
        <button
          className="btn btn-primary w-full sm:w-auto"
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
            <ModelCard
              key={model._id}
              modelId={model._id}
              name={model.name}
              description={model.description}
              ownerName="You"
              creationTime={model._creationTime}
              uniqueForkers={model.uniqueForkers}
              badge={
                model.isPublic
                  ? { text: "Public", variant: "primary" }
                  : undefined
              }
              isOwner={true}
            />
          ))}
        </div>
      )}

      {sharedModels.length > 0 && (
        <div className="mt-12">
          <h2 className="text-2xl font-bold mb-4">Shared with You</h2>
          <div className="not-prose grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sharedModels.map((model) => (
              <ModelCard
                key={model._id}
                modelId={model._id}
                name={model.name}
                description={model.description}
                ownerName={model.ownerName}
                creationTime={model._creationTime}
                uniqueForkers={model.uniqueForkers}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
