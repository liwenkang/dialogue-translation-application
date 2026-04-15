import { create } from "zustand";
import type { Message } from "../../shared/types";

interface MessageState {
  messages: Message[];
  isLoading: boolean;
  hasMoreMessages: boolean;
  translatingIds: Set<string>;
  // Streaming voice: real-time recognition with draft/committed text
  streamingSessionId: string | null;
  streamingCommittedText: string;
  streamingDraftText: string;
  streamingCommittedTranslation: string;
  setMessages: (messages: Message[]) => void;
  prependMessages: (messages: Message[]) => void;
  setHasMoreMessages: (hasMore: boolean) => void;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  removeMessage: (messageId: string) => void;
  setLoading: (loading: boolean) => void;
  setTranslating: (messageId: string, isTranslating: boolean) => void;
  setStreamingState: (
    sessionId: string | null,
    committed?: string,
    draft?: string,
    committedTranslation?: string,
  ) => void;
  clearMessages: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  isLoading: false,
  hasMoreMessages: true,
  translatingIds: new Set(),
  streamingSessionId: null,
  streamingCommittedText: "",
  streamingDraftText: "",
  streamingCommittedTranslation: "",
  setMessages: (messages) => set({ messages }),
  prependMessages: (olderMessages) =>
    set((state) => ({ messages: [...olderMessages, ...state.messages] })),
  setHasMoreMessages: (hasMore) => set({ hasMoreMessages: hasMore }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (messageId, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, ...updates } : msg,
      ),
    })),
  removeMessage: (messageId) =>
    set((state) => ({
      messages: state.messages.filter((msg) => msg.id !== messageId),
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setTranslating: (messageId, isTranslating) =>
    set((state) => {
      const next = new Set(state.translatingIds);
      if (isTranslating) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      return { translatingIds: next };
    }),
  setStreamingState: (sessionId, committed, draft, committedTranslation) =>
    set(
      sessionId === null
        ? {
            streamingSessionId: null,
            streamingCommittedText: "",
            streamingDraftText: "",
            streamingCommittedTranslation: "",
          }
        : {
            streamingSessionId: sessionId,
            streamingCommittedText: committed ?? "",
            streamingDraftText: draft ?? "",
            streamingCommittedTranslation: committedTranslation ?? "",
          },
    ),
  clearMessages: () => set({ messages: [] }),
}));
