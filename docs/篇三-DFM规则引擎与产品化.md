# DFM 规则引擎 + 产品化——9 项检查的实现与 AI 编程反思

> 这是「AI 实战：用 Claude 从零做 PCB DFM 工具」专栏的第三篇。拆解 9 项 DFM 检查规则的实现逻辑、违规定位与报告生成，最后分享 AI 编程的真实体感。

---

## 一、DFM 检查到底在查什么

DFM（Design for Manufacturing）的本质是：**在制造之前发现设计问题，避免返工。**

PCB 制造中最常见的问题有 9 类：

| # | 规则 | 默认阈值 | 出了问题会怎样 |
|---|------|---------|--------------|
| 1 | 最小线宽 | 外层 4mil / 内层 3mil | 线太细 → 生产断线 → 功能异常 |
| 2 | 线距/铜间距 | 6mil | 间距太小 → 短路或漏电 |
| 3 | 最小钻孔尺寸 | 6mil | 孔太小 → 钻头断裂 → 报废 |
| 4 | 焊盘环宽 | 5mil | 环太窄 → 焊接不良 → 虚焊 |
| 5 | 阻焊桥宽度 | 4mil | 桥太窄 → 焊锡桥接 → 短路 |
| 6 | 丝印上焊盘 | 不允许重叠 | 丝印盖焊盘 → 影响焊接质量 |
| 7 | 板框完整性 | 必须闭合 | 板框不闭合 → 无法铣外形 |
| 8 | 铜皮到板边距 | 10mil | 铜太靠边 → 铣板时露铜 |
| 9 | 缺失层检测 | 必须有铜层+板框 | 缺层 → 无法生产 |

这 9 项覆盖了 PCB 制造中 80% 以上的常见问题。选这些规则不是拍脑袋——是 Claude 根据行业规范梳理出来的，我做了验证和调整。

---

## 二、规则引擎实现

### 编排器：顺序执行，实时反馈

DFM 引擎的编排逻辑很简洁——9 条规则顺序执行，每条执行完更新进度：

```javascript
// js/dfm/engine.js
export async function runDfmAnalysis(context, onProgress) {
  const allViolations = []
  const ruleResults = []

  for (let i = 0; i < ALL_RULES.length; i++) {
    const rule = ALL_RULES[i]

    if (onProgress) {
      onProgress(i, ALL_RULES.length, rule.name)  // 更新 UI 进度
    }

    try {
      const violations = rule.fn(context)  // 执行规则
      ruleResults.push({
        id: rule.id,
        name: rule.name,
        status: violations.length > 0
          ? (violations.some(v => v.severity === 'error') ? 'fail' : 'warning')
          : 'pass',
        errorCount: violations.filter(v => v.severity === 'error').length,
        warningCount: violations.filter(v => v.severity === 'warning').length,
      })
      allViolations.push(...violations)
    } catch (err) {
      console.error(`DFM 规则 ${rule.name} 执行出错:`, err)
      ruleResults.push({ id: rule.id, name: rule.name, status: 'error' })
    }

    // 让 UI 有机会更新（避免阻塞主线程）
    await new Promise(r => setTimeout(r, 10))
  }

  return { violations: allViolations, summary: buildSummary(ruleResults, allViolations) }
}
```

注意 `await new Promise(r => setTimeout(r, 10))` ——这个小技巧让每条规则执行后 UI 有机会刷新进度条，用户不会看到页面"卡死"。

### 规则注册表

所有规则注册在一个数组里，新增规则只需要写函数 + 注册：

