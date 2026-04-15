import { useEffect } from "react";
import TopBar from "./components/TopBar/TopBar";
import ChatView from "./components/ChatView/ChatView";
import InputArea from "./components/InputArea/InputArea";
import ModelManagerDialog from "./components/ModelManagerDialog/ModelManagerDialog";
import ToastContainer from "./components/Toast/Toast";
import { showToast } from "./components/Toast/Toast";
import { useMessageStore } from "./stores/messageStore";
import { useSettingsStore } from "./stores/settingsStore";
import { SUPPORTED_LANGUAGES } from "../shared/constants";
import type { LanguageCode } from "../shared/constants";

export default function App() {
  const { setMessages, setLoading, setHasMoreMessages } = useMessageStore();
  const { toggleTranslation, targetLang, setTargetLang, translationEnabled } =
    useSettingsStore();

  useEffect(() => {
    const PAGE_SIZE = 100;
    async function loadMessages() {
      setLoading(true);
      try {
        const messages = await window.electronAPI.getMessages(PAGE_SIZE);
        setMessages(messages);
        setHasMoreMessages(messages.length >= PAGE_SIZE);
      } catch (err) {
        console.error("Failed to load messages:", err);
      } finally {
        setLoading(false);
      }
    }
    loadMessages();
  }, [setMessages, setLoading, setHasMoreMessages]);

  // Global keyboard shortcuts (in-app, not system-wide)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        toggleTranslation();
        const newState = !translationEnabled;
        showToast(newState ? "翻译已开启" : "翻译已关闭");
      }

      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
        const idx = codes.indexOf(targetLang);
        const nextLang = codes[(idx + 1) % codes.length] as LanguageCode;
        setTargetLang(nextLang);
        const label = SUPPORTED_LANGUAGES.find((l) => l.code === nextLang)?.nativeName;
        showToast(`目标语言: ${label}`);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTranslation, translationEnabled, targetLang, setTargetLang]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      <TopBar />
      <ChatView />
      <InputArea />
      <ModelManagerDialog />
      <ToastContainer />
    </div>
  );
}
