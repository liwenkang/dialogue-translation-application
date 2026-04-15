import { useEffect, useRef, useCallback } from "react";
import { useMessageStore } from "../../stores/messageStore";
import MessageBubble from "./MessageBubble";

const PAGE_SIZE = 100;

export default function ChatView() {
  const {
    messages,
    isLoading,
    hasMoreMessages,
    prependMessages,
    setHasMoreMessages,
    streamingSessionId,
    streamingCommittedText,
    streamingDraftText,
    streamingCommittedTranslation,
  } = useMessageStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingMoreRef = useRef(false);

  // Throttled auto-scroll (100ms)
  useEffect(() => {
    if (scrollTimerRef.current) return;
    scrollTimerRef.current = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      scrollTimerRef.current = null;
    }, 100);
  }, [
    messages,
    streamingCommittedText,
    streamingDraftText,
    streamingCommittedTranslation,
  ]);

  // Load older messages when scrolling to top
  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container || !hasMoreMessages || isLoadingMoreRef.current) return;

    if (container.scrollTop < 200) {
      isLoadingMoreRef.current = true;
      const oldestTimestamp = messages[0]?.createdAt;
      if (oldestTimestamp === undefined) {
        isLoadingMoreRef.current = false;
        return;
      }

      const prevScrollHeight = container.scrollHeight;
      try {
        const olderMessages = await window.electronAPI.getMessages(
          PAGE_SIZE,
          oldestTimestamp,
        );
        if (olderMessages.length < PAGE_SIZE) {
          setHasMoreMessages(false);
        }
        if (olderMessages.length > 0) {
          prependMessages(olderMessages);
          // Preserve scroll position after prepending
          requestAnimationFrame(() => {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop = newScrollHeight - prevScrollHeight;
          });
        }
      } catch (err) {
        console.error("Failed to load more messages:", err);
      } finally {
        isLoadingMoreRef.current = false;
      }
    }
  }, [hasMoreMessages, messages, prependMessages, setHasMoreMessages]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400 dark:text-gray-500">Loading...</div>
      </div>
    );
  }

  if (messages.length === 0 && !streamingSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center">
          <div className="text-5xl mb-4">💬</div>
          <h2 className="text-lg font-medium text-gray-600 dark:text-gray-300 mb-2">
            开始对话
          </h2>
          <p className="text-sm text-gray-400 dark:text-gray-500 max-w-sm">
            在下方输入文字，支持自动语种检测。开启翻译后，输入的文字会被自动翻译为目标语言。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      onScroll={handleScroll}
    >
      {hasMoreMessages && messages.length > 0 && (
        <div className="text-center text-xs text-gray-400 py-2">
          向上滚动加载更多...
        </div>
      )}
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {/* Streaming voice bubble */}
      {streamingSessionId && (
        <div className="max-w-[85%] ml-auto animate-bubble-enter">
          <div className="bg-blue-500 text-white rounded-2xl rounded-br-md px-4 py-3 shadow-sm">
            {streamingCommittedText || streamingDraftText ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words streaming-text">
                {streamingCommittedText && (
                  <span className="animate-text-slide-in">{streamingCommittedText}</span>
                )}
                {streamingDraftText && (
                  <span className="draft-text">{streamingDraftText}</span>
                )}
                <span className="inline-block w-0.5 h-4 bg-white/80 ml-0.5 animate-cursor-blink align-text-bottom" />
              </p>
            ) : (
              <div className="flex items-center gap-2.5 text-sm">
                <span className="flex items-end gap-0.5 h-4">
                  <span className="w-0.5 h-full bg-white/70 rounded-full animate-waveform" style={{ animationDelay: "0ms" }} />
                  <span className="w-0.5 h-full bg-white/70 rounded-full animate-waveform" style={{ animationDelay: "150ms" }} />
                  <span className="w-0.5 h-full bg-white/70 rounded-full animate-waveform" style={{ animationDelay: "300ms" }} />
                  <span className="w-0.5 h-full bg-white/70 rounded-full animate-waveform" style={{ animationDelay: "450ms" }} />
                </span>
                正在聆听...
              </div>
            )}
          </div>
          {streamingCommittedTranslation && (
            <div className="mt-2 bg-white dark:bg-gray-700 rounded-2xl rounded-tr-md px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-600 animate-translation-reveal">
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100 streaming-text">
                {streamingCommittedTranslation}
                <span className="inline-block w-0.5 h-4 bg-gray-400/60 ml-0.5 animate-cursor-blink align-text-bottom" />
              </p>
              <div className="mt-2 text-xs text-gray-400">→ 实时稳定译文</div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-1 px-1">
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
              🎤 实时识别中
            </span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