```javascript
// js/dfm/rules.js
export const ALL_RULES = [
  { id: 'missing-layers',    name: '缺失层检测',   fn: checkMissingLayers },
  { id: 'board-outline',     name: '板框完整性',   fn: checkBoardOutline },
  { id: 'trace-width',       name: '最小线宽',     fn: checkTraceWidth },
  { id: 'drill-hole-size',   name: '最小钻孔尺寸', fn: checkDrillHoleSize },
  { id: 'trace-clearance',   name: '线距/铜间距',  fn: checkTraceClearance },
  { id: 'annular-ring',      name: '焊盘环宽',     fn: checkAnnularRing },
  { id: 'soldermask-web',    name: '阻焊桥宽度',   fn: checkSoldermaskWeb },
  { id: 'silkscreen-on-pad', name: '丝印上焊盘',   fn: checkSilkscreenOnPad },
  { id: 'copper-to-edge',    name: '铜皮到板边距', fn: checkCopperToEdge },
]
```

### 具体规则：最小线宽检查

以"最小线宽检查"为例，看一条规则的具体实现：

```javascript
// js/dfm/rules.js
export function checkTraceWidth(ctx) {
  const violations = []
  const threshold = ctx.settings.traceWidth || 4  // mil
  const thresholdMm = milToMm(threshold)

  for (const layer of ctx.layers) {
    const layerId = layer.layerType?.id
    if (!['tcu', 'bcu', 'icu1', 'icu2'].includes(layerId)) continue  // 只检查铜层
    if (!layer.content) continue

    const traces = extractTracesFromContent(layer.content)  // 从 Gerber 提取走线数据
    const isOuter = ['tcu', 'bcu'].includes(layerId)
    const effectiveThreshold = isOuter ? threshold : (ctx.settings.traceWidthInner || 3)
    const effectiveThresholdMm = milToMm(effectiveThreshold)

    for (const trace of traces) {
      if (trace.width > 0 && trace.width < effectiveThresholdMm) {
        violations.push({
          id: nextId(),
          ruleId: 'trace-width',
          ruleName: '最小线宽',
          severity: SEVERITY.ERROR,
          message: `${isOuter ? '外层' : '内层'}走线宽度 ${mmToMil(trace.width).toFixed(1)} mil 小于最小要求 ${effectiveThreshold} mil`,
          location: { x: (trace.startX + trace.endX) / 2, y: (trace.startY + trace.endY) / 2 },
          suggestion: `建议将走线宽度增加到至少 ${effectiveThreshold} mil`,
          layerId,
        })
      }
    }
  }
  return violations
}
```

几个设计要点：

1. **内外层分开检查**：外层（顶层铜/底层铜）和内层铜的线宽要求不同，因为制造工艺不同
2. **位置信息**：每条违规都记录了中心坐标（`location`），用于后续在 SVG 上定位标记
3. **改进建议**：不只报错，还给出具体的修改建议
4. **单位转换**：内部计算用 mm，展示用 mil（PCB 行业的习惯单位）

### 具体规则：线距检查

线距检查是最复杂的规则之一，因为需要计算**两条线段之间的最短距离**：

```javascript
// js/dfm/rules.js
export function checkTraceClearance(ctx) {
  const violations = []
  const threshold = ctx.settings.traceClearance || 6  // mil
  const thresholdMm = milToMm(threshold)

  for (const layer of ctx.layers) {
    const layerId = layer.layerType?.id
    if (!['tcu', 'bcu'].includes(layerId)) continue
    if (!layer.content) continue

    const traces = extractTracesFromContent(layer.content)
    const maxChecks = Math.min(traces.length, 500)  // 限制检查数量，防止性能问题

    for (let i = 0; i < maxChecks; i++) {
      for (let j = i + 1; j < maxChecks; j++) {
        const dist = segmentDistance(traces[i], traces[j])
        if (dist > 0 && dist < thresholdMm) {
          violations.push({
            id: nextId(),
            ruleId: 'trace-clearance',
            ruleName: '线距/铜间距',
            severity: SEVERITY.WARNING,
            message: `铜间距 ${mmToMil(dist).toFixed(1)} mil 小于最小要求 ${threshold} mil`,
            location: midpoint(traces[i], traces[j]),
            suggestion: `建议增加走线间距到至少 ${threshold} mil`,
            layerId,
          })
        }
      }
    }
  }
  return violations
}
```

