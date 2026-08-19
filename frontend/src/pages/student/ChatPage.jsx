import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Brain, AlertTriangle, Phone, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import { chatApi } from '../../services/chat.api';
import Card from '../../components/shared/Card';

const CHUNK_DELAY_MS = 40;

const ChatPage = () => {
  const [messages, setMessages] = useState([
    { role: 'ai', content: "Hi, I'm here to listen. What's on your mind today?" },
  ]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [sending, setSending] = useState(false);
  const [emergencyBanner, setEmergencyBanner] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  // Chunk rendering queue
  const chunkQueueRef = useRef([]);
  const renderedContentRef = useRef('');
  const renderIntervalRef = useRef(null);

  const flushChunks = useCallback(() => {
    if (renderIntervalRef.current) {
      clearInterval(renderIntervalRef.current);
      renderIntervalRef.current = null;
    }
    if (chunkQueueRef.current.length > 0) {
      const batch = chunkQueueRef.current.join('');
      chunkQueueRef.current = [];
      renderedContentRef.current += batch;
      setStreamingContent(renderedContentRef.current);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Cleanup: abort stream and clear interval on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (renderIntervalRef.current) clearInterval(renderIntervalRef.current);
    };
  }, []);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setSending(true);
    setStreamingContent('');
    chunkQueueRef.current = [];
    renderedContentRef.current = '';
    if (renderIntervalRef.current) {
      clearInterval(renderIntervalRef.current);
      renderIntervalRef.current = null;
    }

    const controller = chatApi.streamMessage(text, sessionId, {
      onStart: (event) => {
        setSessionId(event.sessionId);
        if (event.emergency) setEmergencyBanner(true);
      },
      onChunk: (event) => {
        chunkQueueRef.current.push(event.content);
        if (!renderIntervalRef.current) {
          renderIntervalRef.current = setInterval(() => {
            if (chunkQueueRef.current.length > 0) {
              const chunk = chunkQueueRef.current.shift();
              renderedContentRef.current += chunk;
              setStreamingContent(renderedContentRef.current);
            }
          }, CHUNK_DELAY_MS);
        }
      },
      onDone: () => {
        flushChunks();
        setStreamingContent((current) => {
          if (current) {
            setMessages((m) => [...m, { role: 'ai', content: current }]);
          }
          return '';
        });
        renderedContentRef.current = '';
        setSending(false);
      },
      onError: (message) => {
        flushChunks();
        setStreamingContent((current) => {
          if (current) {
            setMessages((m) => [...m, { role: 'ai', content: current }]);
          }
          return '';
        });
        renderedContentRef.current = '';
        setSending(false);
        toast.error(message || 'Failed to get response');
      },
    });

    abortRef.current = controller;
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    flushChunks();
    setStreamingContent((current) => {
      if (current) {
        setMessages((m) => [...m, { role: 'ai', content: current }]);
      }
      return '';
    });
    renderedContentRef.current = '';
    setSending(false);
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-teal-600 flex items-center justify-center">
          <Brain className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-display font-semibold text-teal-900 dark:text-white">AI Mental Health Assistant</h1>
          <p className="text-xs text-teal-600/70 dark:text-white/50">Not a replacement for professional care</p>
        </div>
      </div>

      {emergencyBanner && (
        <div className="bg-clay-500/10 border border-clay-500/30 rounded-2xl p-4 mb-4 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-clay-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-clay-600">
            <p className="font-semibold mb-1">You don't have to go through this alone.</p>
            <p className="mb-2">A counselor has been notified. If you're in immediate danger, please reach out right now:</p>
            <p className="flex items-center gap-2 font-semibold"><Phone className="w-4 h-4" /> iCall: 9152987821 · Vandrevala Foundation: 1860-2662-345</p>
          </div>
        </div>
      )}

      <Card className="flex-1 flex flex-col overflow-hidden p-0">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-teal-600 text-white rounded-tr-sm'
                    : 'bg-teal-600/10 text-teal-900 dark:text-white dark:bg-white/10 rounded-tl-sm'
                }`}
              >
                {m.role === 'user' ? (
                  m.content
                ) : (
                  <ReactMarkdown
                    components={{
                      ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1.5">{children}</ul>,
                      li: ({ children }) => <li>{children}</li>,
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-xl text-xs transition-colors shadow-sm no-underline"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          ))}

          {/* Streaming AI response — progressive rendering */}
          {streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] bg-teal-600/10 text-teal-900 dark:text-white dark:bg-white/10 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed">
                <ReactMarkdown
                  components={{
                    ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1.5">{children}</ul>,
                    li: ({ children }) => <li>{children}</li>,
                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-xl text-xs transition-colors shadow-sm no-underline"
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {streamingContent}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Typing indicator — shown while waiting for first chunk */}
          {sending && !streamingContent && (
            <div className="flex justify-start">
              <div className="bg-teal-600/10 rounded-2xl rounded-tl-sm px-4 py-2.5">
                <span className="loading loading-dots loading-sm text-teal-600" />
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        <form onSubmit={handleSend} className="flex gap-2 p-4 border-t border-teal-600/10">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type how you're feeling..."
            className="focus-ring flex-1 rounded-xl border border-teal-600/20 bg-white dark:bg-teal-900 px-4 py-2.5 text-sm text-teal-900 dark:text-white"
          />
          {sending ? (
            <button type="button" onClick={handleStop} className="btn bg-clay-500 hover:bg-clay-600 text-white border-none rounded-xl px-4">
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="btn bg-teal-600 hover:bg-teal-700 text-white border-none rounded-xl px-4">
              <Send className="w-4 h-4" />
            </button>
          )}
        </form>
      </Card>
    </div>
  );
};

export default ChatPage;
