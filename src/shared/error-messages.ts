// Unified error message constants for user-facing Toast notifications
export const ERROR_MESSAGES = {
  // Translation
  TRANSLATION_FAILED: "翻译失败，请检查翻译服务是否正常运行",
  TRANSLATION_SERVICE_RESTARTING: "翻译服务异常，正在重启...",
  TRANSLATION_DEPS_MISSING: "翻译依赖缺失，请安装 Python 环境",

  // Storage
  SAVE_MESSAGE_FAILED: "保存消息失败",
  DELETE_MESSAGE_FAILED: "删除消息失败",
  CLEAR_MESSAGES_FAILED: "清空消息失败",
  EXPORT_FAILED: "导出失败",
  LOAD_MESSAGES_FAILED: "加载消息失败",

  // Voice / Whisper
  VOICE_SAVE_FAILED: "保存语音消息失败",
  MIC_PERMISSION_DENIED: "麦克风权限被拒绝，请在系统设置中允许访问麦克风",
  MIC_ACCESS_FAILED: "无法访问麦克风",
  WHISPER_NOT_FOUND: "未找到 whisper-cpp，请安装: brew install whisper-cpp",

  // Model
  MODEL_DELETE_FAILED: "删除模型失败",

  // Clipboard
  COPIED: "已复制到剪贴板",
} as const;
