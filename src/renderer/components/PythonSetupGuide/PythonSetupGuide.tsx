import { useState, useCallback, useEffect } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { showToast } from "../Toast/Toast";
import { ERROR_MESSAGES } from "../../../shared/error-messages";
import type { VenvSetupProgress } from "../../../shared/types";

type DepsStatus = {
  pythonAvailable: boolean;
  ct2Available: boolean;
  spmAvailable: boolean;
};

export default function PythonSetupGuide() {
  const { showPythonSetup, setShowPythonSetup } = useSettingsStore();
  const [depsStatus, setDepsStatus] = useState<DepsStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<VenvSetupProgress | null>(null);

  const checkDeps = useCallback(async () => {
    setChecking(true);
    try {
      const status = await window.electronAPI.checkTranslationDeps();
      setDepsStatus(status);
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, []);

  const handleAutoInstall = useCallback(async () => {
    setInstalling(true);
    setProgress({ step: "finding-python", percent: 0, message: "准备中..." });
    try {
      const result = await window.electronAPI.setupPythonVenv();
      if (result.success) {
        showToast("Python 环境配置成功！");
        await checkDeps();
      } else {
        showToast(result.error || "自动安装失败，请尝试手动安装");
      }
    } catch {
      showToast("自动安装失败，请尝试手动安装");
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  }, [checkDeps]);

  useEffect(() => {
    if (!installing) return;
    const cleanup = window.electronAPI.onSetupPythonProgress((p) => {
      setProgress(p);
    });
    return cleanup;
  }, [installing]);

  const handleCopy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    showToast(ERROR_MESSAGES.COPIED);
  }, []);

  if (!showPythonSetup) return null;

  const isMac = navigator.userAgent.includes("Mac");
  const pipInstallCmd = "pip3 install ctranslate2 sentencepiece";
  const pythonInstallCmd = isMac
    ? "brew install python3"
    : "sudo apt install python3 python3-pip";

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) setShowPythonSetup(false);
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl mx-4 max-w-lg w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              翻译环境配置
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              翻译功能需要 Python 及相关依赖
            </p>
          </div>
          <button
            onClick={() => setShowPythonSetup(false)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* One-click install */}
          <div className="space-y-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">
              一键安装（推荐）
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              自动创建 Python 虚拟环境并安装所有翻译依赖。需要系统已安装 Python 3。
            </p>
            <button
              onClick={handleAutoInstall}
              disabled={installing || checking}
              className="text-sm px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {installing ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  正在安装...
                </>
              ) : (
                "一键安装翻译环境"
              )}
            </button>
            {installing && progress && (
              <div className="mt-3 space-y-1.5">
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {progress.message}
                </p>
              </div>
            )}
          </div>

          <div className="text-center text-xs text-gray-400">── 或手动安装 ──</div>

          {/* Step 1: Python */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">1</span>
              安装 Python 3
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 ml-7">
              如已安装可跳过此步骤。
            </p>
            <div className="ml-7 flex items-center gap-2">
              <code className="flex-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-2 rounded font-mono break-all">
                {pythonInstallCmd}
              </code>
              <button
                onClick={() => handleCopy(pythonInstallCmd)}
                className="text-xs text-blue-500 hover:text-blue-600 whitespace-nowrap px-2 py-1"
              >
                复制
              </button>
            </div>
          </div>

          {/* Step 2: Dependencies */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">2</span>
              安装翻译依赖
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 ml-7">
              安装 CTranslate2 和 SentencePiece：
            </p>
            <div className="ml-7 flex items-center gap-2">
              <code className="flex-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-2 rounded font-mono break-all">
                {pipInstallCmd}
              </code>
              <button
                onClick={() => handleCopy(pipInstallCmd)}
                className="text-xs text-blue-500 hover:text-blue-600 whitespace-nowrap px-2 py-1"
              >
                复制
              </button>
            </div>
          </div>

          {/* Step 3: Verify */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">3</span>
              验证安装
            </h3>
            <div className="ml-7">
              <button
                onClick={checkDeps}
                disabled={checking}
                className="text-sm px-4 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {checking ? "检测中..." : "检测依赖状态"}
              </button>

              {depsStatus && (
                <div className="mt-3 space-y-1.5">
                  <StatusRow label="Python 3" ok={depsStatus.pythonAvailable} />
                  <StatusRow label="CTranslate2" ok={depsStatus.ct2Available} />
                  <StatusRow label="SentencePiece" ok={depsStatus.spmAvailable} />

                  {depsStatus.pythonAvailable && depsStatus.ct2Available && depsStatus.spmAvailable && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                      所有依赖已就绪，可以关闭此窗口开始使用翻译功能。
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={() => setShowPythonSetup(false)}
            className="text-sm px-4 py-1.5 rounded-lg bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={ok ? "text-green-500" : "text-red-500"}>
        {ok ? "✓" : "✗"}
      </span>
      <span className={ok ? "text-gray-600 dark:text-gray-300" : "text-red-600 dark:text-red-400"}>
        {label}
      </span>
      <span className={`text-xs ${ok ? "text-green-500" : "text-red-500"}`}>
        {ok ? "已安装" : "未安装"}
      </span>
    </div>
  );
}
