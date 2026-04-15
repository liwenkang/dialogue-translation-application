interface VoiceButtonProps {
  isRecording: boolean;
  isTranscribing: boolean;
  error: string | null;
  onClick: () => void;
  onClearError: () => void;
}

export default function VoiceButton({
  isRecording,
  isTranscribing,
  error,
  onClick,
  onClearError,
}: VoiceButtonProps) {
  return (
    <div className="relative">
      <button
        onClick={onClick}
        disabled={isTranscribing}
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ${
          isRecording
            ? "bg-red-500 text-white hover:bg-red-600 scale-110"
            : isTranscribing
              ? "bg-yellow-500 text-white cursor-wait"
              : "bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        }`}
        title={
          isRecording
            ? "停止录音"
            : isTranscribing
              ? "正在识别..."
              : "语音输入 (Cmd+Shift+Space)"
        }
      >
        {isTranscribing ? (
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : isRecording ? (
          <span className="relative flex items-end gap-[2px] h-4">
            <span className="w-[3px] h-full bg-white rounded-full animate-waveform" style={{ animationDelay: "0ms" }} />
            <span className="w-[3px] h-full bg-white rounded-full animate-waveform" style={{ animationDelay: "200ms" }} />
            <span className="w-[3px] h-full bg-white rounded-full animate-waveform" style={{ animationDelay: "400ms" }} />
          </span>
        ) : (
          "🎤"
        )}
      </button>

      {/* Pulse ring when recording */}
      {isRecording && (
        <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-level-pulse pointer-events-none" />
      )}

      {error && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300 text-xs px-3 py-1.5 rounded-lg shadow-lg z-10 animate-fade-in">
          {error}
          <button onClick={onClearError} className="ml-2 font-bold">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
