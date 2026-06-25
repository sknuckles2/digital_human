/**
 * React Error Boundary — 捕获渲染错误并显示友好提示
 */
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: 40,
            color: '#e0e0f0',
            background: '#0a0a0f',
            fontFamily: 'sans-serif',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ margin: '0 0 8px', fontWeight: 500 }}>组件渲染异常</h2>
            <p style={{ color: '#8888aa', margin: '0 0 16px', fontSize: 14 }}>
              {this.state.error?.message || '未知错误'}
            </p>
            <pre style={{
              fontSize: 12,
              color: '#666',
              maxWidth: '100%',
              overflow: 'auto',
              padding: 12,
              background: '#12121a',
              borderRadius: 8,
              border: '1px solid #2a2a3a',
            }}>
              {this.state.error?.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                padding: '8px 24px',
                background: '#6c8cff',
                border: 'none',
                borderRadius: 8,
                color: 'white',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              重新加载
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
