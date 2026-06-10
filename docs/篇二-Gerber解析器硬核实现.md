# Claude 手搓 Gerber 解析器——纯 JS 零依赖的硬核实现

> 这是「AI 实战：用 Claude 从零做 PCB DFM 工具」专栏的第二篇。深入拆解最硬核的部分——纯 JavaScript 实现 Gerber RS-274X 解析、层类型自动识别、SVG 渲染和空间索引。

---

## 一、Gerber 格式到底有多复杂

先看一段真实的 Gerber 文件长什么样：

```gerber
%FSLAX25Y25*%
%MOIN*%
%ADD10C,0.0060*%
%ADD11R,0.0240X0.0240*%
G04 Layer: Top Copper*
G01*
X500000Y300000D02*
X700000Y300000D01*
X700000Y500000D01*
X500000Y500000D01*
X500000Y300000D01*
X650000Y400000D03*
M02*
```

这几行指令描述了一个简单的矩形走线加一个焊盘。但真实的 PCB 文件动辄几千行，包含各种复杂的指令。

Gerber RS-274X 的核心概念：

| 概念 | 含义 | 示例指令 |
|------|------|---------|
| **光圈(Aperture)** | "画笔"的大小和形状 | `%ADD10C,0.0060*%` = 10号圆形光圈，直径 6mil |
| **画线(D01)** | 从当前位置画线到目标位置 | `X700000Y300000D01*` |
| **移动(D02)** | 移动画笔但不画线 | `X500000Y300000D02*` |
| **闪点(D03)** | 在当前位置放置焊盘 | `X650000Y400000D03*` |
| **区域填充(Region)** | 填充封闭多边形区域 | `G36*...G37*` |
| **极性(Polarity)** | 正片(dark)或负片(clear) | `%LPD*%` / `%LPC*%` |

这还只是冰山一角。Gerber 格式还有坐标格式声明（2.4 / 2.5 / 3.3）、单位设置（mm / inch）、插补模式（直线/顺圆弧/逆圆弧）等等。

**所以不能简单地"读文本"——需要写一个状态机解析器。**

---

## 二、解析器实现

### 解析器架构

我让 Claude 设计了一个逐行扫描 + 状态机的解析器。核心结构非常清晰：

```javascript
// js/gerber/parser.js
export function parseGerber(content, filename = 'unknown') {
  const result = {
    filename,
    units: 'mm',           // 默认 mm
    format: null,           // { xInt, xDec, yInt, yDec }
    shapes: [],             // 所有图形元素
    apertures: {},          // 光圈定义
    bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    errors: [],
  }

  const lines = content.split(/\r?\n/)
  let currentX = 0, currentY = 0
  let currentAperture = null
  let interpolation = 'linear'   // linear | cw | ccw
  let regionMode = false
  let regionPoints = []
  let polarity = 'dark'          // dark | clear

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('G04')) continue  // 跳过空行和注释

    // ... 逐行解析各种指令
  }

  return result
}
```

### 光圈定义解析

光圈是 Gerber 的"画笔"，定义了线条的粗细和形状：

```javascript
// 解析 %ADDnnC,size*% 或 %ADDnnR,sizeXsize*%
const addMatch = line.match(/%ADD(\d+)([CORS])(?:,([\d.]+)(?:X([\d.]+))?)?\*%/i)
if (addMatch) {
  const code = addMatch[1]
  const shape = addMatch[2].toUpperCase()  // C=圆形, R=矩形, O=椭圆
  const size1 = parseFloat(addMatch[3]) || 0
  const size2 = addMatch[4] ? parseFloat(addMatch[4]) : size1
  result.apertures[code] = { shape, width: size1, height: size2 }
  continue
}
```

C=Circle（圆形）、R=Rectangle（矩形）、O=Oblong（椭圆）、S=Special——这四种光圈覆盖了绝大多数 PCB 设计。

### D01/D02/D03 画线指令

这是 Gerber 的核心绘图指令，解析逻辑最关键的部分：

