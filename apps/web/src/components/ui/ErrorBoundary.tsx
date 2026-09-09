import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[aichat] render error', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="m-6 rounded-lg border border-red-300 bg-red-50 p-4 font-mono text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
          <div className="mb-2 font-semibold">The UI crashed</div>
          <pre className="whitespace-pre-wrap">{this.state.error.message}\n{this.state.error.stack}</pre>
          <button className="mt-3 rounded bg-red-600 px-3 py-1 text-white" onClick={() => location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
