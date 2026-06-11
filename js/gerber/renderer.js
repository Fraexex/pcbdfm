/**
 * PCB DFM 工具 - 纯 JS SVG 渲染器
 * 将解析后的 Gerber 数据渲染为交互式 SVG
 * 零外部依赖
 */

import { LAYER_COLORS_SVG } from '../utils/constants.js'

const NS = 'http://www.w3.org/2000/svg'

/**
 * 将所有已解析层渲染为 SVG
 * @param {Array} layers - 已解析的层列表
 * @param {HTMLElement} container - SVG 容器 DOM 元素
 * @returns {object} 渲染信息 { width, height, viewBox }
 */
export function renderLayers(layers, container) {
  if (!layers.length) return null

  // 计算合并边界
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

  for (const layer of layers) {
    if (!layer.parsed) continue
    const b = layer.parsed.bounds
    if (b && isFinite(b.minX)) {
      bounds.minX = Math.min(bounds.minX, b.minX)
      bounds.minY = Math.min(bounds.minY, b.minY)
      bounds.maxX = Math.max(bounds.maxX, b.maxX)
      bounds.maxY = Math.max(bounds.maxY, b.maxY)
    }
  }

  if (!isFinite(bounds.minX)) {
    bounds.minX = 0; bounds.minY = 0; bounds.maxX = 100; bounds.maxY = 100
  }

  // 添加 padding
  const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.05
  const vbX = bounds.minX - pad
  const vbY = bounds.minY - pad
  const vbW = (bounds.maxX - bounds.minX) + pad * 2
  const vbH = (bounds.maxY - bounds.minY) + pad * 2

  // 创建主 SVG
  const svg = createEl('svg', {
    xmlns: NS,
    viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
    width: '100%',
    height: '100%',
    preserveAspectRatio: 'xMidYMid meet',
  })

  // 背景
  svg.appendChild(createEl('rect', {
    x: vbX, y: vbY, width: vbW, height: vbH,
    fill: '#0f1117',
  }))

  // 翻转组（Y 翻转使 Gerber 坐标朝上，X 不动）
  const cy = bounds.minY + bounds.maxY
  const flipGroup = createEl('g', {
    transform: `translate(0, ${cy}) scale(1, -1)`,
  })

  // 渲染顺序 (底层先画)
  const layerOrder = ['out', 'tsm', 'bsm', 'icu2', 'icu1', 'bcu', 'tcu', 'drl', 'tsp', 'bsp', 'tss', 'bss']

  for (const layerId of layerOrder) {
    const layer = layers.find(l => l.layerType?.id === layerId)
    if (!layer || !layer.parsed) continue

    const color = LAYER_COLORS_SVG[layerId]
    if (!color) continue

    const group = createEl('g', {
      'data-layer': layerId,
      class: `pcb-layer layer-${layerId}`,
      opacity: color.opacity,
    })

    if (layer.isDrill) {
      renderDrillLayer(layer, group, color)
    } else {
      renderGerberLayer(layer, group, color)
    }

    flipGroup.appendChild(group)
  }

  // 违规标记层（空，后续填充）— 也在翻转组内
  flipGroup.appendChild(createEl('g', {
    'data-layer': 'violations',
    class: 'pcb-layer violation-markers',
  }))

  svg.appendChild(flipGroup)

  container.innerHTML = ''
  container.appendChild(svg)

  return { x: vbX, y: vbY, width: vbW, height: vbH }
}

/**
 * 渲染 Gerber 层
 */
