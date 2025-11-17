import { SignUpButton } from "@clerk/clerk-react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
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
        <div className="text-center py-12">
          <div className="not-prose flex justify-center mb-6">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl"></div>
              <Network className="w-16 h-16 text-primary relative z-10" />
            </div>
          </div>
          <h1>Bayesian World Models</h1>
          <p>Build, visualize, and share Bayesian network world-models.</p>
          <div className="not-prose mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/models/public" className="w-full sm:w-auto">
              <button className="btn btn-outline btn-lg w-full">
                Browse Public Models
              </button>
            </Link>
            <SignUpButton mode="modal">
              <button className="btn btn-primary btn-lg shadow-lg w-full sm:w-auto">
                Sign Up to Create
              </button>
            </SignUpButton>
          </div>
        </div>
      </Unauthenticated>
    </>
  );
}
