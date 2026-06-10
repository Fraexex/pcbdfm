/**
 * PCB DFM 工具 - 几何数据提取
 * 从 Gerber 解析结果提取可查询的几何信息用于 DFM 检查
 *
 * 由于纯浏览器环境下直接操作 flatten-js 与 tracespace 管线对接较复杂，
 * 本模块采用 SVG DOM 分析 + 简易几何计算的方式实现核心 DFM 检查。
 */

/**
 * 从 SVG 元素中提取几何形状信息
 * @param {SVGSVGElement} svgElement
 * @returns {{ shapes: Array, bounds: object }}
 */
export function extractGeometry(svgElement) {
  if (!svgElement) return { shapes: [], bounds: null }

  const shapes = []
  const viewBox = svgElement.getAttribute('viewBox')
  let bounds = null

  if (viewBox) {
    const [x, y, w, h] = viewBox.split(/[\s,]+/).map(Number)
    bounds = { x, y, width: w, height: h }
  }

  // 遍历所有图形元素
  const elements = svgElement.querySelectorAll('path, circle, rect, polygon, line, polyline')

  elements.forEach((el, idx) => {
    const shape = parseElement(el, idx)
    if (shape) shapes.push(shape)
  })

  return { shapes, bounds }
}

/**
 * 解析单个 SVG 元素为几何描述
 */
function parseElement(el, index) {
  const tag = el.tagName.toLowerCase()
  const transform = el.getAttribute('transform') || ''

  // 获取通用属性
  const stroke = el.getAttribute('stroke')
  const strokeWidth = parseFloat(el.getAttribute('stroke-width')) || 0
  const fill = el.getAttribute('fill')

  const base = {
    id: `shape_${index}`,
    type: tag,
    strokeWidth,
    hasStroke: stroke && stroke !== 'none',
    hasFill: fill && fill !== 'none',
    layer: el.closest('[data-layer]')?.getAttribute('data-layer') || null,
  }

  switch (tag) {
    case 'circle': {
      const cx = parseFloat(el.getAttribute('cx')) || 0
      const cy = parseFloat(el.getAttribute('cy')) || 0
      const r = parseFloat(el.getAttribute('r')) || 0
      return {
        ...base,
        cx, cy, r,
        diameter: r * 2,
        bbox: { x: cx - r, y: cy - r, width: r * 2, height: r * 2 },
      }
    }
    case 'rect': {
      const x = parseFloat(el.getAttribute('x')) || 0
      const y = parseFloat(el.getAttribute('y')) || 0
      const w = parseFloat(el.getAttribute('width')) || 0
      const h = parseFloat(el.getAttribute('height')) || 0
      return {
        ...base,
        x, y, w, h,
        bbox: { x, y, width: w, height: h },
      }
    }
    case 'line': {
      const x1 = parseFloat(el.getAttribute('x1')) || 0
      const y1 = parseFloat(el.getAttribute('y1')) || 0
      const x2 = parseFloat(el.getAttribute('x2')) || 0
      const y2 = parseFloat(el.getAttribute('y2')) || 0
      const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
      return {
        ...base,
        x1, y1, x2, y2,
        length,
        // 走线宽度 = stroke-width
        traceWidth: strokeWidth,
        bbox: {
          x: Math.min(x1, x2) - strokeWidth / 2,
          y: Math.min(y1, y2) - strokeWidth / 2,
          width: Math.abs(x2 - x1) + strokeWidth,
          height: Math.abs(y2 - y1) + strokeWidth,
        },
      }
    }
    case 'path': {
      const d = el.getAttribute('d') || ''
      return {
        ...base,
        d,
        traceWidth: strokeWidth,
        // 简化：从 path d 属性估算边界
        bbox: estimatePathBbox(d),
      }
    }
    case 'polygon':
    case 'polyline': {
      const points = el.getAttribute('points') || ''
      const pts = parsePoints(points)
      return {
        ...base,
        points: pts,
        traceWidth: strokeWidth,
        bbox: calculatePointsBbox(pts, strokeWidth),
      }
    }
    default:
      return null
  }
}

/**
 * 解析 points 属性
 */
function parsePoints(str) {
  return str.trim().split(/[\s,]+/).reduce((acc, val, i, arr) => {
    if (i % 2 === 0 && i + 1 < arr.length) {
      acc.push({ x: parseFloat(arr[i]), y: parseFloat(arr[i + 1]) })
    }
    return acc
  }, [])
}

/**
 * 估算 path 的边界框
 */
