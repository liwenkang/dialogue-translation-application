# Dialogue Translation Application

[![Electron](https://img.shields.io/badge/Electron-41.x-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey)]()

一个完全本地化的桌面对话翻译应用，支持文字输入、语音输入、流式识别和多语言翻译。项目基于 Electron + React 构建，使用 Whisper.cpp 进行语音识别，使用 Opus-MT + CTranslate2 进行机器翻译。所有 AI 推理在设备本地执行，用户数据不会离开设备。

> Local-First: 模型下载需要联网，但识别、翻译、存储与历史记录均在本地完成。

---

## 目录

- [功能特性](#功能特性)
- [演示截图](#演示截图)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [使用说明](#使用说明)
- [快捷键](#快捷键)
- [支持的语言](#支持的语言)
- [技术架构](#技术架构)
- [项目结构](#项目结构)
- [技术选型](#技术选型)
- [性能概览](#性能概览)
- [文档索引](#文档索引)
- [贡献指南](#贡献指南)
- [License](#license)

---

## 功能特性

| 功能           | 说明                                                                  |
| -------------- | --------------------------------------------------------------------- |
| 键盘文字输入   | 在对话界面输入文字，自动检测语种（tinyld + CJK 正则前置判断）         |
| 语音输入       | 麦克风录音后由 Whisper.cpp 本地转写，自动识别语种                     |
| 流式语音识别   | 基于 AudioWorklet + VAD 分段转写，实时显示 committed / draft 双层状态 |
| 本地翻译       | Opus-MT 模型 + CTranslate2 引擎，9 种语言互译，完全离线               |
| 流式翻译       | 长文本按标点或长度阈值切块，逐块翻译、逐块展示                        |
| Pivot 中转翻译 | 非英语语言对自动通过英语中转，例如 `zh -> en -> fr`                   |
| 翻译模型管理   | 顶栏模型管理器支持查看安装状态、单个安装、安装全部缺失模型、删除模型  |
| 模型按需下载   | Whisper 与翻译模型均按需下载，Whisper 与翻译模型都带完整性校验        |
| 历史消息持久化 | SQLite 本地存储，默认启用 WAL                                         |
| 历史分页与清空 | 聊天记录按时间分页加载，支持一键清空全部历史消息                      |
| 重新翻译与复制 | 历史消息可切换目标语言重新翻译，译文可一键复制                        |
| 性能监控       | 内置 PerformanceService，可输出耗时、内存和系统信息                   |

## 演示截图

![image_1](/Users/liwenkang/Desktop/dialogue-translation-application/images/image_1.png)

![image_1](/Users/liwenkang/Desktop/dialogue-translation-application/images/image_1.png)

![image_2](/Users/liwenkang/Desktop/dialogue-translation-application/images/image_2.png)

![image_3](/Users/liwenkang/Desktop/dialogue-translation-application/images/image_3.png)

## 环境要求

### 运行已打包应用

| 项目     | 说明                |
| -------- | ------------------- |
| 操作系统 | macOS 或 Windows    |
| 网络     | 仅模型下载阶段需要  |
| 额外依赖 | 无需手动安装 Python |

### 开发与打包

| 工具        | 版本    | 用途                                               |
| ----------- | ------- | -------------------------------------------------- |
| Node.js     | >= 20.x | Electron / Vite 开发与构建                         |
| pnpm        | >= 8.x  | 包管理器                                           |
| Python      | >= 3.8  | 开发模式运行翻译服务、模型转换                     |
| cmake       | latest  | 构建内置 whisper.cpp 二进制                        |
| whisper-cpp | latest  | 仅开发模式语音识别可选依赖，需可执行文件在 PATH 中 |

> 生产打包时，Electron 会把 `translate-server`、`convert-model`、`whisper-server` 和 `whisper-cli` 一并打进安装包。开发模式下，翻译服务直接运行 `native/ctranslate2/translate_server.py`，语音识别优先依赖系统中的 whisper 可执行文件。

### 开发环境安装 whisper-cpp

macOS:

```bash
brew install whisper-cpp
```

Windows / 手动构建:

参考 [whisper.cpp 官方文档](https://github.com/ggerganov/whisper.cpp) 编译 `whisper-server` 和 `whisper-cli`，并确保它们在系统 PATH 中。

### 开发环境安装 Python 依赖

```bash
pip install ctranslate2 sentencepiece
```

如果需要执行 `pnpm build:python` 或 `pnpm electron:build`，当前脚本假设仓库根目录已存在 `.pyinstaller-venv`：

```bash
python3 -m venv .pyinstaller-venv
source .pyinstaller-venv/bin/activate
pip install pyinstaller ctranslate2 sentencepiece "numpy<2" "torch==2.2.2" "transformers==4.41.2"
```

## 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/liwenkang/dialogue-translation-application.git
cd dialogue-translation-application

# 2. 安装依赖
pnpm install

# 3. 启动开发模式
pnpm dev

# 4. 构建主进程 + 渲染进程
pnpm build

# 5. 构建翻译与语音运行时（可单独执行）
pnpm build:python
pnpm build:whisper

# 6. 打包安装文件
pnpm electron:build
```

### 常用脚本

| 命令                        | 说明                                                  |
| --------------------------- | ----------------------------------------------------- |
| `pnpm dev`                  | 启动开发模式（Vite HMR + Electron）                   |
| `pnpm build`                | 构建主进程与渲染进程                                  |
| `pnpm build:python`         | 使用 PyInstaller 生成翻译服务与模型转换二进制         |
| `pnpm build:whisper`        | 从源码构建打包内置的 `whisper-server` / `whisper-cli` |
| `pnpm electron:build`       | 打包安装文件                                          |
| `pnpm electron:build:voice` | macOS 先检查语音权限签名配置，再执行正式打包          |
| `pnpm test`                 | 运行单元测试                                          |
| `pnpm test:watch`           | 监听模式运行测试                                      |

## 使用说明

### 文字输入

1. 在底部输入框中输入文字。
2. 按 `Enter` 发送，按 `Shift+Enter` 换行。
3. 应用会自动检测语种。
4. 如果翻译已开启且模型可用，消息会自动翻译为当前目标语言。

### 语音输入

1. 点击麦克风按钮或按 `Cmd/Ctrl+Shift+Space` 开始录音。
2. 首次录音会检查麦克风权限与 Whisper 模型状态。
3. 录音过程中通过 VAD 自动分段，识别文字会实时显示在对话区。
4. 再次点击按钮或按快捷键停止录音，最终文字保存为消息。

> Whisper 模型首次下载完成后，应用会在后台预热常驻 `whisper-server`，减少后续识别等待。

### 翻译功能

1. 点击顶栏的“翻译: 关/开”切换自动翻译。
2. 通过目标语言下拉菜单选择译入语言。
3. 如果当前语言缺少模型，应用会自动打开模型管理器。
4. 短文本走单次翻译，长文本或含标点文本自动切换到流式翻译。

### 模型管理

- 点击顶栏设置按钮打开模型管理器。
- 按语言查看 `en <-> 目标语言` 语言对是否安装。
- 支持单个安装、安装全部缺失模型、删除已安装模型。

### 历史消息

- 顶栏垃圾桶按钮可清空全部历史消息。
- 向上滚动聊天列表会按 100 条一页加载更早的消息。
- 历史消息支持切换目标语言重新翻译。

### 复制译文

- 点击译文区域的“复制译文”按钮即可复制当前译文。

## 快捷键

| 快捷键                 | 功能             |
| ---------------------- | ---------------- |
| `Enter`                | 发送消息         |
| `Shift+Enter`          | 换行             |
| `Cmd/Ctrl+Shift+Space` | 开始 / 停止录音  |
| `Cmd/Ctrl+T`           | 切换翻译开关     |
| `Cmd/Ctrl+L`           | 循环切换目标语言 |

## 支持的语言

| 语言     | 代码 | 本地名称 |
| -------- | ---- | -------- |
| 中文     | `zh` | 中文     |
| 英文     | `en` | English  |
| 日文     | `ja` | 日本語   |
| 韩文     | `ko` | 한국어   |
| 法文     | `fr` | Français |
| 德文     | `de` | Deutsch  |
| 俄文     | `ru` | Русский  |
| 西班牙文 | `es` | Español  |
| 意大利文 | `it` | Italiano |

所有非英语语言之间的翻译都通过英语自动中转，因为当前实现只管理 `X <-> en` 的模型对。

## 技术架构

详见 [架构设计说明](架构设计说明.md)。当前实现的关键点如下：

- 渲染进程：React 19 + Zustand，负责输入、聊天视图、模型管理器和流式 UI。
- 主进程：负责 SQLite、IPC、Whisper 调度、翻译服务编排和性能监控。
- Whisper：优先启动常驻 `whisper-server`，必要时回退到 `whisper-cli`。
- 翻译：开发模式运行 Python 脚本，生产模式运行 PyInstaller 冻结后的 `translate-server`。

## 项目结构

```text
dialogue-translation-application/
├── native/ctranslate2/          # translate_server.py / convert_model.py
├── scripts/                     # whisper 构建与模型转换脚本
├── src/
│   ├── main/                    # Electron 主进程与服务
│   ├── preload/                 # contextBridge API 暴露
│   ├── renderer/                # React 渲染进程
│   │   ├── components/          # ChatView / InputArea / TopBar / ModelManagerDialog
│   │   ├── hooks/               # useAudioCapture / useStreamingAudio / useStreamingTranslation
│   │   ├── public/              # audio-capture-processor.js
│   │   └── stores/              # Zustand 状态管理
│   └── shared/                  # IPC 常量、类型、语言检测、通用常量
├── electron-builder.yml
├── package.json
├── vite.config.ts
└── vitest.config.ts
```

## 技术选型

详见 [技术选型说明](技术选型说明.md)。

| 组件       | 当前实现                                       |
| ---------- | ---------------------------------------------- |
| 桌面框架   | Electron 41                                    |
| UI         | React 19 + TypeScript 6                        |
| 渲染层构建 | Vite 8 + Tailwind CSS 4                        |
| 语音识别   | Whisper.cpp（`whisper-server` 优先，CLI 回退） |
| 机器翻译   | Opus-MT + CTranslate2                          |
| 本地存储   | better-sqlite3（WAL）                          |
| 状态管理   | Zustand                                        |
| 参数校验   | Zod                                            |

## 性能概览

详见 [性能分析](性能分析.md)。

| 指标           | 说明                                    |
| -------------- | --------------------------------------- |
| 应用冷启动     | 约 1.3s，不含模型下载                   |
| 短句翻译延迟   | 约 200-500ms                            |
| Pivot 翻译延迟 | 约 600-1500ms                           |
| 空闲内存       | 未预热模型时约 150-200MB                |
| Whisper 识别   | 5 秒音频约 2-4s，模型已下载时可后台预热 |

## 文档索引

| 文档                            | 说明                                             |
| ------------------------------- | ------------------------------------------------ |
| [技术选型说明](技术选型说明.md) | 桌面框架、语音识别、翻译引擎与配套技术的选择理由 |
| [架构设计说明](架构设计说明.md) | 进程模型、数据流、IPC 协议与安全设计             |
| [性能分析](性能分析.md)         | 内存、CPU、启动与推理延迟分析                    |
| [软件设计哲学](软件设计哲学.md) | Local-First、渐进式加载、流式体验与进程隔离原则  |

## 贡献指南

1. Fork 本仓库。
2. 创建功能分支：`git checkout -b feature/my-feature`。
3. 提交更改：`git commit -m 'feat: add some feature'`。
4. 推送分支：`git push origin feature/my-feature`。
5. 提交 Pull Request。

### 开发规范

- 变量名、函数名、类型名使用英文。
- 代码注释使用英文。
- TypeScript 严格模式，避免隐式 `any`。
- 提交前运行 `pnpm test`；如涉及打包链路，再运行 `pnpm electron:build` 或对应子命令。
