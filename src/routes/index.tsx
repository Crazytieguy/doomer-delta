import { SignInButton } from "@clerk/clerk-react";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Authenticated, Unauthenticated, useMutation } from "convex/react";
import { Network, Plus } from "lucide-react";
import { api } from "../../convex/_generated/api";

const modelsQueryOptions = convexQuery(api.models.list, {});

export const Route = createFileRoute("/")({
  loader: async ({ context: { queryClient } }) => {
    if ((window as any).Clerk?.session) {
      await queryClient.ensureQueryData(modelsQueryOptions);
    }
  },
  component: HomePage,
});

function HomePage() {
  return (
    <div className="text-center">
      <div className="not-prose flex justify-center mb-4">
        <Network className="w-16 h-16 text-primary" />
      </div>
      <h1>Bayesian World Models</h1>

      <Unauthenticated>
        <p>Build, visualize, and share Bayesian network world-models.</p>
        <div className="not-prose mt-4">
          <SignInButton mode="modal">
            <button className="btn btn-primary btn-lg">Get Started</button>
          </SignInButton>
        </div>
      </Unauthenticated>

      <Authenticated>
        <ModelsList />
      </Authenticated>
    </div>
  );
}

function ModelsList() {
  const { data: models } = useSuspenseQuery(modelsQueryOptions);
  const createModel = useMutation(api.models.create);

  return (
    <>
      <div className="not-prose flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Your Models</h2>
        <button
          className="btn btn-primary"
          onClick={() => void createModel({ name: "New Model" })}
        >
          <Plus className="w-4 h-4" />
          New Model
        </button>
      </div>

      {models.length === 0 ? (
        <div className="not-prose">
          <div className="p-8 bg-base-200 rounded-lg">
            <p className="opacity-70">No models yet. Create your first model!</p>
          </div>
        </div>
      ) : (
        <div className="not-prose grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {models.map((model) => (
            <Link
              key={model._id}
              to="/models/$modelId"
              params={{ modelId: model._id }}
              className="card card-border bg-base-200 hover:bg-base-300 transition-colors"
            >
              <div className="card-body">
                <h3 className="card-title">{model.name}</h3>
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
    </>
  );
}
