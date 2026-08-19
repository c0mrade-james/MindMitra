import axiosInstance from './axiosInstance';
import { getAccessToken } from './axiosInstance';

const API_URL = import.meta.env.VITE_API_URL;

export const chatApi = {
  sendMessage: (message, sessionId) => axiosInstance.post('/chat/message', { message, sessionId }),
  getHistory: (sessionId) => axiosInstance.get(`/chat/history/${sessionId}`),
  getSessions: () => axiosInstance.get('/chat/sessions'),

  /**
   * Streams an AI response via SSE using fetch + ReadableStream.
   * Calls onChunk({ type, content, emergency, sessionId }) for each SSE event.
   * Returns an AbortController so the caller can cancel the stream.
   */
  streamMessage: (message, sessionId, { onChunk, onDone, onError, onStart }) => {
    const controller = new AbortController();

    (async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(`${API_URL}/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({ message, sessionId }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Stream request failed' }));
          onError?.(err.message || 'Failed to start stream');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);
              if (event.type === 'start') onStart?.(event);
              else if (event.type === 'chunk') onChunk?.(event);
              else if (event.type === 'done') onDone?.(event);
              else if (event.type === 'error') onError?.(event.message);
            } catch {
              // skip malformed JSON lines
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          onError?.(err.message || 'Stream failed');
        }
      }
    })();

    return controller;
  },
};