function estimatePathBbox(d) {
  const numbers = d.match(/[-+]?[0-9]*\.?[0-9]+/g)
  if (!numbers || numbers.length < 2) return { x: 0, y: 0, width: 0, height: 0 }

  const coords = numbers.map(Number)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (let i = 0; i < coords.length - 1; i += 2) {
    minX = Math.min(minX, coords[i])
    maxX = Math.max(maxX, coords[i])
    minY = Math.min(minY, coords[i + 1])
    maxY = Math.max(maxY, coords[i + 1])
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * 计算点集的边界框
 */
function calculatePointsBbox(points, strokeWidth = 0) {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }

  const pad = strokeWidth / 2
  return {
    x: minX - pad,
    y: minY - pad,
    width: (maxX - minX) + pad * 2,
    height: (maxY - minY) + pad * 2,
  }
}

/**
 * 从 Gerber 文本内容中直接提取钻孔信息
 * (比解析 SVG 更准确)
 * @param {string} gerberContent - Gerber/Excellon drill 文件内容
 * @returns {Array<{x: number, y: number, diameter: number}>}
 */
export function extractDrillHoles(gerberContent) {
  const holes = []
  const lines = gerberContent.split('\n')

  let currentTool = null
  const tools = {} // tool -> diameter

  // Excellon 格式解析
  for (const line of lines) {
    const trimmed = line.trim()

    // 工具定义 T01C0.60 (工具号=直径mm)
    const toolMatch = trimmed.match(/^T(\d+)C([\d.]+)/)
    if (toolMatch) {
      tools[`T${toolMatch[1]}`] = parseFloat(toolMatch[2])
      continue
    }

    // 选择工具
    const selectMatch = trimmed.match(/^(T\d+)/)
    if (selectMatch && !trimmed.includes('X') && !trimmed.includes('Y')) {
      currentTool = selectMatch[1]
      continue
    }

    // 钻孔坐标 X...Y...
    const coordMatch = trimmed.match(/X([-\d.]+)Y([-\d.]+)/)
    if (coordMatch && currentTool && tools[currentTool]) {
      holes.push({
        x: parseFloat(coordMatch[1]),
        y: parseFloat(coordMatch[2]),
        diameter: tools[currentTool],
        tool: currentTool,
      })
    }
  }

  return holes
}

/**
 * 从 Gerber 文本内容中提取走线信息
 * (通过解析 aperture 定义和 D01 draw 命令)
 * @param {string} gerberContent
 * @returns {Array<{startX, startY, endX, endY, width}>}
 */
export function extractTraces(gerberContent) {
  const traces = []
  const apertures = {} // aperture number -> { shape, width, height }

  let currentX = 0, currentY = 0
  let currentAperture = null
  let interpolation = 'linear' // linear, cw, ccw

  const lines = gerberContent.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Aperture 定义 %ADD10C,0.254*%
    const addMatch = trimmed.match(/%ADD(\d+)([CORS]{1}),?([\d.]+)(?:X([\d.]+))?\*%/)
    if (addMatch) {
      const shape = addMatch[2]
      const size1 = parseFloat(addMatch[3])
      const size2 = addMatch[4] ? parseFloat(addMatch[4]) : size1

      apertures[addMatch[1]] = {
        shape,
        width: shape === 'C' ? size1 : size1, // Circle: diameter, Rect: width
        height: size2,
      }
      continue
    }

    // 选择 aperture D10*
    const dCodeMatch = trimmed.match(/^D(\d+)\*$/)
    if (dCodeMatch && parseInt(dCodeMatch[1]) >= 10) {
      currentAperture = dCodeMatch[1]
      continue
    }

    // 插值模式
    if (trimmed.startsWith('G01') || trimmed.startsWith('G1')) interpolation = 'linear'
    if (trimmed.startsWith('G02') || trimmed.startsWith('G2')) interpolation = 'cw'
    if (trimmed.startsWith('G03') || trimmed.startsWith('G3')) interpolation = 'ccw'

    // 坐标命令 X...Y...D01* (draw) 或 X...Y...D02* (move) 或 D03* (flash)
    const cmdMatch = trimmed.match(/^(?:G0?[123]\*?)?X?([-\d.]+)?Y?([-\d.]+)?(?:I[^\*D]*)?(?:J[^\*D]*)?D?(0[123])\*$/)

    if (cmdMatch) {
      const x = cmdMatch[1] !== undefined ? parseFloat(cmdMatch[1]) : currentX
      const y = cmdMatch[2] !== undefined ? parseFloat(cmdMatch[2]) : currentY
      const dCode = cmdMatch[3]

      if (dCode === '01' && currentAperture && apertures[currentAperture]) {
        // D01 = draw (曝光移动) → 这是一条走线
        const width = apertures[currentAperture].width
        if (interpolation === 'linear') {
          traces.push({
            startX: currentX,
            startY: currentY,
            endX: x,
            endY: y,
            width,
          })
        }
      }

      currentX = x
      currentY = y
    }
  }

  return traces
}
