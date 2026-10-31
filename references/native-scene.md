# 本地原生对象格式

`scripts/native-rebuild.cjs` 是本地对象检查/执行入口。只接受 JSON，不接受图片、SVG、脚本字符串或 URL；它不会自动识别图片。助手观察参考图并按此格式编写场景。原生对象由 `native-runtime.jsx` 创建，`bridge.ps1` 只连接已经运行的 Illustrator。各层职责见 [architecture.md](architecture.md)。

## 场景

```json
{
  "version": 1,
  "document": "目标文档.ai",
  "layer": "Native_Rebuild_20261025_A",
  "canvas": {"width": 800, "height": 600},
  "origin": [0, 0],
  "scale": 1,
  "outputAi": "D:/project/reconstruction.ai",
  "outputPng": "D:/project/reconstruction.png",
  "gradients": [
    {"id": "leaf-light", "type": "linear", "stops": [
      {"offset": 0, "color": "#D5EBD3"},
      {"offset": 100, "color": "#407E43"}
    ]}
  ],
  "objects": [
    {"type": "group", "name": "leaf-01", "children": [
      {"type": "path", "name": "leaf-outline", "closed": true,
       "points": [
         {"anchor": [100, 100], "right": [150, 40]},
         {"anchor": [250, 100], "left": [200, 40], "right": [200, 160]},
         {"anchor": [100, 100], "left": [150, 160]}
       ],
       "fill": {"gradient": "leaf-light", "origin": [100, 100], "length": 150, "angle": 0},
       "stroke": "#407E43", "strokeWidth": 1},
      {"type": "text", "name": "leaf-label", "text": "Leaf 1",
       "position": [120, 190], "font": "ArialMT", "size": 14,
       "fill": "#000000", "align": "left", "rotation": 0}
    ]}
  ]
}
```

坐标是参考画布像素，写入时按 `scale` 转为点；`origin` 是距活动画板左上角的偏移（点）。源坐标 `[x,y]` 映射成 `[artboardLeft+originX+x*scale, artboardTop-originY-y*scale]`。不会修改画板尺寸，也不会自动避让已有图形。

`document` 必须等于已打开文档名称；如果知道路径，可传文档完整路径，桥接器按路径匹配。首次先运行 `--inspect` 获取。`outputAi`/`outputPng` 必须是本地绝对路径，扩展名分别是 `.ai`、`.png`，且不能互相相同。保存整个目标文档；要原位修改就填写该文档路径。输出路径存在且不是当前文档时停止，避免覆盖其他成果。

## 对象

共同字段：`type`、全局唯一 `name`。图形有 `fill`、`stroke`（默认均为 null）、`strokeWidth`（点按 scale 缩放）、`opacity`（0–100，默认100）。子项顺序由底到顶，运行时保持顺序。

- `group`：`children` 数组；重复元素分别建立 group。嵌套编组保留。
- `path`：`points` 至少2项；每项 `anchor` 必填，`left`/`right` 为绝对控制点，省略则等于 anchor；`smooth` 默认 false；`closed` 默认 false。闭合轮廓通常不重复首点，上面示例展示的是两段曲线接回原点，实际可用首点 left 和第二点 right 直接闭合。
- `compound`：`paths` 数组，每项是闭合 path，至少一个；共享填充描边。用反向环绕表达孔洞，`evenodd: true` 可显式选择奇偶填充。实际应用中必须检查孔洞。
- `ellipse` / `rect`：`box: [x,y,width,height]`，宽高为正。
- `text`：`text` 内容、`position` 为原文基线坐标；`font` 必须是 Illustrator 可用 PostScript 字体名称；`size` 正数；`align` 为 left/center/right；`rotation` 以 Illustrator 角度为准，默认0。支持换行，但基线/行距需实际对照修正。字号不自动缩放适配；字体缺失报错，不能静默替换或转曲。文字填充必须为纯色。

纯色可写 `#RRGGBB` 或 `{"cmyk":[C,M,Y,K]}`（0–100）。黑色箭头的所有路径使用同一个值。

渐变定义支持 `linear`/`radial`，至少两个且最多32个 stops；offset 0–100严格递增（需包括0和100），color为纯色，opacity 0–100默认100。图形 fill 使用 `{"gradient":"id","origin":[x,y],"length":正数,"angle":角度}`；length/原点沿用场景坐标，角度按 Illustrator 坐标。当前不实现 SVG 渐变矩阵、裁剪、滤镜、网格渐变或混合模式；这类要求需写本地专项 JSX，不能静默降级为色带/位图。

## 命令与状态

```powershell
node scripts/native-rebuild.cjs --scene scene.json --output-dir work
node scripts/native-rebuild.cjs --inspect --output-dir work
node scripts/native-rebuild.cjs --scene scene.json --output-dir work --apply
```

不加 `--apply` 只校验并保存 `prepared-scene.json`。`--inspect` 只读已打开文档；`--apply` 才创建对象。三条命令均在本地执行。命令失败不自动重试。图层已存在时停止，不删不重画。

完成产生 `native-report.json`（或 inspect 的 `inspect-report.json`）、AI和PNG。结构报告包含本任务 text/path/group/gradientFill/raster/placed 计数和视觉检查待办。不能将 `visualChecked:false` 解释为已验收。

目前附带桥接器只支持 Windows，要求 Illustrator 已运行且目标文档已打开。Node.js 18+，PowerShell 5.1+。JSON校验和准备可在其他系统运行。