```javascript
if (dCode === 'D02') {
  // D02 = 移动（抬笔，不画线）
  if (regionMode) regionPoints.push({ x: currentX, y: currentY })

} else if (dCode === 'D01') {
  // D01 = 画线（落笔，从上一位置到当前位置）
  if (regionMode) {
    regionPoints.push({ x: currentX, y: currentY })
  } else {
    const ap = result.apertures[currentAperture]
    const shape = {
      type: 'line',
      startX: prevX, startY: prevY,
      endX: currentX, endY: currentY,
      width: ap ? ap.width : 0,    // 线宽取决于当前光圈
      aperture: currentAperture,
      polarity, interpolation,
    }
    result.shapes.push(shape)
    updateBounds(result.bounds, shape)
  }

} else if (dCode === 'D03') {
  // D03 = 闪点（放置焊盘）
  const ap = result.apertures[currentAperture]
  if (ap) {
    const shape = {
      type: 'flash',
      x: currentX, y: currentY,
      aperture: currentAperture,
      apertureShape: ap.shape,
      width: ap.width, height: ap.height,
      polarity,
    }
    result.shapes.push(shape)
    updateBounds(result.bounds, shape)
  }
}
```

三个指令，三种图形元素——line（走线）、flash（焊盘）、region points（区域填充）。

### 坐标解析的坑

Gerber 坐标不是普通的浮点数。它的格式由 `%FSLAX25Y25*%` 这样的声明决定，X25 表示 "2位整数+5位小数"。

但很多 Gerber 文件**不声明格式**，需要自动检测：

```javascript
function parseCoord(str, format) {
  if (!str) return 0
  const num = parseInt(str, 10)
  if (isNaN(num)) return 0

  if (format) {
    const divisor = Math.pow(10, format.xDec || 4)
    return num / divisor
  }

  // 自动检测：根据数字长度估算格式
  const len = str.replace(/^-/, '').length
  if (len === 6) return num / 10000   // 2.4 格式
  if (len === 7) return num / 100000  // 2.5 或 3.4 格式
  if (len === 5) return num / 1000    // 2.3 格式
  if (len === 8) return num / 1000000 // 3.5 格式
  return num / 10000                  // 默认 2.4
}
```

这个自动检测逻辑是 Claude 在测试中遇到格式缺失问题时加上的——实际 Gerber 文件的"野路子"写法比规范多得多。

### Excellon 钻孔文件解析

除了 Gerber，PCB 还有钻孔文件（Excellon 格式），语法完全不同：

```gerber
M48
T1C0.012
T2C0.016
T3C0.040
%
T01
X5000Y4000
X5500Y4000
X6000Y4000
T02
X7000Y4000
X7500Y4000
M30
```

Claude 用类似的逐行扫描方式实现了 Excellon 解析器，提取出每个钻孔的位置和直径。两个解析器共享同一个输出数据结构，方便后续统一处理。

---

## 三、层类型自动识别

PCB 一个板子有十几个文件——顶层铜、底层铜、阻焊、丝印、钻孔……上传后第一步就是识别每个文件是什么层。

Claude 设计了一个**两级匹配策略**：

```javascript
// js/gerber/layer-id.js
function manualIdentify(filename) {
  const name = filename.toLowerCase()
  const ext = name.split('.').pop()

  // 第一级：扩展名精确映射（置信度 0.9）
  const extMap = {
    'gtl': LAYER_TYPES.TOP_COPPER,
    'gbl': LAYER_TYPES.BOTTOM_COPPER,
    'gts': LAYER_TYPES.TOP_SOLDERMASK,
    'gbs': LAYER_TYPES.BOTTOM_SOLDERMASK,
    'gko': LAYER_TYPES.OUTLINE,
    'xnc': LAYER_TYPES.DRILL,
    // ... 更多映射
  }
  if (extMap[ext]) {
    return { layerType: extMap[ext], confidence: 0.9 }
  }

  // 第二级：文件名关键字正则匹配（置信度 0.7）
  const patterns = [
    { regex: /\.gtl$/i,             type: LAYER_TYPES.TOP_COPPER },
    { regex: /[-_]f[_.]cu|[-_]top[_.]copper/i, type: LAYER_TYPES.TOP_COPPER },
    { regex: /\.cmp$/i,             type: LAYER_TYPES.TOP_COPPER },   // Eagle
    { regex: /top.*cop|cop.*top|front.*cop/i, type: LAYER_TYPES.TOP_COPPER },
    // ... 30+ 条正则，覆盖 Altium / KiCad / Eagle 命名约定
  ]

  for (const p of patterns) {
    if (p.regex.test(name)) {
      return { layerType: p.type, confidence: 0.7 }
    }
  }

  return { layerType: null, confidence: 0 }
}
```

