import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Evita a página em branco quando uma tela quebra: mostra o erro e deixa trocar de tela ou recarregar. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Falha na tela', error, info.componentStack); }
  componentDidUpdate(prev: { resetKey?: string }) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="axis-alert axis-alert--danger" role="alert">
        <strong>Não foi possível exibir esta tela.</strong>
        <p className="hint">{this.state.error.message}</p>
        <button className="btn" onClick={() => location.reload()}>Recarregar</button>
      </div>
    );
  }
}
