import { useState, useEffect, useCallback, useRef } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { SUPPORTED_LANGUAGES, OPUS_MT_MODELS } from "../../../shared/constants";
import type { ModelPairStatus, ModelInstallProgress } from "../../../shared/types";
import { showToast } from "../Toast/Toast";
import { ERROR_MESSAGES } from "../../../shared/error-messages";

type PairInstallState = {
  status: "idle" | "queued" | "downloading" | "converting" | "done" | "error";
  progress: number;
  message?: string;
};

export default function ModelManagerDialog() {
  const { showModelManager, setShowModelManager, highlightLang } = useSettingsStore();
  const [models, setModels] = useState<ModelPairStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [pairStates, setPairStates] = useState<Record<string, PairInstallState>>({});
  const [bulkInstalling, setBulkInstalling] = useState(false);
  const langRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToHighlight = useRef(false);

  const fetchModels = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const statuses = await window.electronAPI.getAllModelStatus();
      setModels(statuses);
    } catch (err) {
      console.error("Failed to fetch model status:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showModelManager) {
      hasScrolledToHighlight.current = false;
      fetchModels();
    }
  }, [showModelManager, fetchModels]);

  // Scroll to highlighted language only once when dialog first opens
  useEffect(() => {
    if (!loading && highlightLang && models.length > 0 && !hasScrolledToHighlight.current) {
      const targetLangGroup = highlightLang === "en" ? null : highlightLang;
      if (targetLangGroup) {
        hasScrolledToHighlight.current = true;
        setTimeout(() => {
          const el = langRefs.current[targetLangGroup];
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 100);
      }
    }
  }, [loading, highlightLang, models]);

  // Listen for install progress
  useEffect(() => {
    if (!showModelManager) return;

    const cleanup = window.electronAPI.onInstallModelProgress(
      (progress: ModelInstallProgress) => {
        setPairStates((prev) => ({
          ...prev,
          [progress.pair]: {
            status: progress.status as PairInstallState["status"],
            progress: progress.progress,
            message: progress.message,
          },
        }));

        if (progress.status === "done") {
          // Refresh model list after install completes (silent to preserve scroll)
          setTimeout(() => {
            fetchModels(true);
            setPairStates((prev) => {
              const next = { ...prev };
              delete next[progress.pair];
              return next;
            });
          }, 1000);
        }
      },
    );
    return cleanup;
  }, [showModelManager, fetchModels]);

  const handleInstallPair = useCallback(
    async (source: string, target: string) => {
      const pair = `${source}-${target}`;
      setPairStates((prev) => ({
        ...prev,
        [pair]: { status: "downloading", progress: 0 },
      }));

      try {
        await window.electronAPI.installTranslationPair(source, target);
        setPairStates((prev) => ({
          ...prev,
          [pair]: { status: "done", progress: 100 },
        }));
        fetchModels(true);
      } catch (err) {
        setPairStates((prev) => ({
          ...prev,
          [pair]: { status: "error", progress: 0, message: String(err) },
        }));
      }
    },
    [fetchModels],
  );

  const handleInstallAll = useCallback(async () => {
    const missing = models.filter((m) => !m.installed);
    if (missing.length === 0 || bulkInstalling) return;

    setBulkInstalling(true);
    setPairStates((prev) => {
      const next = { ...prev };
      for (const model of missing) {
        const pair = `${model.source}-${model.target}`;
        if (!next[pair] || next[pair].status === "idle") {
          next[pair] = { status: "queued", progress: 0 };
        }
      }
      return next;
    });

    try {
      for (const m of missing) {
        await handleInstallPair(m.source, m.target);
      }
    } finally {
      setBulkInstalling(false);
    }
  }, [models, handleInstallPair, bulkInstalling]);

  const handleDeletePair = useCallback(
    async (source: string, target: string) => {
      const pair = `${source}-${target}`;
      try {
        await window.electronAPI.deleteTranslationPair(source, target);
        showToast(`已删除模型 ${pair}`);
        fetchModels(true);
      } catch (err) {
        console.error("Failed to delete model:", err);
        showToast(ERROR_MESSAGES.MODEL_DELETE_FAILED);
      }
    },
    [fetchModels],
  );

  if (!showModelManager) return null;

  // Group models by language (non-en side)
  const langGroups: Record<string, ModelPairStatus[]> = {};
  for (const m of models) {
    const lang = m.source === "en" ? m.target : m.source;
    if (!langGroups[lang]) langGroups[lang] = [];
    langGroups[lang].push(m);
  }

  const getLangName = (code: string) =>
    SUPPORTED_LANGUAGES.find((l) => l.code === code)?.nativeName ?? code;

  const installedCount = models.filter((m) => m.installed).length;
  const totalCount = models.length;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) setShowModelManager(false);
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl mx-4 max-w-lg w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              翻译模型管理
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              已安装 {installedCount}/{totalCount} 个模型 · 所有翻译通过英语中转
            </p>
          </div>
          <button
            onClick={() => setShowModelManager(false)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              加载中...
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(langGroups)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([lang, pairs]) => {
                  const allInstalled = pairs.every((p) => p.installed);
                  const isHighlighted = highlightLang === lang || 
                    (highlightLang === "en" && false); // en has no group
                  return (
                    <div
                      key={lang}
                      ref={(el) => { langRefs.current[lang] = el; }}
                      className={`border rounded-lg overflow-hidden transition-all duration-500 ${
                        isHighlighted && !allInstalled
                          ? "border-blue-400 dark:border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800"
                          : "border-gray-200 dark:border-gray-600"
                      }`}
                    >
                      {/* Language header */}
                      <div className={`flex items-center justify-between px-4 py-2.5 ${
                        isHighlighted && !allInstalled
                          ? "bg-blue-50 dark:bg-blue-900/30"
                          : "bg-gray-50 dark:bg-gray-700/50"
                      }`}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                            {getLangName(lang)}
                          </span>
                          {allInstalled ? (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">
                              已就绪
                            </span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400">
                              部分缺失
                            </span>
                          )}
                          {isHighlighted && !allInstalled && (
                            <span className="text-xs text-blue-500 dark:text-blue-400 animate-pulse">
                              ← 请安装此语言模型
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Model pairs */}
                      <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {pairs.map((p) => {
                          const pair = `${p.source}-${p.target}`;
                          const state = pairStates[pair];
                          const isBusy =
                            state &&
                            state.status !== "idle" &&
                            state.status !== "done" &&
                            state.status !== "error";

                          return (
                            <div
                              key={pair}
                              className="flex items-center justify-between px-4 py-2"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-600 dark:text-gray-300">
                                  {getLangName(p.source)} → {getLangName(p.target)}
                                </span>
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                  opus-mt-{pair}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                {p.installed ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                      已安装
                                    </span>
                                    <button
                                      onClick={() => handleDeletePair(p.source, p.target)}
                                      className="text-xs px-1.5 py-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                                      title="删除此模型"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                ) : isBusy ? (
                                  <div className="flex items-center gap-2">
                                    <div className="w-20 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                        style={{
                                          width: `${state.status === "queued" ? 0 : state.status === "converting" ? 70 + state.progress * 0.3 : state.progress * 0.7}%`,
                                        }}
                                      />
                                    </div>
                                    <span className="text-xs text-blue-500 whitespace-nowrap">
                                      {state.status === "queued"
                                        ? "排队中..."
                                        : state.status === "downloading"
                                        ? "下载中..."
                                        : "转换中..."}
                                    </span>
                                  </div>
                                ) : state?.status === "error" ? (
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs text-red-500">失败</span>
                                    <button
                                      onClick={() => handleInstallPair(p.source, p.target)}
                                      className="text-xs px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
                                    >
                                      重试
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => handleInstallPair(p.source, p.target)}
                                    className="text-xs px-2.5 py-1 rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                                  >
                                    安装
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setShowModelManager(false)}
            className="text-sm px-4 py-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            关闭
          </button>
          {installedCount < totalCount && (
            <button
              onClick={handleInstallAll}
              disabled={bulkInstalling}
              className="text-sm px-4 py-1.5 rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bulkInstalling ? "正在安装缺失模型..." : "安装全部缺失模型"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