扩展名精确匹配优先，匹配不上再用正则模糊匹配。30 多条正则覆盖了主流 EDA 工具（Altium Designer、KiCad、Eagle）的各种命名约定。

实际测试下来，常见的 Gerber 文件包识别率接近 100%。

---

## 四、SVG 渲染与空间索引

### 解析结果 → SVG

解析器输出的 shapes 数组（line / flash / region），需要映射成 SVG 路径：

- `line`（走线）→ `<line>` 或 `<path>` 元素，stroke-width 设为光圈宽度
- `flash`（焊盘）→ `<circle>` 或 `<rect>` 元素
- `region`（填充区）→ `<path d="M...L...Z">` 封闭路径

每层 PCB 渲染成一个独立的 SVG `<g>` 元素，通过 opacity 和 visibility 控制层的显示/隐藏，用户可以逐层查看或叠加查看。

### R-tree 空间索引

DFM 检查需要频繁查询"某个位置附近有哪些图形元素"。如果每次都遍历所有元素，O(n²) 的复杂度会让检查变得非常慢。

Claude 实现了一个简化版的 R-tree 空间索引：

```javascript
// js/dfm/spatial-index.js
export class SpatialIndex {
  constructor() {
    this.items = []
  }

  insert(bbox, data) {
    this.items.push({ bbox, data })
  }

  search(bbox) {
    return this.items.filter(item => this._intersects(item.bbox, bbox))
  }

  searchRadius(x, y, radius) {
    const bbox = {
      minX: x - radius, minY: y - radius,
      maxX: x + radius, maxY: y + radius,
    }
    return this.search(bbox).filter(item => {
      const ix = (item.bbox.minX + item.bbox.maxX) / 2
      const iy = (item.bbox.minY + item.bbox.maxY) / 2
      return Math.sqrt((ix - x) ** 2 + (iy - y) ** 2) <= radius
    })
  }

  _intersects(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
           a.minY <= b.maxY && a.maxY >= b.minY
  }
}
```

虽然内部实现是线性扫描（没有真正的树结构），但对于中小型 PCB（几百到几千个元素）来说已经足够。先通过 bbox 快速过滤，再做精确的距离计算。

### 性能实测

用一个 12 层、1198 个图形元素的测试 PCB：

| 操作 | 耗时 |
|------|------|
| Gerber 解析（12 个文件） | < 100ms |
| SVG 渲染 | < 200ms |
| DFM 分析（9 项规则） | < 500ms |
| PDF 报告生成 | < 1s |

全部操作加起来不到 2 秒，纯浏览器端完成。

---

## 五、这一步的 AI 协作体会

**Claude 在解析器实现上表现出了极强的能力。**

Gerber RS-274X 格式虽然复杂，但本质上是规则明确的文本协议——给定一个指令，输出对应的数据结构。这正是 AI 擅长的领域：理解规则、映射逻辑、处理边界情况。

几个让我印象深刻的点：

1. **自动检测坐标格式**：我给了一个没有格式声明的 Gerber 文件，Claude 主动加了自动检测逻辑，根据数字长度推断格式
2. **多 EDA 兼容**：我提了一嘴"要兼容不同软件的命名"，Claude 直接覆盖了 Altium / KiCad / Eagle 三家的命名约定
3. **空间索引**：我没有明确要求，Claude 在实现 DFM 检查时主动引入了 R-tree 来加速碰撞检测

但也有需要人工介入的地方——比如坐标轴方向、单位转换的精度问题，这些 PCB 行业特有的细节需要人来验证。

**下一篇预告：** 9 项 DFM 检查规则是怎么实现的？违规定位、PDF 报告生成的逻辑是什么？以及作为一个产品经理，我对 AI 编程的真实体感。

**专栏导航：**
- ⬅️ 篇一：从痛点到原型
- 👈 篇二：Claude 手搓 Gerber 解析器——纯 JS 零依赖的硬核实现（本文）
- ➡️ 篇三：DFM 规则引擎 + 产品化——9 项检查的实现与 AI 编程反思

---

*如果你觉得这篇技术拆解有价值，欢迎点赞收藏。对 Gerber 解析有什么疑问，评论区交流👇*
