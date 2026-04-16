import { useState, useEffect, useCallback, useRef } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useMessageStore } from "../../stores/messageStore";
import { SUPPORTED_LANGUAGES } from "../../../shared/constants";
import type { LanguageCode } from "../../../shared/constants";
import { showToast } from "../Toast/Toast";
import { ERROR_MESSAGES } from "../../../shared/error-messages";

export default function TopBar() {
  const { targetLang, setTargetLang, translationEnabled, toggleTranslation, openModelManager } =
    useSettingsStore();
  const { clearMessages } = useMessageStore();
  const [isMac, setIsMac] = useState(true);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    window.electronAPI.getPlatform().then((p) => setIsMac(p === "darwin"));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!langDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        btnRef.current && !btnRef.current.contains(target)
      ) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [langDropdownOpen]);

  const handleLanguageChange = useCallback(
    async (newLang: LanguageCode) => {
      // Check if models are installed for this language
      try {
        const result =
          await window.electronAPI.checkTranslationInstalled(newLang);
        if (result.installed) {
          setTargetLang(newLang);
          return;
        }

        // Models missing - open the model manager dialog
        setTargetLang(newLang);
        openModelManager(newLang);
      } catch (err) {
        console.error("Model check failed:", err);
        setTargetLang(newLang);
      }
    },
    [setTargetLang, openModelManager],
  );

  const handleClearMessages = useCallback(async () => {
    if (!confirm("确定要清空所有历史消息吗？此操作不可撤销。")) return;
    try {
      await window.electronAPI.clearMessages();
      clearMessages();
    } catch (err) {
      console.error("Failed to clear messages:", err);
      showToast(ERROR_MESSAGES.CLEAR_MESSAGES_FAILED);
    }
  }, [clearMessages]);


  return (
    <>
      <div
        className={`flex items-center justify-between px-4 pb-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 select-none ${isMac ? "pt-12" : "pt-[44px]"}`}
        style={{
          WebkitAppRegion: "drag",
          ...(!isMac && {
            paddingRight: "calc(100vw - env(titlebar-area-width, calc(100vw - 140px)))",
          }),
        } as React.CSSProperties}
      >
        {/* Left: App title */}
        <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          Dialogue Translation
        </h1>

        {/* Right: Controls */}
        <div
          className="flex items-center gap-3"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Clear messages */}
          <button
            onClick={handleClearMessages}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
            title="清空历史消息"
          >
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          {/* Translation toggle */}
          <button
            onClick={toggleTranslation}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${
              translationEnabled
                ? "bg-blue-500 text-white"
                : "bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300"
            }`}
            title={
              translationEnabled ? "Disable translation" : "Enable translation"
            }
          >
            {translationEnabled ? "翻译: 开" : "翻译: 关"}
          </button>

          {/* Target language selector */}
          <div className="relative">
            <button
              ref={btnRef}
              onClick={() => setLangDropdownOpen((v) => !v)}
              className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400 flex items-center gap-1"
            >
              {SUPPORTED_LANGUAGES.find((l) => l.code === targetLang)?.nativeName ?? targetLang}
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {langDropdownOpen && (
              <div
                ref={dropdownRef}
                className="absolute right-0 top-full mt-1 z-50"
              >
                <ul className="w-36 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg py-1 overflow-y-auto lang-dropdown-list max-h-64">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <li
                      key={lang.code}
                      onClick={() => {
                        handleLanguageChange(lang.code);
                        setLangDropdownOpen(false);
                      }}
                      className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                        lang.code === targetLang
                          ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                          : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                      }`}
                    >
                      {lang.nativeName}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Model manager button */}
          <button
            onClick={() => openModelManager()}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
            title="翻译模型管理"
          >
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
