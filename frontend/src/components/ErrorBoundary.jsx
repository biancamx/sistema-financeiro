import { Component } from 'react';
import { systemApi } from '../services/api.js';

// Camada "Error Tracking": erros de renderização viram log no servidor (POST /api/client-errors).
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    systemApi.clientError({
      message: String(error?.message || error).slice(0, 500),
      stack: String(error?.stack || '').slice(0, 4000),
      componentStack: String(info?.componentStack || '').slice(0, 4000),
      url: window.location.href.slice(0, 300),
    });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state state-error" style={{ margin: '4rem auto', maxWidth: 480 }}>
        <strong>Algo deu errado nesta tela</strong>
        <p>O erro foi registrado. Você pode recarregar a página para continuar.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Recarregar</button>
      </div>
    );
  }
}
