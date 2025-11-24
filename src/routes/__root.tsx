import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth as useClerkAuth,
  useUser,
} from "@clerk/clerk-react";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import {
  Authenticated,
  ConvexReactClient,
  Unauthenticated,
  useMutation,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { Menu, CircleHelp, Bug, Github } from "lucide-react";
import { useState, useEffect } from "react";
import { api } from "../../convex/_generated/api";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LogoIcon } from "../components/LogoIcon";
import { ToastProvider } from "../components/ToastContext";

const GITHUB_REPO = "https://github.com/Crazytieguy/delta";
const GITHUB_ISSUES = `${GITHUB_REPO}/issues`;

function HelpLinks({ onLinkClick }: { onLinkClick?: () => void }) {
  return (
    <>
      <li>
        <a
          href={GITHUB_ISSUES}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2"
          onClick={onLinkClick}
        >
          <Bug className="w-4 h-4" />
          Report an Issue
        </a>
      </li>
      <li>
        <a
          href={GITHUB_REPO}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2"
          onClick={onLinkClick}
        >
          <Github className="w-4 h-4" />
          View on GitHub
        </a>
      </li>
    </>
  );
}

function HelpDropdown() {
  return (
    <div className="dropdown dropdown-end">
      <button
        type="button"
        className="btn btn-ghost btn-circle"
        aria-label="Help and feedback"
        aria-haspopup="menu"
      >
        <CircleHelp className="w-5 h-5" />
      </button>
      <ul
        role="menu"
        className="dropdown-content menu p-2 shadow-lg bg-base-200 rounded-box w-56 mt-3 gap-1"
      >
        <HelpLinks />
      </ul>
    </div>
  );
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexClient: ConvexReactClient;
}>()({
  component: RootComponent,
});

