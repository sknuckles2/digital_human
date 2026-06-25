/**
 * Hermes / 本地 LLM 的 OpenAI 兼容 API 客户端
 * 支持流式 SSE 输出
 *
 * 在 Vite dev 模式下，自动通过 /api/llm 代理转发请求（解决 CORS）
 * 在 production 模式下直接请求 API（需要服务端开启 CORS）
 */
import type { Message, ApiConfig, StreamChunk } from '../types';

/** localStorage 读取配置 */
function getConfig(): ApiConfig {
  try {
    const saved = localStorage.getItem('dh_api_config');
    if (saved) return JSON.parse(saved);
  } catch {}
  return { endpoint: 'http://192.168.31.132:8642/v1', apiKey: '', modelPath: '/live2d-models/hiyori_pro/hiyori_pro_t11.model3.json', voiceEndpoint: 'http://localhost:6080', ttsVoice: 'Vivian', userName: '我', userAvatar: '', characterName: '数字人', characterAvatar: '', userColor: '#6366f1', characterColor: '#f59e0b' };
}

/**
 * 判断是否在 Vite dev 模式下运行
 * 只要是在本机浏览器（localhost / 127.0.0.1 / 192.168.* / 10.*）打开，都用代理
 */
function isDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  // localhost / 127.0.0.1
  if (host === 'localhost' || host === '127.0.0.1') return true;
  // 局域网 IP（通过 Vite --host 访问时）
  if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) return true;
  // 如果页面是 file:// 协议（localhost:3000）
  if (window.location.port && window.location.port !== '443' && window.location.port !== '80') return true;
  return false;
}

/**
 * 发送消息并流式接收回复
 */
