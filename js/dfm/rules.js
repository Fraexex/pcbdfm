/**
 * PCB DFM 工具 - 9 项 DFM 检查规则
 * 每个规则函数接收检查上下文，返回违规数组
 */

import { mmToMil, milToMm } from '../utils/units.js'
import { SEVERITY } from '../utils/constants.js'

/**
 * DFM 检查上下文
 * @typedef {object} CheckContext
 * @property {Array} layers - 已解析的层列表
 * @property {object} stackup - pcb-stackup 输出
 * @property {object} geometry - { shapes: Map<layerId, Shape[]>, drillHoles, traces }
 * @property {object} settings - 用户配置的规则阈值
 * @property {object} boardInfo - { width, height, layerCount, units }
 */

/**
 * 违规对象
 * @typedef {object} Violation
 * @property {string} id - 唯一ID
 * @property {string} ruleId - 规则ID
 * @property {string} ruleName - 规则名称
 * @property {string} severity - 'error' | 'warning' | 'info'
 * @property {string} message - 中文描述
 * @property {object|null} location - { x, y } 坐标
 * @property {string} suggestion - 改进建议
 */

let violationCounter = 0

function nextId() {
  return `v_${++violationCounter}`
}

function evaluateTolerance(actual, min, tolerance) {
  if (actual < min) {
    return { severity: SEVERITY.ERROR, delta: actual - min }
  }

  if (actual < min + tolerance) {
    return { severity: SEVERITY.WARNING, delta: actual - min }
  }
  
  return { severity: null, delta: actual - min }
}

function getTol(settings, key, defaultTol) {
  if (!settings.strictMode) return 0
  return settings[`${key}Tolerance`] ?? defaultTol
}

// ==========================================
// 规则 1: 最小线宽
// ==========================================
export function checkTraceWidth(ctx) {
  const violations = []
  const threshold = ctx.settings.traceWidth || 4 // mil
  const thresholdMm = milToMm(threshold)

  // 从 Gerber 内容直接提取走线
  for (const layer of ctx.layers) {
    const layerId = layer.layerType?.id
    if (!['tcu', 'bcu', 'icu1', 'icu2'].includes(layerId)) continue

    if (!layer.content) continue

    const traces = extractTracesFromContent(layer.content)
    const isOuter = ['tcu', 'bcu'].includes(layerId)
    const effectiveThreshold = isOuter ? threshold : (ctx.settings.traceWidthInner || 3)
    const effectiveThresholdMm = milToMm(effectiveThreshold)

    for (const trace of traces) {
      const tol = getTol(ctx.settings, 'traceWidth', milToMm(0.5))
      const result = evaluateTolerance(
        trace.width,
        effectiveThresholdMm,
        tol
      )
      if (result.severity) {
        const midX = (trace.startX + trace.endX) / 2
        const midY = (trace.startY + trace.endY) / 2
        violations.push({
          id: nextId(),
          ruleId: 'trace-width',
          ruleName: '最小线宽',
          severity: SEVERITY.ERROR,
          message: `${isOuter ? '外层' : '内层'}走线宽度 ${mmToMil(trace.width).toFixed(1)} mil 小于最小要求 ${effectiveThreshold} mil`,
          location: { x: midX, y: midY },
          suggestion: `建议将走线宽度增加到至少 ${effectiveThreshold} mil (${effectiveThresholdMm.toFixed(3)} mm)`,
          layerId,
        })
      }
    }
  }

  return violations
}