function RootComponent() {
  const { queryClient, convexClient: convex } = Route.useRouteContext();
  const [isAuthSidebarOpen, setIsAuthSidebarOpen] = useState(false);
  const [isUnauthSidebarOpen, setIsUnauthSidebarOpen] = useState(false);

  const toggleAuthSidebar = () => {
    setIsAuthSidebarOpen((prev) => !prev);
  };

  const toggleUnauthSidebar = () => {
    setIsUnauthSidebarOpen((prev) => !prev);
  };

  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      signUpFallbackRedirectUrl="/"
      signInFallbackRedirectUrl="/"
      afterSignOutUrl="/"
    >
      <ConvexProviderWithClerk client={convex} useAuth={useClerkAuth}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <div className="min-h-screen flex flex-col">
              <Authenticated>
                <EnsureUser />
                {/* Mobile sidebar drawer */}
                <div className="drawer min-h-screen">
                  <input
                    id="drawer-toggle"
                    type="checkbox"
                    className="drawer-toggle"
                    checked={isAuthSidebarOpen}
                    onChange={toggleAuthSidebar}
                  />
                  <div className="drawer-content container mx-auto flex flex-col h-full">
                    {/* Navbar */}
                    <header className="navbar bg-gradient-to-r from-base-100 via-base-100 to-base-100/95 shadow-md border-b border-base-300/50">
                      <div className="navbar-start">
                        <label
                          htmlFor="drawer-toggle"
                          className="btn btn-square btn-ghost drawer-button lg:hidden mr-2"
                        >
                          <Menu className="w-5 h-5" />
                        </label>
                        <Link
                          to="/"
                          className="btn btn-ghost normal-case text-xl font-semibold flex items-center gap-2"
                        >
                          <LogoIcon className="w-6 h-6" />
                          <span className="hidden lg:inline">Delta</span>
                        </Link>
                      </div>
                      <div className="navbar-center hidden lg:flex">
                        <nav className="flex gap-2">
                          <Link
                            to="/models/my"
                            className="btn btn-ghost"
                            activeProps={{
                              className:
                                "btn btn-ghost btn-active border-b-2 border-primary",
                            }}
                          >
                            My Models
                          </Link>
                          <Link
                            to="/models/public"
                            className="btn btn-ghost"
                            activeProps={{
                              className:
                                "btn btn-ghost btn-active border-b-2 border-primary",
                            }}
                          >
                            Public Models
                          </Link>
                        </nav>
                      </div>
                      <div className="navbar-end gap-2">
                        <HelpDropdown />
                        <UserButton />
                      </div>
                    </header>
                    {/* Main content */}
                    <main className="flex-1 p-4 prose prose-invert max-w-none">
                      <ErrorBoundary>
                        <Outlet />
                      </ErrorBoundary>
                    </main>
                  </div>
                  {/* Sidebar content for mobile */}
                  <div className="drawer-side z-10">
                    <label
                      htmlFor="drawer-toggle"
                      aria-label="close sidebar"
                      className="drawer-overlay"
                    ></label>
                    <div className="menu p-4 w-64 min-h-full bg-base-200 text-base-content flex flex-col">
                      <div className="flex-1">
                        <div className="menu-title mb-4 opacity-75">Menu</div>
                        <ul role="menu" className="space-y-1">
                          <li>
                            <Link
                              to="/models/my"
                              onClick={() => setIsAuthSidebarOpen(false)}
                              activeProps={{
                                className:
                                  "menu-active border-l-4 border-primary",
                              }}
                              className="flex items-center p-2"
                            >
                              My Models
                            </Link>
                          </li>
                          <li>
                            <Link
                              to="/models/public"
                              onClick={() => setIsAuthSidebarOpen(false)}
                              activeProps={{
                                className:
                                  "menu-active border-l-4 border-primary",
                              }}
                              className="flex items-center p-2"
                            >
                              Public Models
                            </Link>
                          </li>
                        </ul>
                        <div className="divider my-2"></div>
                        <div className="menu-title mb-2 opacity-75">Help</div>
                        <ul role="menu" className="space-y-1">
                          <HelpLinks
                            onLinkClick={() => setIsAuthSidebarOpen(false)}
                          />
                        </ul>
                      </div>
                      <div className="mt-auto py-4 border-t border-base-300/50 flex justify-center items-center">
                        <UserButton />
                      </div>
                    </div>
                  </div>
                </div>
              </Authenticated>
              <Unauthenticated>
                <div className="drawer min-h-screen">
                  <input
                    id="drawer-toggle-unauthenticated"
                    type="checkbox"
                    className="drawer-toggle"
                    checked={isUnauthSidebarOpen}
                    onChange={toggleUnauthSidebar}
                  />
                  <div className="drawer-content container mx-auto flex flex-col h-full">
                    <header className="navbar bg-gradient-to-r from-base-100 via-base-100 to-base-100/95 shadow-md border-b border-base-300/50">
                      <div className="navbar-start">
                        <label
                          htmlFor="drawer-toggle-unauthenticated"
                          className="btn btn-square btn-ghost drawer-button lg:hidden mr-2"
                        >
                          <Menu className="w-5 h-5" />
                        </label>
                        <Link
                          to="/"
                          className="font-semibold text-lg hover:text-primary transition-colors flex items-center gap-2"
                        >
                          <LogoIcon className="w-6 h-6" />
                          <span className="hidden lg:inline">Delta</span>
                        </Link>
                      </div>
                      <div className="navbar-center hidden lg:flex">
                        <Link
                          to="/models/public"
                          className="btn btn-ghost btn-sm"
                          activeProps={{
                            className:
                              "btn btn-ghost btn-sm btn-active border-b-2 border-primary",
                          }}
                        >
                          Public Models
                        </Link>
                      </div>
                      <div className="navbar-end gap-1">
                        <HelpDropdown />
                        <SignInButton mode="modal">
                          <button className="btn btn-primary btn-sm">
                            Sign in
                          </button>
                        </SignInButton>
                        <SignUpButton mode="modal">
                          <button className="btn btn-outline btn-sm hidden lg:inline-flex">
                            Sign up
                          </button>
                        </SignUpButton>
                      </div>
                    </header>
                    <main className="flex-1 p-4 prose prose-invert max-w-none">
                      <ErrorBoundary>
                        <Outlet />
                      </ErrorBoundary>
                    </main>
                  </div>
                  {/* Sidebar content for mobile */}
                  <div className="drawer-side z-10">
                    <label
                      htmlFor="drawer-toggle-unauthenticated"
                      aria-label="close sidebar"
                      className="drawer-overlay"
                    ></label>
                    <div className="menu p-4 w-64 min-h-full bg-base-200 text-base-content flex flex-col">
                      <div className="flex-1">
                        <div className="menu-title mb-4 opacity-75">Menu</div>
                        <ul role="menu" className="space-y-1">
                          <li>
                            <Link
                              to="/models/public"
                              onClick={() => setIsUnauthSidebarOpen(false)}
                              activeProps={{
                                className:
                                  "menu-active border-l-4 border-primary",
                              }}
                              className="flex items-center p-2"
                            >
                              Public Models
                            </Link>
                          </li>
                        </ul>
                        <div className="divider my-2"></div>
                        <div className="menu-title mb-2 opacity-75">Help</div>
                        <ul role="menu" className="space-y-1">
                          <HelpLinks
                            onLinkClick={() => setIsUnauthSidebarOpen(false)}
                          />
                        </ul>
                      </div>
                      <div className="mt-auto py-4 border-t border-base-300/50 flex flex-col gap-2">
                        <SignInButton mode="modal">
                          <button
                            className="btn btn-primary btn-sm w-full"
                            onClick={() => setIsUnauthSidebarOpen(false)}
                          >
                            Sign in
                          </button>
                        </SignInButton>
                        <SignUpButton mode="modal">
                          <button
                            className="btn btn-outline btn-sm w-full"
                            onClick={() => setIsUnauthSidebarOpen(false)}
                          >
                            Sign up
                          </button>
                        </SignUpButton>
                      </div>
                    </div>
                  </div>
                </div>
              </Unauthenticated>
            </div>
            {import.meta.env.DEV && <TanStackRouterDevtools />}
          </ToastProvider>
        </QueryClientProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

function EnsureUser() {
  const { isLoaded, isSignedIn, user } = useUser();
  const ensureUser = useMutation(api.users.ensureUser);

  useEffect(() => {
    if (isLoaded && isSignedIn && user) {
      void ensureUser();
    }
  }, [isLoaded, isSignedIn, user, ensureUser]);

  return null;
}