线段距离的计算用点到线段投影的方法：

```javascript
function segmentDistance(a, b) {
  const d1 = pointToSegmentDistance(
    (a.startX + a.endX) / 2, (a.startY + a.endY) / 2, b
  )
  const d2 = pointToSegmentDistance(
    (b.startX + b.endX) / 2, (b.startY + b.endY) / 2, a
  )
  return Math.min(d1, d2) - (a.width + b.width) / 2  // 减去线宽
}

function pointToSegmentDistance(px, py, seg) {
  const dx = seg.endX - seg.startX
  const dy = seg.endY - seg.startY
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((px - seg.startX) ** 2 + (py - seg.startY) ** 2)
  let t = ((px - seg.startX) * dx + (py - seg.startY) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))  // 限制投影在线段上
  const projX = seg.startX + t * dx
  const projY = seg.startY + t * dy
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
}
```

注意 `maxChecks = Math.min(traces.length, 500)` —— 这是一个务实的性能折中。大型 PCB 可能有几千条走线，O(n²) 全量检查不现实。限制 500 条，覆盖最关键的检查，同时保证分析速度在可接受范围内。

### 厂商预设

不同 PCB 厂家的制造能力不同，同样的设计在不同厂家可能有不同的 DFM 结论。工具内置了三套预设：

```javascript
// js/utils/constants.js
export const MANUFACTURER_PRESETS = {
  '默认': {
    traceWidth: 4, traceWidthInner: 3, traceClearance: 6,
    drillHoleSize: 6, annularRing: 5, soldermaskWeb: 4, copperToEdge: 10,
  },
  '某制造企业A': {
    traceWidth: 5, traceWidthInner: 4, traceClearance: 6,
    drillHoleSize: 8, annularRing: 6, soldermaskWeb: 5, copperToEdge: 10,
  },
  '某制造企业B': {
    traceWidth: 4, traceWidthInner: 3.5, traceClearance: 5,
    drillHoleSize: 6, annularRing: 5, soldermaskWeb: 4, copperToEdge: 8,
  },
}
```

用户选择不同的厂商标准，所有阈值自动更新，重新跑分析即可。当然也可以手动微调任意参数。

---

## 三、交互式查看与报告生成

### 违规定位

分析完成后，违规会在 SVG 上用红色/黄色标记高亮显示。用户在违规列表中点击某一条，SVG 视图会自动平移并放大到该违规位置：

```
违规列表点击 → 获取违规坐标 → viewer.panTo(x, y) + viewer.zoomIn() → 标记闪烁高亮
```

这种"列表 + 可视化"的双向联动，让工程师能快速定位问题，不用对着坐标手动找。

### PDF 报告生成

报告生成完全在浏览器端完成，用的是 PDFMake 库。生成的 PDF 包含：

- **封面**：项目名称、分析日期、板子概要
- **板子概要**：层数、尺寸、文件数量、图形数量
- **PCB 层渲染图**：各层的 SVG 截图
- **DFM 检查结果汇总表**：9 项规则的通过/失败/警告状态
- **违规详情**：每条违规的位置、类型、严重性、改进建议
- **规则阈值附录**：本次分析使用的所有阈值参数

整个报告生成不到 1 秒。

### 测量工具

工具还内置了一个交互式测距功能——点击两个点，自动计算距离，支持 mil/mm/inch 三种单位切换。方便工程师在不打开专业软件的情况下快速测量。

---

## 四、AI 编程的真实体验

做了这个项目，我对 AI 编程有了非常具体的体感。

### ✅ Claude 擅长的

**1. 解析器和算法实现**

Gerber 解析器、Excellon 解析器、R-tree 空间索引、线段距离计算——这些本质上是"规则明确、逻辑清晰"的编程任务。给定格式规范，Claude 能写出正确的解析逻辑，包括边界处理和异常情况。