function renderGerberLayer(layer, group, color) {
  const { shapes, apertures } = layer.parsed

  for (const shape of shapes) {
    if (shape.polarity === 'clear') continue // 简化：跳过 clear 极性

    const ap = apertures[shape.aperture]
    const fillRule = shape.polarity === 'clear' ? 'evenodd' : 'nonzero'

    switch (shape.type) {
      case 'line': {
        const w = shape.width || (ap ? ap.width : 0.1)
        const line = createEl('line', {
          x1: shape.startX ?? shape.endX,
          y1: shape.startY ?? shape.endY,
          x2: shape.endX,
          y2: shape.endY,
          stroke: color.fill,
          'stroke-width': w,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          fill: 'none',
        })
        group.appendChild(line)
        break
      }

      case 'flash': {
        const w = shape.width || (ap ? ap.width : 0.5)
        const h = shape.height || (ap ? ap.height : 0.5)
        const apShape = shape.apertureShape || (ap ? ap.shape : 'C')

        if (apShape === 'C') {
          // 圆形焊盘
          group.appendChild(createEl('circle', {
            cx: shape.x,
            cy: shape.y,
            r: w / 2,
            fill: color.fill,
          }))
        } else if (apShape === 'R') {
          // 矩形焊盘
          group.appendChild(createEl('rect', {
            x: shape.x - w / 2,
            y: shape.y - h / 2,
            width: w,
            height: h,
            fill: color.fill,
          }))
        } else if (apShape === 'O') {
          // 椭圆焊盘
          group.appendChild(createEl('ellipse', {
            cx: shape.x,
            cy: shape.y,
            rx: w / 2,
            ry: h / 2,
            fill: color.fill,
          }))
        }
        break
      }

      case 'polygon': {
        if (!shape.points || shape.points.length < 3) break
        const d = shape.points.map((p, i) =>
          `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`
        ).join(' ') + ' Z'

        group.appendChild(createEl('path', {
          d,
          fill: color.fill,
          'fill-rule': fillRule,
          stroke: 'none',
        }))
        break
      }

      case 'arc': {
        // SVG 弧线路径: M startX,startY A rx,ry rotation large-arc-flag sweep-flag endX,endY
        const w = shape.width || (ap ? ap.width : 0.1)
        const { cx, cy, radius } = computeSvgArcParams(
          shape.startX, shape.startY, shape.endX, shape.endY,
          shape.offsetI, shape.offsetJ
        )

        // 全圆弧检测（起点=终点）：SVG A 命令无法渲染零长度弧，改用 circle
        const dx = shape.endX - shape.startX
        const dy = shape.endY - shape.startY
        const isFullCircle = Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001

        if (isFullCircle) {
          // 全圆：直接渲染为 SVG circle
          group.appendChild(createEl('circle', {
            cx, cy,
            r: radius,
            stroke: color.fill,
            'stroke-width': w,
            fill: 'none',
          }))
        } else {
          // 正常弧线
          const dist = Math.sqrt(dx * dx + dy * dy)

          // 计算弧段扫过角度是否 > 180°
          const startAngle = Math.atan2(shape.startY - cy, shape.startX - cx)
          const endAngle = Math.atan2(shape.endY - cy, shape.endX - cx)
          let sweep = endAngle - startAngle
          if (!shape.clockwise) { // CCW
            while (sweep < 0) sweep += 2 * Math.PI
          } else { // CW
            while (sweep > 0) sweep -= 2 * Math.PI
          }
          const isLargeArc = Math.abs(sweep) > Math.PI

          // sweep-flag: 在 Y 翻转组内，Gerber CCW → SVG sweep=1，CW → sweep=0
          const sweepFlag = shape.clockwise ? 0 : 1

          const d = `M${shape.startX},${shape.startY} A${radius},${radius} 0 ${isLargeArc ? 1 : 0},${sweepFlag} ${shape.endX},${shape.endY}`

          group.appendChild(createEl('path', {
            d,
            stroke: color.fill,
            'stroke-width': w,
            'stroke-linecap': 'round',
            fill: 'none',
          }))
        }
        break
      }
    }
  }
}

/**
 * 渲染钻孔层
 */
function renderDrillLayer(layer, group, color) {
  const { holes } = layer.parsed

  for (const hole of holes) {
    const r = hole.diameter / 2

    // 钻孔用圆形表示
    group.appendChild(createEl('circle', {
      cx: hole.x,
      cy: hole.y,
      r: Math.max(r, 0.01),
      fill: '#0f1117',  // 钻孔是透明的
      stroke: color.fill,
      'stroke-width': 0.05,
    }))
  }
}

/**
 * 创建 SVG 元素
 */
function createEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag)
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, val)
  }
  return el
}

/**
 * 计算圆弧几何参数（用于 SVG Arc 路径）
 * @returns {{ cx, cy, radius }}
 */
function computeSvgArcParams(startX, startY, endX, endY, offsetI, offsetJ) {
  const cx = startX + offsetI
  const cy = startY + offsetJ
  const radius = Math.max(0.001, Math.sqrt(offsetI * offsetI + offsetJ * offsetJ))
  return { cx, cy, radius }
}
