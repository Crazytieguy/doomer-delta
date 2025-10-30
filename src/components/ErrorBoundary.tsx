import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="card bg-base-200 shadow-xl max-w-md">
            <div className="card-body">
              <h2 className="card-title text-error">Something went wrong</h2>
              <p className="opacity-70">
                An unexpected error occurred. Please refresh the page to continue.
              </p>
              {this.state.error && (
                <div className="mt-4">
                  <details className="collapse collapse-arrow bg-base-300">
                    <summary className="collapse-title text-sm font-medium">
                      Error details
                    </summary>
                    <div className="collapse-content">
                      <pre className="text-xs overflow-auto">
                        {this.state.error.message}
                      </pre>
                    </div>
                  </details>
                </div>
              )}
              <div className="card-actions justify-end mt-4">
                <button
                  className="btn btn-primary"
                  onClick={() => window.location.reload()}
                >
                  Refresh page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
