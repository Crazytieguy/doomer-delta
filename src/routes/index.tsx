import { SignUpButton } from "@clerk/clerk-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Authenticated, Unauthenticated } from "convex/react";
import { Network, GitFork, Lightbulb } from "lucide-react";
import { LogoIcon } from "../components/LogoIcon";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="max-w-4xl mx-auto text-center py-12 px-4">
      <div className="not-prose flex justify-center mb-6">
        <div className="relative inline-block">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl"></div>
          <LogoIcon className="w-16 h-16 text-primary relative z-10" />
        </div>
      </div>
      <h1>Bayesian World Models</h1>
      <p className="text-xl mb-12">
        Build, visualize, and share probabilistic models for complex domains.
      </p>

      <div className="not-prose grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12 text-left">
        <div className="card card-border bg-base-200">
          <div className="card-body">
            <Network className="w-6 h-6 text-primary mb-2" />
            <h3 className="card-title text-base">Visual Modeling</h3>
            <p className="text-sm opacity-80">
              Build Bayesian networks with an interactive graph editor
            </p>
          </div>
        </div>
        <div className="card card-border bg-base-200">
          <div className="card-body">
            <GitFork className="w-6 h-6 text-primary mb-2" />
            <h3 className="card-title text-base">Fork & Iterate</h3>
            <p className="text-sm opacity-80">
              Clone and improve shared models to converge on better ontologies
            </p>
          </div>
        </div>
        <div className="card card-border bg-base-200">
          <div className="card-body">
            <Lightbulb className="w-6 h-6 text-primary mb-2" />
            <h3 className="card-title text-base">Decision Making</h3>
            <p className="text-sm opacity-80">
              Model actions and outcomes to inform better decisions
            </p>
          </div>
        </div>
      </div>

      <div className="not-prose flex flex-col sm:flex-row gap-3 justify-center">
        <Authenticated>
          <Link
            to="/models/my"
            className="btn btn-primary btn-lg shadow-lg w-full sm:w-auto"
          >
            My Models
          </Link>
          <Link
            to="/models/public"
            className="btn btn-outline btn-lg w-full sm:w-auto"
          >
            Browse Public Models
          </Link>
        </Authenticated>

        <Unauthenticated>
          <Link
            to="/models/public"
            className="btn btn-outline btn-lg w-full sm:w-auto"
          >
            Browse Public Models
          </Link>
          <SignUpButton mode="modal">
            <button className="btn btn-primary btn-lg shadow-lg w-full sm:w-auto">
              Sign Up to Create
            </button>
          </SignUpButton>
        </Unauthenticated>
      </div>
    </div>
  );
}
