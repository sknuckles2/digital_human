import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * 创建 API 代理中间件
 * 前端发请求到 `/api/llm/*`，实际转发到用户配置的 API 地址
 * 从而避免 CORS 跨域问题
 *
 * 注意：使用 Node.js fetch() 而非 http.request()，因为：
 * - Node.js v22+ 的 http.request() 在解析 LLM SSE 响应时，
 *   遇到 Transfer-Encoding: chunked 等连接头会同步 throw
 *   ERR_HTTP2_INVALID_CONNECTION_HEADERS 导致进程崩溃
 * - fetch() 的 header 校验更稳健，不会崩溃
 */
function apiProxyPlugin() {
  return {
    name: 'api-proxy',
    configureServer(server: any) {
      /**
       * 代理中间件 — 处理所有 /api/voice/* 请求
       * 转发到语音编排服务（Orchestrator）
       */
      server.middlewares.use('/api/voice', async (req: any, res: any, next: any) => {
        try {
          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Target',
              'Access-Control-Max-Age': '86400',
            });
            res.end();
            return;
          }

          const targetBase = req.headers['x-api-target'] as string;
          if (!targetBase) {
            res.writeHead(400, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify({ error: 'Missing X-API-Target header' }));
            return;
          }

          const apiPath = req.url?.replace(/^\/api\/voice/, '') || '/';
          const targetUrl = `${targetBase.replace(/\/$/, '')}${apiPath}`;

          console.log(`[Voice Proxy] ${req.method} ${req.url} → ${targetUrl}`);

          // 收集请求体
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve) => {
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', resolve);
          });
          const body = Buffer.concat(chunks);

          const fetchHeaders: Record<string, string> = {
            'Content-Type': req.headers['content-type'] || 'application/json',
          };
          if (body.length > 0) {
            fetchHeaders['Content-Length'] = body.length.toString();
          }

          const proxyRes = await fetch(targetUrl, {
            method: req.method,
            headers: fetchHeaders,
            body: body.length > 0 ? body : undefined,
            signal: AbortSignal.timeout(60000),
          });

          const responseHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': '*',
          };
          const safeHeaders = ['content-type', 'content-length', 'cache-control', 'x-tts-duration', 'x-tts-time'];
          for (const name of safeHeaders) {
            const value = proxyRes.headers.get(name);
            if (value) responseHeaders[name] = value;
          }

          res.writeHead(proxyRes.status, responseHeaders);

          // 流式转发
          if (proxyRes.body) {
            const reader = proxyRes.body.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
              }
            } finally {
              reader.releaseLock();
            }
          }
          res.end();
        } catch (err: any) {
          console.error('[Voice Proxy] Failed:', err.message || err);
          if (!res.headersSent) {
            res.writeHead(502, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify({ error: `Voice proxy error: ${err.message || '未知'}` }));
          } else {
            res.end();
          }
        }
      });

      /**
       * 代理中间件 — 处理所有 /api/llm/* 请求
       * 将 /api/llm/xxx → 转发到用户配置的 API 地址/xxx
       * 例如：
       *   /api/llm/chat/completions  + targetBase=http://192.168.31.132:8642/v1
       *   → http://192.168.31.132:8642/v1/chat/completions
       */
      server.middlewares.use('/api/llm', async (req: any, res: any, next: any) => {
        try {
          // 处理 CORS 预检请求（OPTIONS）
          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Target',
              'Access-Control-Max-Age': '86400',
            });
            res.end();
            return;
          }

          // 从请求头获取目标 API 地址（由前端设置）
          const targetBase = req.headers['x-api-target'] as string;
          if (!targetBase) {
            res.writeHead(400, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify({ error: 'Missing X-API-Target header' }));
            return;
          }

          // 构造完整目标 URL：/api/llm/chat/completions → http://target/v1/chat/completions
          const apiPath = req.url?.replace(/^\/api\/llm/, '') || '/';
          const targetUrl = `${targetBase.replace(/\/$/, '')}${apiPath}`;

          console.log(`[API Proxy] ${req.method} ${req.url} → ${targetUrl}`);

          // 收集请求体
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve) => {
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', resolve);
          });
          const body = Buffer.concat(chunks);

          // 构造 fetch 请求头 — 只转发应用层头，不转发连接头
          const fetchHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          // 对于有体的请求才设置 Content-Length
          if (body.length > 0) {
            fetchHeaders['Content-Length'] = body.length.toString();
          }
          // 转发 Authorization（API Key 认证）
          const authHeader = req.headers['authorization'] as string | undefined;
          if (authHeader) {
            fetchHeaders['Authorization'] = authHeader;
          }

          console.log(`[API Proxy] Forwarding: ${req.method} ${targetUrl}`, {
            hasAuth: !!authHeader,
            bodyBytes: body.length,
          });

          // 使用 fetch() 转发请求 — 避免 Node.js v22 http.request 的崩溃问题
          const proxyRes = await fetch(targetUrl, {
            method: req.method,
            headers: fetchHeaders,
            body: body.length > 0 ? body : undefined,
            signal: AbortSignal.timeout(30000),
          });

          console.log(`[API Proxy] ← Target response: ${proxyRes.status} ${proxyRes.headers.get('content-type') || ''}`);

          // 构建响应头 — 只透传语义头，过滤掉连接专用头
          const responseHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': '*',
          };
          // 只透传安全的语义头
          const safeHeaders = ['content-type', 'cache-control', 'content-encoding', 'content-language'];
          for (const name of safeHeaders) {
            const value = proxyRes.headers.get(name);
            if (value) responseHeaders[name] = value;
          }

          res.writeHead(proxyRes.status, responseHeaders);

          // 流式转发响应体（支持 SSE）
          if (proxyRes.body) {
            const reader = proxyRes.body.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
              }
            } finally {
              reader.releaseLock();
            }
          }
          res.end();
        } catch (err: any) {
          console.error('[API Proxy] Handler failed:', err.message || err);
          if (!res.headersSent) {
            res.writeHead(502, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify({ error: `代理错误: ${err.message || '未知'}` }));
          } else {
            res.end();
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), basicSsl(), apiProxyPlugin()],
  server: {
    https: true,
    port: 3000,
    host: true,
  },
  assetsInclude: [
    '**/*.model3.json',
    '**/*.moc3',
    '**/*.physics3.json',
    '**/*.cdi3.json',
    '**/*.cubismcore.js',
  ],
});
