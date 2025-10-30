import { SignInButton } from "@clerk/clerk-react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Authenticated, Unauthenticated } from "convex/react";
import { Network } from "lucide-react";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <Authenticated>
        <Navigate to="/models/my" />
      </Authenticated>

      <Unauthenticated>
        <div className="text-center">
          <div className="not-prose flex justify-center mb-4">
            <Network className="w-16 h-16 text-primary" />
          </div>
          <h1>Bayesian World Models</h1>
          <p>Build, visualize, and share Bayesian network world-models.</p>
          <div className="not-prose mt-4">
            <SignInButton mode="modal">
              <button className="btn btn-primary btn-lg">Get Started</button>
            </SignInButton>
          </div>
        </div>
      </Unauthenticated>
    </>
  );
}