**2. 模块化架构**

Claude 天然倾向于模块化设计——parser、renderer、engine、rules 各自独立，通过清晰的数据结构交互。这种架构让代码易于理解和扩展。

**3. 工具链整合**

SVG 渲染、PDF 生成、ZIP 解压——Claude 对主流浏览器 API 和第三方库的使用非常熟练，能快速拼装出完整的功能链路。

**4. 边界情况处理**

坐标格式自动检测、不同 EDA 软件的文件名兼容、性能限制（maxChecks）——这些细节 Claude 都能主动考虑到。

### ⚠️ 需要人把关的

**1. 行业知识验证**

DFM 的阈值参数（线宽 4mil、间距 6mil 等）是行业经验值，Claude 给出了合理的默认值，但具体数值需要对照厂家规范验证。不同厂家、不同工艺的参数差异很大。

**2. 精度验证**

坐标轴方向（Gerber 的 Y 轴方向）、单位转换精度、测量工具的准确性——这些硬件领域特有的细节，Claude 可能搞错，需要用实际文件测试验证。

**3. 性能瓶颈**

对于大型 PCB（几千个图形元素），当前的线性扫描空间索引和 O(n²) 距离检查会有性能问题。需要引入 Web Worker 做异步计算，或者升级为真正的 R-tree 结构。

### 💡 给想试 AI 编程的人的建议

**1. 需求拆解能力比编程能力更重要**

这个项目能成功，不是因为我编程多强，而是因为我能清楚地把需求拆成"解析器 → 渲染器 → 检查引擎 → UI → 报告"这样的模块。Claude 负责实现，你负责架构。

**2. 把 AI 当"超强执行者"，你是"架构师 + 产品经理"**

不要指望 AI 替你思考"该做什么"。你应该清楚目标是什么、优先级怎么排、验收标准是什么。AI 负责高效执行。

**3. 工具型项目最适合 AI 辅助**

解析器、检查器、转换器、报告生成器——这类需求明确、逻辑可验证的工具型项目，是 AI 编程的最佳场景。如果你的需求是"做一个社交 App"，复杂度会高得多。

**4. 用真实数据测试**

不要光看代码觉得对了。用真实的 Gerber 文件测试，看解析结果是否正确、DFM 检查是否合理、报告是否完整。真实数据会暴露所有边界问题。

---

## 五、这个项目还在迭代

目前工具已经可以正常使用，但还有几个方向在推进：

- **Web Worker 异步计算**：大文件不阻塞 UI
- **更多 DFM 规则**：短路检测、SMD 间距、网格铜检查
- **PDF 中文字体**：目前 PDF 报告的中文显示需要额外处理
- **Gerber X3 支持**：新版 Gerber 格式（带属性信息）

---

## 专栏总结

三篇文章，完整记录了从"一个想法"到"一个可用工具"的全过程：

1. **篇一**：从痛点出发，展示工具全貌和最终成果
2. **篇二**：深入 Gerber 解析器、层识别、SVG 渲染、空间索引的硬核实现
3. **篇三**：拆解 DFM 规则引擎、违规定位、报告生成，以及 AI 编程的真实体感

**关键结论：AI 编程不是魔法，也不是噱头。它是一个"超强执行者"，适合需求明确、逻辑可验证的工具型项目。门槛不在编程能力，在于你是否能把需求拆解清楚。**

**专栏导航：**
- ⬅️ 篇一：从痛点到原型
- ⬅️ 篇二：Claude 手搓 Gerber 解析器——纯 JS 零依赖的硬核实现
- 👈 篇三：DFM 规则引擎 + 产品化——9 项检查的实现与 AI 编程反思（本文）

---

*如果这个专栏对你有启发，欢迎点赞收藏。你工作中有什么重复性工具想用 AI 做？评论区聊聊👇*
