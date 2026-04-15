# copilot-instructions

## 语言偏好

- 变量名、函数名、类型名：英文
- 代码注释：英文
- 与用户对话：中文

## 项目上下文

- 这是一个 local-first 的 Electron 桌面对话翻译应用；识别、翻译、存储默认都在本地完成，除模型下载外不要轻易引入云端依赖。
- 技术栈以 Electron 41、React 19、TypeScript 6、Vite 8、Zustand、better-sqlite3、Zod 为主。
- 语音识别依赖 Whisper.cpp，机器翻译依赖 Opus-MT + CTranslate2；开发态与生产态的运行路径不同，修改服务启动或打包逻辑时必须同时考虑两条路径。

## 架构边界

- `src/main` 负责 Electron 主进程能力：窗口、系统权限、SQLite、文件系统、子进程、模型管理、翻译服务、性能监控。
- `src/preload` 只负责通过 `contextBridge` 暴露最小且类型安全的 API，不要把业务逻辑堆在 preload。
- `src/renderer` 负责 React UI、hooks、Zustand 状态和用户交互；不要在 renderer 里直接访问 Node/Electron 底层能力。
- `src/shared` 是跨进程单一事实源，放 IPC channel、Zod schema、共享常量、语言类型和公共工具；不要在 main / preload / renderer 重复定义同一套字符串或类型。
- 涉及跨进程新能力时，优先按这条链路完整实现：`src/shared/ipc-channels.ts` → `src/shared/ipc-schemas.ts` / `src/shared/types.ts` → `src/preload/index.ts` → `src/main/index.ts` → renderer 调用方。

## 项目特有约束

- 翻译模型当前围绕 `X <-> en` 管理，非英语语言对默认通过英语 pivot；不要假设项目已经支持任意语言对的直连模型。
- 流式语音相关扩展优先沿用现有 AudioWorklet + streaming IPC 路径，不要退回到更旧的 MediaRecorder 式实现。
- 输入、翻译、存储相关 IPC 已有 Zod 校验；新增入参时优先扩展共享 schema，而不是只在调用侧做松散判断。
- TypeScript 开启了 `strict`；避免隐式 `any`，不要通过放宽类型来掩盖设计问题。
- 生成物目录如 `build/`、`release/`、PyInstaller 输出和 DMG 文件默认视为构建产物，除非用户明确要求，否则不要直接编辑。

## 行为准则

### 编码前先思考

- 明确说明假设。
- 如果存在多种解释，不要默默选择，直接列出。
- 如果有更简单的方法，直接指出。
- 如果关键点不清楚，先停下来确认。
- 优先先找“真正决定行为的位置”，不要在转发层或表层 wiring 上做补丁式修改。

### 保持简洁

- 用最少的必要代码解决问题。
- 避免推测性抽象和不必要的灵活性。
- 保持和现有目录职责一致，能放回已有 service、store、hook、shared 模块的，就不要新造一层。

### 精准修改

- 只修改必要部分。
- 保持现有代码风格。
- 如果改动导致导入、变量或函数不再使用，顺手删除。
- 每一行改动都必须直接服务于当前任务。
- 涉及 Electron 安全边界时，优先收紧暴露面，而不是为了方便把能力直接暴露到 renderer。

### 自行验证

- 回读修改后的代码，确认逻辑完整。
- 检查类型是否正确，确保没有隐式 `any`。
- 多步骤任务按步骤完成并逐步验证。
- 修 bug 时先理解根因，再验证原始场景已被覆盖。
- 这个项目没有单独的 lint / typecheck 脚本；默认用最贴近改动范围的命令验证，例如 `pnpm test`、`pnpm build`、必要时 `pnpm build:python`。

## 修改建议

- 改 renderer 交互时，优先复用现有 Zustand store、shared 常量和已有组件结构，不要把跨组件状态塞回局部组件树。
- 改 main service 时，优先延续现有 `*.service.ts` 组织方式，把进程管理、模型管理、存储和性能逻辑留在主进程。
- 改共享协议时，先改 shared，再同步 main / preload / renderer，避免出现 channel、schema、类型三者不一致。
- 改测试时，沿用现有 Vitest 结构，测试文件放在邻近模块的 `__tests__` 目录下并使用 `*.test.ts` / `*.test.tsx`。

## 打包与环境注意事项

- `pnpm build` 只覆盖主进程与渲染进程构建，不覆盖 Python 可执行文件和 whisper 二进制。
- 涉及翻译服务打包时，注意 `pnpm build:python` 依赖仓库根目录下的 `.pyinstaller-venv` 和对应 Python 依赖。
- 涉及语音输入打包验证时，macOS 上仅有 Info.plist 权限声明不够，应用还必须有效签名；没有可用签名证书时，不要声称已验证打包后的麦克风权限流程。
