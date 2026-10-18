# 小鱼儿画布整合包

> Seedance 2.5 本地 AI 画布 · Windows x64 整合版

![Windows](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D4)
![Seedance](https://img.shields.io/badge/Seedance-2.5-FF7A33)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

## 项目介绍

小鱼儿画布整合包是一个面向 Windows x64 的本地 AI 画布。它把 Seedance 2.5 的图片/视频生成节点、项目画布、素材管理、本地超分和本地补帧，整理成一个**解压即用**的目录。

不需要安装 Node.js、pnpm、Python 或 FFmpeg；运行所需的 Node 运行时和本地处理引擎都在包内。默认是空库、无 API Key，用户第一次打开时自己新建项目、自己配置模型。

**项目目标**：把「生成 → 参考/续写 → 本地超分/补帧 → 结果回画布」这条工作流做成可复制、可离线运行的 Windows 整合包，而不是让每个用户重新配一遍环境。

> 本项目是非官方本地整合版，不是 BeatDesign / Seedance 的官方产品。

## 这个仓库里有什么

| 内容 | 位置 |
| --- | --- |
| 应用源码（`src/`、`messages/`、`public/`、`drizzle/`、构建配置） | 本仓库 `source/` |
| 启动脚本、许可证、开源声明 | 本仓库根目录 |
| 构建产物 `.output/`、Node 运行时 `runtime/`、本地引擎 `SnowLeopard Vision/` | **不进 Git**，随本仓库的 Releases 发布 |
| 本地数据 `data/` | 首次启动自动生成，仓库不包含 |

仓库只放可读源码（约 8 MB），运行包请到 Releases 下载。这样代码能审、clone 也快；1 GB 级的引擎和运行时不必进版本历史。

## 功能列表

- **无限画布与项目组织**
  - 项目、子项目、文件夹、节点连线和画布缩放
  - 画布布局、项目快照和刷新恢复
- **Seedance 2.5 生成节点**
  - 图片/视频生成节点，提示词、参考图、首帧/尾帧、编辑/延长等模式
  - 默认「本地演示」模式，不联网、不产生费用；接真实模型时在设置中填自己的 Key
- **本地素材与历史**
  - 项目素材库、历史素材、生成结果回填画布
  - 素材按项目隔离，生成结果落到本地
- **本地超分**
  - Real-ESRGAN、Real-CUGAN、Anime4K
  - 2×/3×/4× 或自定义宽/高，只填一边，另一边按比例计算
  - GPU、编码器、位深、分块等高级设置
- **本地补帧**
  - RIFE、ffmpeg minterpolate
  - 60 FPS、自定义帧率、重复帧处理、转场保护、保留原音频
- **3D 导演台**
  - 搭场景、摆机位、导出参考视频
- **Windows 便携运行**
  - 自带 Node 运行时和本地引擎子集
  - 空库启动，数据全部留在 `data\`
  - 关闭命令行窗口即停止，不写系统服务

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、TanStack Start / Router、React Flow、Tailwind CSS 4、Base UI / shadcn |
| 语言 | TypeScript |
| 服务端 | Node.js、TanStack Start server routes |
| 数据 | SQLite、Drizzle ORM |
| 构建 | Vite、pnpm |
| 生成模型 | Seedance 2.5（火山方舟）、本地演示 provider |
| 本地处理 | SnowLeopard Vision 2.2 CLI、FFmpeg、Real-ESRGAN、Real-CUGAN、Anime4K、VapourSynth、RIFE |
| 运行环境 | Windows 10/11 x64、随包 Node.js v26.8.1 |

## 安装步骤

### 方式一：直接使用发布包（推荐）

1. 到 GitHub **Releases** 下载最新 Windows 整合包。
2. 解压到任意目录，路径可以包含中文和空格。
3. 双击 `启动画布.cmd`。
4. 浏览器会自动打开：

   ```text
   http://127.0.0.1:3020/zh/projects
   ```

5. 如果没有自动打开，手动访问上面的地址。

不需要安装任何依赖，也不需要管理员权限。

### 方式二：从源码构建

要求：Windows x64、Node.js 22+、pnpm 10+。

```powershell
git clone https://github.com/jinmuyu0820/xiaoyuer-canvas.git
cd xiaoyuer-canvas\source
pnpm install
pnpm typecheck
pnpm build
```

构建产物在 `source\.output`。把它复制到整合包根目录的 `.output`，再双击 `启动画布.cmd`：

```powershell
# 在整合包根目录执行
Remove-Item -Recurse -Force .output
Copy-Item -Recurse source\.output .output
```

> 源码不包含本地引擎；`SnowLeopard Vision\` 需要单独准备并放在整合包根目录。发布版界面名「小鱼儿画布整合包」通过 `VITE_APP_NAME` 注入，不设置时默认仍是 `BeatDesign`。

## 使用说明

1. 双击 `启动画布.cmd`，等待浏览器打开。
2. 新建项目 → 新建画布。
3. 在画布上添加「生成节点」，填写提示词；需要参考图/视频时连接对应素材节点。
4. 默认是「本地演示」模式，可以直接试流程。要接真实模型：
   - 右上角「设置」→ 选择视频/图片/文本模型
   - 填自己的 API Key、Endpoint、模型 ID
   - 关闭演示模式并保存
5. 本地超分/补帧：
   - 右键图片/视频节点 → 本地超分或补帧
   - 在节点齿轮里可以改参数、重试或新建节点
   - 第一次处理会多几秒做引擎预热
6. 结果会自动存成项目素材，并回到画布节点；原文件不改动。
7. 关闭黑色命令行窗口即停止画布。

### 数据与隐私

- 项目、配置、生成记录：`data\local.db`
- 导入素材和生成结果：`data\project-assets\`
- 加密配置密钥：`data\.workspace-key`（首次保存 Key 时生成）
- Release 包内 `data` 是空库，不包含项目、素材或 API Key
- 本仓库不包含 `data\`；你自己使用后 `data` 会包含项目和素材，**分享或重新打包前请换回空库**

### 系统要求

- Windows 10 / 11 x64
- 支持 Vulkan 的显卡（本地超分/补帧需要）
- 建议 8 GB 以上内存
- 解压后约 1.2 GB 磁盘空间

目前**只支持 Windows**，没有 macOS / Linux 版本。

## 项目结构

**仓库（Git）里是这样：**

```text
xiaoyuer-canvas/
├─ README.md                    # 本文件
├─ LICENSE                      # Apache License 2.0（继承上游 BeatDesign）
├─ NOTICE                       # 上游版权、修改说明与第三方归属
├─ 开源声明.md                   # 第三方项目、作者与许可证
├─ 启动画布.cmd                  # 整合包启动入口
├─ scripts/
│  └─ start-portable.mjs        # 便携启动脚本
└─ source/                      # 应用源码
   ├─ src/                      # 应用源码
   ├─ messages/                 # 中/英/日文案
   ├─ public/                   # 静态资源
   ├─ drizzle/                  # SQLite 迁移
   ├─ package.json
   ├─ vite.config.ts
   └─ tsconfig.json
```

**Release 整合包解压后是这样**（在仓库内容之外多了运行所需的二进制）：

```text
画布/
├─ 启动画布.cmd
├─ README.md
├─ LICENSE
├─ NOTICE
├─ 开源声明.md
├─ .output/                     # 构建后的应用（服务端 + 前端）
├─ runtime/
│  └─ node.exe                  # 随包 Node 运行时
├─ SnowLeopard Vision/          # 本地超分/补帧引擎子集
│  ├─ engine/
│  ├─ ffmpeg-stable/
│  └─ third_party/
├─ data/                        # 本地数据；Release 包为空库
│  ├─ local.db
│  ├─ project-assets/
│  ├─ asset-library/
│  ├─ director-scenes/
│  ├─ exports/
│  └─ upscale-jobs/
├─ scripts/
│  └─ start-portable.mjs
└─ source/                      # 可选源码，不影响运行
```

## 截图

> 截图待补。补图时不要截到 API Key、用户项目名或私有素材路径；建议放在 `docs/screenshots/`，并在本段用相对路径引用。

## 上游与致谢

本项目基于 [BeatDesign](https://github.com/BeatAPI/BeatDesign)（Apache-2.0）修改，本地超分/补帧调用 SnowLeopard Vision V2.2（作者：雪豹-Elysia）的无界面 CLI。

完整的第三方清单、许可证和作者信息见 [开源声明.md](开源声明.md) 与 [NOTICE](NOTICE)。

## License

本项目随包附带 **Apache License 2.0**（见 [LICENSE](LICENSE)），因为主体代码来自 BeatDesign。归属与修改说明见 [NOTICE](NOTICE)。

如果要给自己新增的代码另选许可证，请保留上游 BeatDesign 的 Apache-2.0 许可、版权与归属声明，并单独添加许可证文件；不要把上游代码直接改成别的许可证后删除原声明。

### 第三方组件

- **SnowLeopard Vision**：作者 雪豹-Elysia，第三方免费软件，可免费转载/分享，**请勿收费出售**；不是本项目开源的代码，随包仅作为本地处理引擎使用。
- **Node.js**：MIT，见 `runtime\README.txt`。
- **FFmpeg、Real-ESRGAN、Real-CUGAN、Anime4K、VapourSynth、RIFE**：分别遵循其自身许可证，详见 `开源声明.md` 和 `SnowLeopard Vision\THIRD_PARTY_NOTICES.md`。
