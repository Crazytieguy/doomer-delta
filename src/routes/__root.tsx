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
import { Menu } from "lucide-react";
import { useState, useEffect } from "react";
import { api } from "../../convex/_generated/api";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ToastProvider } from "../components/ToastContext";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexClient: ConvexReactClient;
}>()({
  component: RootComponent,
});

function RootComponent() {
  const { queryClient, convexClient: convex } = Route.useRouteContext();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
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
                    checked={isSidebarOpen}
                    onChange={toggleSidebar}
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
                          className="btn btn-ghost normal-case text-xl font-semibold"
                        >
                          Doomer Delta
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
                      <div className="navbar-end">
                        <UserButton />
                      </div>
                    </header>
                    {/* Main content */}
                    <main className="flex-1 p-4 prose prose-invert max-w-none">
                      <ErrorBoundary>
                        <Outlet />
                      </ErrorBoundary>
                    </main>
                    <footer className="footer footer-center p-4 text-base-content">
                      <p>© {new Date().getFullYear()} Doomer Delta</p>
                    </footer>
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
                        <ul className="space-y-1">
                          <li>
                            <Link
                              to="/models/my"
                              onClick={() => setIsSidebarOpen(false)}
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
                              onClick={() => setIsSidebarOpen(false)}
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
                      </div>
                      <div className="mt-auto py-4 border-t border-base-300/50 flex justify-center items-center">
                        <UserButton />
                      </div>
                    </div>
                  </div>
                </div>
              </Authenticated>
              <Unauthenticated>
                <header className="navbar bg-gradient-to-r from-base-100 via-base-100 to-base-100/95 shadow-md border-b border-base-300/50">
                  <div className="container mx-auto flex justify-between w-full">
                    <div className="navbar-start">
                      <h1 className="font-semibold text-lg">Doomer Delta</h1>
                    </div>
                    <div className="navbar-end">
                      <SignInButton mode="modal">
                        <button className="btn btn-primary btn-sm">
                          Sign in
                        </button>
                      </SignInButton>
                      <SignUpButton mode="modal">
                        <button className="btn btn-outline btn-sm ml-2">
                          Sign up
                        </button>
                      </SignUpButton>
                    </div>
                  </div>
                </header>
                <main className="flex-1 container mx-auto p-4 prose prose-invert max-w-none">
                  <ErrorBoundary>
                    <Outlet />
                  </ErrorBoundary>
                </main>
                <footer className="footer footer-center p-4 text-base-content">
                  <p>© {new Date().getFullYear()} Doomer Delta</p>
                </footer>
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