export async function sendStreamMessage(
  messages: Message[],
  onChunk: (chunk: StreamChunk) => void,
): Promise<void> {
  const config = getConfig();
  const isDev = isDevMode();

  // Dev 模式：通过 Vite 代理转发（解决 CORS）
  // Production 模式：直接请求（需服务端开启 CORS）
  const url = isDev
    ? '/api/llm/chat/completions'
    : `${config.endpoint.replace(/\/$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // 在 dev 模式下，通过 header 告诉代理目标地址
  if (isDev) {
    headers['X-API-Target'] = config.endpoint;
  }

  // 添加 API Key（如果设置了）
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // Hermes 只支持流式 SSE，不支持 stream:false
  let response: Response | null = null;

  const bodyStreaming = JSON.stringify({
    model: 'default',
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: true,
  });

  console.log('[Hermes] Request config:', { isDev, url, targetEndpoint: config.endpoint, hasApiKey: !!config.apiKey });

  // 1) 尝试流式
  try {
    response = await fetch(url, { method: 'POST', headers, body: bodyStreaming });
    if (response.ok) {
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('text/event-stream') || ct.includes('application/x-ndjson')) {
        // SSE 成功，继续
      } else {
        // 不是 SSE 流，读完整内容
        const text = await response.text().catch(() => '');
        if (text.trim()) {
          // 直接输出完整内容
          try {
            const json = JSON.parse(text);
            const content = json.choices?.[0]?.message?.content ||
                           json.choices?.[0]?.text ||
                           json.content || '';
            if (content) {
              onChunk({ content, done: true });
              return;
            }
          } catch {}
          // 尝试逐行解析
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6));
                const c = json.choices?.[0]?.delta?.content ||
                         json.choices?.[0]?.message?.content ||
                         json.choices?.[0]?.text || '';
                if (c) {
                  onChunk({ content: c, done: false });
                }
              } catch {}
            }
          }
          onChunk({ content: '', done: true });
          return;
        }
      }
    }
  } catch (err: any) {
    // 流式请求网络失败
    console.error('[Hermes] fetch failed:', { message: err.message, name: err.name, configEndpoint: config.endpoint, url });
    if (err.message?.includes('Failed to fetch') || err.name === 'TypeError') {
      const hint = config.endpoint === 'http://localhost:8080/v1'
        ? ' (using default, configure your API address in Settings)'
        : '';
      throw new Error(
        isDev
          ? `Proxy connection failed: ${config.endpoint}${hint}`
          : `Cannot connect to API: ${config.endpoint}. Make sure the service is running and CORS is enabled`
      );
    }
    throw err;
  }

  // 流式请求返回了非 2xx 状态码
  if (!response || !response.ok) {
    const status = response ? response.status : '网络错误';
    throw new Error(`API returned ${status}`);
  }

  const reader = response!.body?.getReader();
  if (!reader) throw new Error('响应体不可读');

  const decoder = new TextDecoder();
  let buffer = '';
  let receivedContent = false;
  let parseErrorCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // 结束标记
        if (trimmed === 'data: [DONE]') {
          onChunk({ content: '', done: true });
          continue;
        }

        if (trimmed.startsWith('data: ')) {
          const rawJson = trimmed.slice(6);
          try {
            const json = JSON.parse(rawJson);
            const choice = json.choices?.[0];

            // 支持多种 SSE 格式：
            // 1. OpenAI 流式: choices[0].delta.content
            // 2. 非流式JSON: choices[0].message.content
            // 3. 其他实现: choices[0].text
            let content = '';
            if (choice) {
              content = choice.delta?.content ||
                       choice.message?.content ||
                       choice.text ||
                       '';
            }

            if (content) {
              receivedContent = true;
              onChunk({ content, done: false });
            }

            if (choice?.finish_reason === 'stop') {
              onChunk({ content: '', done: true });
            }
          } catch {
            parseErrorCount++;
            if (parseErrorCount <= 3) {
              console.warn('[SSE] JSON parse failed:', rawJson.slice(0, 100));
            }
          }
        } else if (trimmed.startsWith('{')) {
          // 纯 JSON 行（非 SSE 格式的容错处理）
          try {
            const json = JSON.parse(trimmed);
            const content = json.choices?.[0]?.delta?.content ||
                            json.choices?.[0]?.text ||
                            json.content || '';
            if (content) {
              receivedContent = true;
              onChunk({ content, done: false });
            }
          } catch {
            // 忽略
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // 流结束了但没有任何内容 → 报错
  if (!receivedContent) {
    throw new Error(
      'Model returned empty response. May be a model name mismatch or Hermes config issue.'
    );
  }

  onChunk({ content: '', done: true });
}

/**
 * 测试 API 连接
 * 用 GET /v1/models 验证连通性。优先通过 Vite 代理转发（解决 CORS），
 * 如果代理返回错误，自动回退到直连模式获取更准确的诊断信息。
 */
export async function testConnection(endpoint: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const isDev = isDevMode();
  const base = endpoint.replace(/\/$/, '');
  const config = getConfig();

  /** 尝试一次 fetch 请求 */
  async function tryFetch(url: string, mode: 'proxy' | 'direct'): Promise<{ ok: boolean; message: string }> {
    const headers: Record<string, string> = {};
    if (mode === 'proxy') headers['X-API-Target'] = base;
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    const label = mode === 'proxy' ? 'proxy' : 'direct';
    console.log(`[Hermes] Test connection(${label}):`, { url, targetEndpoint: base, hasApiKey: !!config.apiKey });

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000),
      });

      let body = '';
      try { body = await resp.text(); } catch {}

      if (resp.ok) {
        return { ok: true, message: `Connection OK ✓ (${label})` };
      }

      // 尝试解析代理内部的错误详情
      let detail = body.slice(0, 150);
      try {
        const json = JSON.parse(body);
        if (json.error) detail = json.error;
      } catch {}

      return { ok: false, message: `${label} returned ${resp.status}: ${detail}` };
    } catch (err: any) {
      console.error(`[Hermes] Test connection failed(${label}):`, { message: err.message, name: err.name });

      if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
        return { ok: false, message: `${label} timeout — check that the target service is running and address/port are correct` };
      }
      if (err.message?.includes('Failed to fetch') || err.name === 'TypeError') {
        return {
          ok: false,
          message: mode === 'proxy'
            ? `${label} error — proxy cannot reach target, check address accessibility`
            : `${label} failed — CORS issue or target unreachable`,
        };
      }
      return { ok: false, message: `${label} error: ${err.message || 'unknown'}` };
    }
  }

  // 1) 优先走代理（开发模式）
  if (isDev) {
    const result = await tryFetch('/api/llm/models', 'proxy');
    if (result.ok) return result;

    // 代理失败 → 回退到直连，给用户更具体的诊断
    console.log('[Hermes] Proxy failed, trying direct...');
    return await tryFetch(`${base}/models`, 'direct');
  }

  // 2) 生产模式直接请求
  return await tryFetch(`${base}/models`, 'direct');
}
