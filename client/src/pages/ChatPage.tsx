import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Streamdown } from 'streamdown';
import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { Button, ScrollArea, Textarea } from '@databricks/appkit-ui/react';

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface ChatMessage {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  created_at: string;
}

const MODEL_NAME = 'databricks-gpt-5-4-mini';

function createTransport(chatIdRef: React.RefObject<string | null>) {
  return new DefaultChatTransport({
    api: '/api/chat',
    body: () => (chatIdRef.current ? { chatId: chatIdRef.current } : {}),
    headers: { 'Content-Type': 'application/json' },
  });
}

function formatTimestamp(date: Date | string | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getMessageText(message: { parts?: unknown[]; content?: string }): string {
  if (message.content) return message.content;
  return (message.parts ?? [])
    .filter((p): p is { type: string; text: string } => {
      if (typeof p !== 'object' || p === null) return false;
      return (p as { type?: unknown }).type === 'text';
    })
    .map((p) => p.text)
    .join('');
}

export function ChatPage() {
  const [chatId, setChatId] = useState<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const chatLoadTokenRef = useRef(0);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const transportRef = useRef(createTransport(chatIdRef));

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autosize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const forceBlockContent = (vp: HTMLDivElement) => {
    const content = vp.firstElementChild as HTMLElement | null;
    if (content) content.style.display = 'block';
  };

  const sidebarScrollAreaRef = useCallback((node: HTMLDivElement | null) => {
    const vp = node?.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]') ?? null;
    if (vp) forceBlockContent(vp);
  }, []);

  const scrollAreaRef = useCallback((node: HTMLDivElement | null) => {
    const vp = node?.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]') ?? null;
    viewportRef.current = vp;
    if (!vp) return;
    forceBlockContent(vp);
    vp.addEventListener('scroll', () => {
      const top = vp.scrollTop;
      if (top < lastScrollTopRef.current - 5) stickToBottomRef.current = false;
      if (vp.scrollHeight - top - vp.clientHeight < 20) stickToBottomRef.current = true;
      lastScrollTopRef.current = top;
    });
  }, []);

  const { messages, setMessages, sendMessage, status } = useChat({
    transport: transportRef.current,
  });

  const loadChats = useCallback(async () => {
    const res = await fetch('/api/chats');
    if (res.ok) setChats(await res.json());
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (vp && stickToBottomRef.current) vp.scrollTop = vp.scrollHeight;
  }, [messages]);

  const activeChat = chats.find((c) => c.id === chatId) ?? null;

  const selectChat = useCallback(
    async (id: string) => {
      const loadToken = ++chatLoadTokenRef.current;
      setChatId(id);
      chatIdRef.current = id;
      setMessages([]);
      const res = await fetch(`/api/chats/${id}/messages`);
      if (!res.ok) return;
      const saved: ChatMessage[] = await res.json();
      if (loadToken !== chatLoadTokenRef.current) return;
      const restored = saved.map((m, i) => ({
        id: m.id || String(i),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        parts: [{ type: 'text' as const, text: m.content }],
        createdAt: new Date(m.created_at),
      }));
      setMessages(restored);
    },
    [setMessages]
  );

  const startNewChat = useCallback(() => {
    chatLoadTokenRef.current += 1;
    setChatId(null);
    chatIdRef.current = null;
    setMessages([]);
  }, [setMessages]);

  const deleteChat = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      if (chatIdRef.current === id) {
        chatLoadTokenRef.current += 1;
        setChatId(null);
        chatIdRef.current = null;
        setMessages([]);
      }
      setChats((prev) => prev.filter((c) => c.id !== id));
    },
    [setMessages]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (status !== 'ready') return;
      const text = input.trim();
      if (!text) return;

      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      inputRef.current?.focus();
      stickToBottomRef.current = true;

      void (async () => {
        if (!chatIdRef.current) {
          const title = text.slice(0, 80);
          const res = await fetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
          });
          if (!res.ok) return;
          const chat: ChatSession = await res.json();
          setChatId(chat.id);
          chatIdRef.current = chat.id;
        }
        await sendMessage({ text });
        void loadChats();
      })();
    },
    [input, status, sendMessage, setInput, loadChats]
  );

  const messageCount = messages.length > 0 ? messages.length : (activeChat?.message_count ?? 0);

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      {/* Top navigation bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-black px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
          <span className="text-sm font-medium text-white">CarePilot AI Assistant</span>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
          Streaming · Lakebase Memory
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
          <div className="px-4 py-4">
            <h2 className="text-sm font-semibold text-white">Conversations</h2>
          </div>
          <div className="px-4 pb-3">
            <Button
              variant="outline"
              className="w-full justify-start gap-2 border-neutral-700 bg-transparent text-neutral-300 hover:bg-neutral-900 hover:text-white"
              onClick={startNewChat}
            >
              <MessageSquarePlus className="h-4 w-4" />
              New Chat
            </Button>
          </div>
          <ScrollArea ref={sidebarScrollAreaRef} className="min-h-0 flex-1">
            <div className="space-y-0.5 px-2 pb-4">
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-1 overflow-hidden rounded-md transition-colors ${
                    chatId === chat.id ? 'bg-neutral-800' : 'hover:bg-neutral-900'
                  }`}
                >
                  <button
                    onClick={() => selectChat(chat.id)}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left"
                  >
                    <span
                      className={`truncate text-sm ${chatId === chat.id ? 'font-medium text-white' : 'text-neutral-200'}`}
                    >
                      {chat.title}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {formatRelativeDate(chat.updated_at)} · {chat.message_count} message
                      {chat.message_count !== 1 ? 's' : ''}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete chat"
                    title="Delete chat"
                    className="mr-1 h-7 w-7 shrink-0 p-0 text-neutral-600 opacity-0 hover:bg-neutral-700 hover:text-neutral-300 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) void deleteChat(chat.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {chats.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-neutral-600">No previous conversations</p>
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Main chat area */}
        <main className="flex min-w-0 flex-1 flex-col bg-black">
          {/* Chat header */}
          <div className="border-b border-neutral-800 px-8 py-5">
            <h1 className="text-xl font-semibold text-white">
              {activeChat?.title ?? 'New conversation'}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              {MODEL_NAME}
              {messageCount > 0 && ` · ${messageCount} message${messageCount !== 1 ? 's' : ''}`}
              {' · backed by Lakebase Postgres'}
            </p>
          </div>

          {/* Messages */}
          <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
            <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <p className="text-base font-medium text-neutral-300">Start a conversation</p>
                  <p className="mt-2 max-w-md text-sm text-neutral-600">
                    Send a message to begin. Responses stream token-by-token and are persisted in Lakebase.
                  </p>
                </div>
              )}
              {messages.map((message) => {
                const isUser = message.role === 'user';
                const timestamp = formatTimestamp(
                  'createdAt' in message ? (message.createdAt as Date | undefined) : undefined
                );
                const text = getMessageText(message);

                return (
                  <div
                    key={message.id}
                    className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                        isUser
                          ? 'bg-white text-black'
                          : 'bg-neutral-800 text-neutral-100 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-neutral-900 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_code]:font-mono [&_code]:text-xs'
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{text}</p>
                      ) : (
                        <Streamdown animated={status === 'streaming'} className="text-sm">
                          {text}
                        </Streamdown>
                      )}
                    </div>
                    <span className="text-xs text-neutral-600">
                      {isUser ? 'You' : 'Assistant'}
                      {timestamp && ` · ${timestamp}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-neutral-800 px-8 py-4">
            <form className="mx-auto flex max-w-3xl items-end gap-3" onSubmit={handleSubmit}>
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autosize();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder="Send a message..."
                autoFocus
                rows={1}
                className="max-h-[200px] min-h-[44px] resize-none border-neutral-700 bg-neutral-900 text-white placeholder:text-neutral-600 focus-visible:ring-neutral-600"
              />
              <Button
                type="submit"
                disabled={status !== 'ready' || !input.trim()}
                className="shrink-0 bg-white text-black hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-600"
              >
                {status === 'submitted' || status === 'streaming' ? 'Sending' : 'Send'}
              </Button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
