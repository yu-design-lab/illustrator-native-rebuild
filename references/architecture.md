# 原生矢量重建架构

本项目将参考图理解、结构化几何、原生对象写入和视觉精修分层组织。几何与样式通过 JSON 传递；桌面执行通过固定 PowerShell / JSX 桥接完成。

## 1. 视觉与语义层

宿主助手观察完整参考图与关键局部，记录文字基线、外轮廓、孔洞、连接、遮挡和元素数量，并将视觉元素转成可命名的编辑单元。辅助轮廓提取仅提供候选几何，助手需要区分真实细节与压缩噪声。

该层不由随附 Node.js 脚本实现；脚本不接受原始图片输入。视觉理解的运行环境取决于宿主助手。

## 2. 场景与几何层

`scene.json` 表达六类对象：`group`、`path`、`compound`、`ellipse`、`rect`、`text`。对象名称全局唯一，子项按由底到顶顺序排列。

- 曲线使用锚点与左右控制柄表达三次贝塞尔段；保形精修以关键端点、切线连续性与局部形态为依据。
- 孔洞通过复合路径和环绕方向或奇偶填充规则表达。
- 渐变由色标、透明度、原点、长度和角度定义，写入为原生 Gradient / GradientColor。
- 源坐标以参考图左上角为原点，写入时通过 `origin` 和 `scale` 映射到活动画板；不会修改画板尺寸。

字段与示例见 [native-scene.md](native-scene.md)。

## 3. 校验与调度层

`scripts/native-rebuild.cjs` 使用 Node.js 内置模块执行字段白名单校验、有限数值与几何检查、对象命名去重、渐变引用检查及本地绝对输出路径检查。

| 模式 | 行为 | 输出 |
| --- | --- | --- |
| `--scene` | 校验并序列化场景，不连接 Illustrator | `prepared-scene.json`、准备状态 |
| `--inspect` | 调用只读桌面检查 | `inspect-report.json` |
| `--scene … --apply` | 准备场景并执行原生写入 | 场景、`native-report.json`、AI、PNG |

不接收可执行脚本字段、图片节点、SVG 或 URL 输入。核心运行不依赖第三方 npm 包。

## 4. 桌面桥接层

`scripts/bridge.ps1` 使用 Windows PowerShell 5.1 和 .NET COM 互操作连接已运行的 Illustrator，通过 `DoJavaScript` 传入配置并加载固定 JSX。不会创建新 Illustrator 进程，也不负责窗口聚焦。桥接结果保存为 JSON；失败时向调用者返回错误。

桥接优先尝试通用 COM 标识，并提供版本 30 标识作为回退。实际可用性取决于本机 Illustrator 安装与 COM 注册情况，不据此宣称全部版本已经验证。

## 5. Illustrator 原生对象层

`scripts/native-runtime.jsx` 在 Illustrator ExtendScript 环境中执行，使用 Illustrator DOM 创建对象：

| 场景内容 | Illustrator 对象/API | 编辑能力 |
| --- | --- | --- |
| 曲线与基础图形 | PathItem、PathPoint | 锚点、控制柄、填充和描边 |
| 带孔轮廓 | CompoundPathItem | 子路径与填充规则 |
| 文字 | TextFrame、TextRange | 内容、字体、字号、基线和对齐 |
| 渐变 | Gradient、GradientColor、旋转矩阵 | 色标、透明度及空间映射 |
| 语义层级 | Layer、GroupItem、zOrder | 独立选取、分组与叠放顺序 |
| 保存与预览 | IllustratorSaveOptions、ExportOptionsPNG24 | PDF 兼容 AI、200% 画板 PNG |

执行前检查目标文档、活动状态、同名图层、输出冲突与字体。追加式写入发生错误后保留已生成对象，并通过 `partialLayer` 报告位置；不自动删除或重复执行。

## 6. 多尺度精修与验收层

从真实文档导出预览后，由助手制作同区域、同比例局部对照，在使用尺寸及 200%–400% 下检查轮廓、接缝、孔缘、渐变、箭头和文字。该流程不会从低分辨率参考图中恢复不存在的细节；放大用于判断和修整边缘。

修正应限定到已明确的对象或编组。当前 CLI 不提供局部替换命令；需要根据目标编组编写并验证本地 JSX，调整锚点、控制柄、样式或替换局部几何，再保存和导出。重复运行原始追加命令不构成精修。

`native-report.json` 记录执行状态、文件位置与对象计数；`visualChecked` 默认保持 `false`，提醒后续完成独立视觉检查。计数成功、文件生成与视觉验收是不同事实。

## 7. 验证范围

`node:test` 执行场景校验测试，并用 `node:vm` 中的 Illustrator 对象模拟器验证坐标映射、原生对象构造、文字基线、渐变矩阵、复合路径、叠放顺序及提前中止条件。

测试不证明真实字体排版、应用版本兼容性或最终视觉一致性；这些需要在目标 Illustrator 文档中实际导出验证。公开案例应同时提供整体预览、关键局部对照和明确的验证环境。