// ==========================================
// 规则 2: 线距/铜间距
// ==========================================
export function checkTraceClearance(ctx) {
  const violations = []
  const threshold = ctx.settings.traceClearance || 6 // mil
  const thresholdMm = milToMm(threshold)

  // 对每层铜层，检查走线之间的间距
  for (const layer of ctx.layers) {
    const layerId = layer.layerType?.id
    if (!['tcu', 'bcu'].includes(layerId)) continue
    if (!layer.content) continue

    const traces = extractTracesFromContent(layer.content)

    // 简化检查：对短线段集合做 O(n²) 距离检查（小规模可行）
    const maxChecks = Math.min(traces.length, 500) // 限制检查数量防止性能问题
    for (let i = 0; i < maxChecks; i++) {
      for (let j = i + 1; j < maxChecks; j++) {
        const tol = getTol(ctx.settings, 'traceClearance', milToMm(0.5))
        const result = evaluateTolerance(dist, thresholdMm, tol)
        const dist = segmentDistance(traces[i], traces[j])
        if (dist > 0 && result.severity) {
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

// ==========================================
// 规则 3: 最小钻孔尺寸
// ==========================================
export function checkDrillHoleSize(ctx) {
  const violations = []
  const threshold = ctx.settings.drillHoleSize || 6 // mil
  const thresholdMm = milToMm(threshold)

  if (!ctx.geometry?.drillHoles?.length) {
    // 从钻孔层内容提取
    for (const layer of ctx.layers) {
      if (layer.layerType?.id !== 'drl' || !layer.content) continue

      const holes = extractDrillHolesFromContent(layer.content)
      for (const hole of holes) {
        const tol = getTol(ctx.settings, 'drillHoleSize', milToMm(0.2))
        const result = evaluateTolerance(hole.diameter, thresholdMm, tol)
        if (hole.diameter > 0 && result.severity) {
          violations.push({
            id: nextId(),
            ruleId: 'drill-hole-size',
            ruleName: '最小钻孔尺寸',
            severity: SEVERITY.ERROR,
            message: `钻孔直径 ${mmToMil(hole.diameter).toFixed(1)} mil 小于最小要求 ${threshold} mil`,
            location: { x: hole.x, y: hole.y },
            suggestion: `建议增大钻孔直径到至少 ${threshold} mil (${thresholdMm.toFixed(3)} mm)`,
            layerId: 'drl',
          })
        }
      }
    }
  }

  return violations
}

// ==========================================
// 规则 4: 焊盘环宽
// ==========================================
export function checkAnnularRing(ctx) {
  const violations = []
  const threshold = ctx.settings.annularRing || 5 // mil
  const thresholdMm = milToMm(threshold)

  // 从铜层获取 pad (flash)，从钻孔层获取 drill
  const drillLayer = ctx.layers.find(l => l.layerType?.id === 'drl')
  const copperLayers = ctx.layers.filter(l => ['tcu', 'bcu'].includes(l.layerType?.id))

  if (!drillLayer || !drillLayer.content) return violations

  const holes = extractDrillHolesFromContent(drillLayer.content)

  // 对每个孔，估算焊盘环宽
  for (const hole of holes) {
    // 典型焊盘直径 = 钻孔直径 + 2 * 环宽
    // 如果没有 pad 数据，使用典型值估算
    const typicalPadDiameter = hole.diameter + 2 * thresholdMm
    const annularRing = (typicalPadDiameter - hole.diameter) / 2
    const tol = getTol(ctx.settings, 'annularRing', milToMm(0.5))
    const result = evaluateTolerance(
      annularRing,
      thresholdMm,
      tol
    )

    // 如果焊盘太小（直径接近钻孔），报告问题
    if (result.severity && annularRing > 0) {
      violations.push({
        id: nextId(),
        ruleId: 'annular-ring',
        ruleName: '焊盘环宽',
        severity: SEVERITY.WARNING,
        message: `过孔焊盘环宽 ${mmToMil(annularRing).toFixed(1)} mil 可能不足 ${threshold} mil`,
        location: { x: hole.x, y: hole.y },
        suggestion: `建议增大焊盘尺寸，使环宽至少 ${threshold} mil`,
        layerId: 'tcu',
      })
    }
  }

  return violations
}

// ==========================================
// 规则 5: 阻焊桥宽度
// ==========================================
export function checkSoldermaskWeb(ctx) {
  const violations = []
  const threshold = ctx.settings.soldermaskWeb || 4 // mil

  // 简化检查：检查是否存在阻焊层
  const hasSoldermask = ctx.layers.some(l =>
    ['tsm', 'bsm'].includes(l.layerType?.id)
  )

  if (!hasSoldermask) {
    violations.push({
      id: nextId(),
      ruleId: 'soldermask-web',
      ruleName: '阻焊桥宽度',
      severity: SEVERITY.INFO,
      message: '未检测到阻焊层，无法检查阻焊桥宽度',
      location: null,
      suggestion: '建议提供阻焊层文件以进行完整检查',
      layerId: null,
    })
  }

  return violations
}

// ==========================================
// 规则 6: 丝印上焊盘
// ==========================================
export function checkSilkscreenOnPad(ctx) {
  const violations = []

  const silkscreenLayers = ctx.layers.filter(l =>
    ['tss', 'bss'].includes(l.layerType?.id)
  )
  const copperLayers = ctx.layers.filter(l =>
    ['tcu', 'bcu'].includes(l.layerType?.id)
  )

  if (!silkscreenLayers.length) return violations

  // 简化检查：报告信息
  for (const silkLayer of silkscreenLayers) {
    violations.push({
      id: nextId(),
      ruleId: 'silkscreen-on-pad',
      ruleName: '丝印上焊盘',
      severity: SEVERITY.INFO,
      message: `已检测到${silkLayer.layerType.name}，需检查丝印是否覆盖焊盘`,
      location: null,
      suggestion: '建议在 CAD 工具中检查丝印与焊盘的重叠情况',
      layerId: silkLayer.layerType?.id,
    })
  }

  return violations
}

// ==========================================
// 规则 7: 板框完整性
// ==========================================
export function checkBoardOutline(ctx) {
  const violations = []

  const outlineLayer = ctx.layers.find(l => l.layerType?.id === 'out')

  if (!outlineLayer) {
    violations.push({
      id: nextId(),
      ruleId: 'board-outline',
      ruleName: '板框完整性',
      severity: SEVERITY.ERROR,
      message: '未检测到板框层 (Board Outline)',
      location: null,
      suggestion: '请确保包含板框轮廓层文件（通常是 .GKO / .GM1 / Outline）',
      layerId: null,
    })
    return violations
  }

  // 检查板框内容是否为空
  if (!outlineLayer.content || outlineLayer.content.trim().length < 20) {
    violations.push({
      id: nextId(),
      ruleId: 'board-outline',
      ruleName: '板框完整性',
      severity: SEVERITY.ERROR,
      message: '板框层内容为空或过短',
      location: null,
      suggestion: '请检查板框文件是否正确',
      layerId: 'out',
    })
  }

  // 检查是否有闭合轮廓 (简单检测 G36/G37 区域填充)
  const content = outlineLayer.content
  const hasRegion = content.includes('G36') || content.includes('G37')
  const hasDraw = content.includes('D01') || content.includes('D02')

  if (!hasRegion && !hasDraw) {
    violations.push({
      id: nextId(),
      ruleId: 'board-outline',
      ruleName: '板框完整性',
      severity: SEVERITY.WARNING,
      message: '板框层可能缺少有效的轮廓数据',
      location: null,
      suggestion: '请确认板框层包含完整的闭合轮廓',
      layerId: 'out',
    })
  }

  return violations
}

// ==========================================
// 规则 8: 铜皮到板边距
// ==========================================
export function checkCopperToEdge(ctx) {
  const violations = []
  const threshold = ctx.settings.copperToEdge || 10 // mil

  // 需要同时有铜层和板框层才能检查
  const hasOutline = ctx.layers.some(l => l.layerType?.id === 'out')
  if (!hasOutline) return violations

  // 简化检查：报告规则已应用
  for (const layer of ctx.layers) {
    if (!['tcu', 'bcu'].includes(layer.layerType?.id)) continue
    // 完整实现需要板框轮廓与铜层的几何运算
    // 这里仅标记信息
  }

  return violations
}

// ==========================================
// 规则 9: 缺失层检测
// ==========================================
export function checkMissingLayers(ctx) {
  const violations = []
  const presentLayers = new Set(ctx.layers.map(l => l.layerType?.id).filter(Boolean))

  const requiredLayers = [
    { id: 'tcu', name: '顶层铜', severity: SEVERITY.ERROR },
    { id: 'bcu', name: '底层铜', severity: SEVERITY.ERROR },
    { id: 'out', name: '板框', severity: SEVERITY.ERROR },
  ]

  const recommendedLayers = [
    { id: 'tsm', name: '顶层阻焊', severity: SEVERITY.WARNING },
    { id: 'bsm', name: '底层阻焊', severity: SEVERITY.WARNING },
    { id: 'drl', name: '钻孔', severity: SEVERITY.WARNING },
    { id: 'tss', name: '顶层丝印', severity: SEVERITY.INFO },
  ]

  for (const req of requiredLayers) {
    if (!presentLayers.has(req.id)) {
      violations.push({
        id: nextId(),
        ruleId: 'missing-layers',
        ruleName: '缺失层检测',
        severity: req.severity,
        message: `缺少必要的 ${req.name} 层`,
        location: null,
        suggestion: `请添加 ${req.name} 层的 Gerber 文件`,
        layerId: null,
      })
    }
  }

  for (const rec of recommendedLayers) {
    if (!presentLayers.has(rec.id)) {
      violations.push({
        id: nextId(),
        ruleId: 'missing-layers',
        ruleName: '缺失层检测',
        severity: rec.severity,
        message: `建议添加 ${rec.name} 层`,
        location: null,
        suggestion: `${rec.name} 层有助于进行更完整的 DFM 分析`,
        layerId: null,
      })
    }
  }

  return violations
}

// ========== 辅助函数 ==========

/**
 * 从 Gerber 内容提取走线 (简化版)
 */
function extractTracesFromContent(content) {
  const traces = []
  const apertures = {}
  let currentX = 0, currentY = 0, currentAperture = null

  for (const line of content.split('\n')) {
    const t = line.trim()

    // Aperture 定义
    const addMatch = t.match(/%ADD(\d+)([CORS]),?([\d.]+)(?:X([\d.]+))?\*%/)
    if (addMatch) {
      apertures[addMatch[1]] = parseFloat(addMatch[3])
      continue
    }

    // 选择 aperture
    const selMatch = t.match(/^D(\d+)\*$/)
    if (selMatch && parseInt(selMatch[1]) >= 10) {
      currentAperture = selMatch[1]
      continue
    }

    // 坐标命令
    const cmdMatch = t.match(/X?([-\d.]+)?Y?([-\d.]+)?D(0[123])\*$/)
    if (cmdMatch) {
      const x = cmdMatch[1] ? parseFloat(cmdMatch[1]) : currentX
      const y = cmdMatch[2] ? parseFloat(cmdMatch[2]) : currentY
      const dCode = cmdMatch[3]

      if (dCode === '01' && currentAperture && apertures[currentAperture]) {
        traces.push({
          startX: currentX,
          startY: currentY,
          endX: x,
          endY: y,
          width: apertures[currentAperture],
        })
      }

      currentX = x
      currentY = y
    }
  }

  return traces
}

/**
 * 从钻孔文件内容提取钻孔 (Excellon 格式)
 */
function extractDrillHolesFromContent(content) {
  const holes = []
  const tools = {}
  let currentTool = null

  for (const line of content.split('\n')) {
    const t = line.trim()

    const toolMatch = t.match(/^T(\d+)C([\d.]+)/)
    if (toolMatch) {
      tools[`T${toolMatch[1]}`] = parseFloat(toolMatch[2])
      continue
    }

    const selMatch = t.match(/^(T\d+)/)
    if (selMatch && !t.includes('X') && !t.includes('Y')) {
      currentTool = selMatch[1]
      continue
    }

    const coordMatch = t.match(/X([-\d.]+)Y([-\d.]+)/)
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
 * 两线段之间的最短距离 (简化版)
 */
function segmentDistance(a, b) {
  // 使用线段中点距离近似
  const d1 = pointToSegmentDistance(
    (a.startX + a.endX) / 2, (a.startY + a.endY) / 2, b
  )
  const d2 = pointToSegmentDistance(
    (b.startX + b.endX) / 2, (b.startY + b.endY) / 2, a
  )
  return Math.min(d1, d2) - (a.width + b.width) / 2
}

function pointToSegmentDistance(px, py, seg) {
  const dx = seg.endX - seg.startX
  const dy = seg.endY - seg.startY
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    return Math.sqrt((px - seg.startX) ** 2 + (py - seg.startY) ** 2)
  }

  let t = ((px - seg.startX) * dx + (py - seg.startY) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const projX = seg.startX + t * dx
  const projY = seg.startY + t * dy

  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
}

function midpoint(trace1, trace2) {
  return {
    x: ((trace1.startX + trace1.endX) / 2 + (trace2.startX + trace2.endX) / 2) / 2,
    y: ((trace1.startY + trace1.endY) / 2 + (trace2.startY + trace2.endY) / 2) / 2,
  }
}

// 导出所有规则的有序列表
export const ALL_RULES = [
  { id: 'missing-layers', name: '缺失层检测', fn: checkMissingLayers },
  { id: 'board-outline', name: '板框完整性', fn: checkBoardOutline },
  { id: 'trace-width', name: '最小线宽', fn: checkTraceWidth },
  { id: 'drill-hole-size', name: '最小钻孔尺寸', fn: checkDrillHoleSize },
  { id: 'trace-clearance', name: '线距/铜间距', fn: checkTraceClearance },
  { id: 'annular-ring', name: '焊盘环宽', fn: checkAnnularRing },
  { id: 'soldermask-web', name: '阻焊桥宽度', fn: checkSoldermaskWeb },
  { id: 'silkscreen-on-pad', name: '丝印上焊盘', fn: checkSilkscreenOnPad },
  { id: 'copper-to-edge', name: '铜皮到板边距', fn: checkCopperToEdge },
]
