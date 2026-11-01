import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, a render-time exception in any single page (a type mismatch with the API, a bad
 * prop) unmounts the whole React tree — sidebar, header and all — leaving a blank screen instead
 * of just that page failing. Resets automatically if the user navigates (location change remounts
 * via the key passed from App.tsx).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
          <h2 style={{ color: 'var(--danger, #c23434)' }}>Algo deu errado nesta tela</h2>
          <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: 13 }}>{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 12, padding: '8px 16px', borderRadius: 6, border: '1px solid #ccc' }}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
