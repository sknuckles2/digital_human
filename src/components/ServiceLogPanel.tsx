/**
 * 服务状态日志面板
 * 在非桌面模式下显示服务运行状态和实时日志
 */
import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';

interface LogEntry {
  ts: string;
  level: string;
  source: string;
  message: string;
}

type ServiceStatus = 'starting' | 'running' | 'stopped' | 'error';

interface ServiceInfo {
  name: string;
  key: string;
  status: ServiceStatus;
}

export default function ServiceLogPanel() {
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([
    { name: '编排服务', key: 'ORCH', status: 'starting' },
    { name: 'ASR 服务', key: 'ASR', status: 'starting' },
    { name: 'TTS 引擎', key: 'TTS', status: 'starting' },
  ]);
  const [filter, setFilter] = useState<string>('all');
  const logEndRef = useRef<HTMLDivElement>(null);
  const isElectron = !!(window as any).electronAPI?.isElectron;

  // 从 Electron 主进程接收日志
  useEffect(() => {
    if (!isElectron) return;

    const api = (window as any).electronAPI;

    // 获取历史日志
    api.getLogs().then((history: LogEntry[]) => {
      if (history) setLogs(history.slice(-200));
    });

    // 通过 SSE 实时日志流接收服务状态（无需额外 HTTP 轮询）
    api.onServiceLog((entry: LogEntry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });

      // 更新服务状态
      setServices((prev) =>
        prev.map((s) => {
          if (s.key === entry.source) {
            if (entry.message.includes('就绪') || entry.message.includes('running')) {
              return { ...s, status: 'running' as ServiceStatus };
            }
            if (entry.level === 'error') {
              return { ...s, status: 'error' as ServiceStatus };
            }
          }
          return s;
        })
      );
    });
  }, [isElectron]);

  // 自动滚动到底部
  useEffect(() => {
    if (expanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, expanded]);

  // 从 HTTP 日志流接收（非 Electron 模式）
  useEffect(() => {
    if (isElectron) return; // Electron 使用 IPC

    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const url = isDev ? '/api/voice/logs' : 'http://localhost:6080/logs';

    let eventSource: EventSource | null = null;
    try {
      // 使用 fetch SSE（EventSource 不支持自定义 headers）
      const connect = async () => {
        try {
          const resp = await fetch(url, {
            headers: isDev ? { 'X-API-Target': 'http://localhost:6080' } : {},
          });
          const reader = resp.body?.getReader();
          if (!reader) return;

          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const entry = JSON.parse(line.slice(6));
                  setLogs((prev) => [...prev.slice(-499), entry]);
                } catch {}
              }
            }
          }
        } catch {}
      };
      connect();
    } catch {}

    return () => {};
  }, [isElectron]);

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter((l) => l.source === filter);

  const statusIcon = (status: ServiceStatus) => {
    switch (status) {
      case 'running': return <span style={{ color: '#22c55e' }}>●</span>;
      case 'starting': return <span style={{ color: '#eab308' }}>◐</span>;
      case 'error': return <span style={{ color: '#ef4444' }}>●</span>;
      case 'stopped': return <span style={{ color: '#6b7280' }}>○</span>;
    }
  };

  const levelClass = (level: string) => {
    switch (level) {
      case 'error': return 'log-error';
      case 'warn': return 'log-warn';
      default: return 'log-info';
    }
  };

  return (
    <div className={`service-log-panel ${expanded ? 'expanded' : ''}`}>
      {/* 折叠按钮 + 状态指示 */}
      <div className="slp-header" onClick={() => setExpanded(!expanded)}>
        <div className="slp-title">
          <Icon name="settings" />
          <span>服务状态</span>
        </div>
        <div className="slp-services-mini">
          {services.map((s) => (
            <span key={s.key} className="slp-mini-status" title={`${s.name}: ${s.status}`}>
              {statusIcon(s.status)}
            </span>
          ))}
        </div>
        <span className="slp-toggle">{expanded ? '▼' : '▲'}</span>
      </div>

      {/* 展开后的面板 */}
      {expanded && (
        <div className="slp-body">
          <div className="slp-services-bar">
            {services.map((s) => (
              <div key={s.key} className={`slp-service-item slp-${s.status}`}>
                {statusIcon(s.status)}
                <span className="slp-service-name">{s.name}</span>
                <span className="slp-service-status">{s.status}</span>
              </div>
            ))}
          </div>

          <div className="slp-filter-bar">
            <button className={`slp-filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>全部</button>
            <button className={`slp-filter-btn ${filter === 'ORCH' ? 'active' : ''}`} onClick={() => setFilter('ORCH')}>编排</button>
            <button className={`slp-filter-btn ${filter === 'ASR' ? 'active' : ''}`} onClick={() => setFilter('ASR')}>ASR</button>
            <button className={`slp-filter-btn ${filter === 'TTS' ? 'active' : ''}`} onClick={() => setFilter('TTS')}>TTS</button>
            <button className={`slp-filter-btn ${filter === 'MAIN' ? 'active' : ''}`} onClick={() => setFilter('MAIN')}>主进程</button>
            <button className="slp-clear-btn" onClick={() => setLogs([])}>清空</button>
          </div>

          <div className="slp-logs">
            {filteredLogs.length === 0 ? (
              <div className="slp-empty">暂无日志</div>
            ) : (
              filteredLogs.map((log, i) => (
                <div key={i} className={`slp-log-line ${levelClass(log.level)}`}>
                  <span className="slp-log-ts">{log.ts || log.ts.slice(11, 19)}</span>
                  <span className={`slp-log-level log-${log.level}`}>[{log.level.toUpperCase()}]</span>
                  <span className="slp-log-source">[{log.source}]</span>
                  <span className="slp-log-msg">{log.message}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
