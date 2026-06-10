/**
 * PCB DFM 工具 - 仪表盘 UI
 */

import { LAYER_TYPES, MANUFACTURER_PRESETS } from '../utils/constants.js'
import { milToMm, mmToMil } from '../utils/units.js'

/**
 * 渲染参数列表 — 板子基础信息 + 解析参数统计
 * @param {Array} layers - 已解析的层列表
 * @param {Array} violations - DFM 违规列表（可选，分析后填充）
 */
export function renderParamsPanel(layers, violations = []) {
  // ========== 1. 板子基础信息 ==========
  const boardInfo = extractBoardInfo(layers)
  const boardInfoEl = document.getElementById('params-board-info')

  boardInfoEl.innerHTML = `
    <div style="font-size:12px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">
      板子基础信息
    </div>
    <div style="background:var(--bg-card); border-radius:var(--radius); overflow:hidden;">
      ${paramRow('板子层数', `${boardInfo.layerCount} 层`)}
      ${paramRow('板子尺寸', boardInfo.dimensionsMm, 'var(--text-primary)')}
      ${paramRow('', boardInfo.dimensionsIn, 'var(--text-muted)')}
      ${paramRow('板子面积', boardInfo.area)}
      ${paramRow('坐标单位', boardInfo.units)}
      ${paramRow('文件数量', `${boardInfo.fileCount} 个`)}
      ${paramRow('总图形数', `${boardInfo.totalShapes} 个`)}
      ${paramRow('总钻孔数', `${boardInfo.totalHoles} 个`)}
    </div>
  `

  // ========== 2. 层文件清单 ==========
  const layersEl = document.getElementById('params-layers')
  const layerRows = layers
    .filter(l => l.layerType)
    .map(l => {
      const shapeCount = l.parsed?.shapes?.length || 0
      const holeCount = l.parsed?.holes?.length || 0
      const count = l.isDrill ? `${holeCount} 个孔` : `${shapeCount} 个图形`
      return `
        <div style="padding:7px 10px; border-bottom:1px solid var(--border-color);">
          <div style="display:flex; align-items:center; justify-content:space-between; font-size:12px;">
            <span style="display:flex; align-items:center; gap:6px;">
              <span style="width:8px;height:8px;border-radius:2px;background:${l.layerType.color};flex-shrink:0;"></span>
              <span style="font-weight:500;">${l.layerType.name}</span>
            </span>
            <span style="color:var(--accent-blue); font-size:11px;">${count}</span>
          </div>
          <div style="margin-top:2px; padding-left:14px; font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${l.filename}
          </div>
        </div>
      `
    }).join('')

  layersEl.innerHTML = `
    <div style="font-size:12px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">
      层文件清单
    </div>
    <div style="background:var(--bg-card); border-radius:var(--radius); overflow:hidden;">
      ${layerRows || '<div style="padding:12px; text-align:center; color:var(--text-muted); font-size:12px;">暂无数据</div>'}
    </div>
  `

  // ========== 3. 解析参数统计 ==========
  const stats = extractDesignStats(layers)
  const statsEl = document.getElementById('params-stats')

  statsEl.innerHTML = `
    <div style="font-size:12px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">
      设计参数统计
    </div>
    <div style="background:var(--bg-card); border-radius:var(--radius); overflow:hidden;">
      ${paramRow('最小线宽', stats.minTraceWidth, stats.minTraceWidth !== '-' ? 'var(--accent-green)' : 'var(--text-muted)')}
      ${paramRow('最小间距', stats.minSpacing, stats.minSpacing !== '-' ? 'var(--accent-green)' : 'var(--text-muted)')}
      ${paramRow('最大线宽', stats.maxTraceWidth, stats.maxTraceWidth !== '-' ? 'var(--accent-green)' : 'var(--text-muted)')}
      ${paramRow('最小焊盘尺寸', stats.minPadSize, stats.minPadSize !== '-' ? 'var(--accent-green)' : 'var(--text-muted)')}
      ${paramRow('最大焊盘尺寸', stats.maxPadSize, stats.maxPadSize !== '-' ? 'var(--accent-green)' : 'var(--text-muted)')}
      ${paramRow('最小钻孔直径', stats.minDrillSize, stats.minDrillSize !== '-' ? 'var(--accent-green)' : 'var(--text-muted)')}
      ${paramRow('最大钻孔直径', stats.maxDrillSize, stats.maxDrillSize !== '-' ? 'var(--accent-green)' : 'var(--text-muted)')}
      ${paramRow('孔环大小', stats.minAnnularRing, stats.minAnnularRing !== '-' ? 'var(--accent-green)' : 'var(--text-muted)')}
      ${paramRow('走线数量', `${stats.traceCount} 条`)}
      ${paramRow('焊盘数量', `${stats.padCount} 个`)}
      ${paramRow('钻孔数量', `${stats.holeCount} 个`)}
      ${paramRow('多边形数量', `${stats.polygonCount} 个`)}
      ${paramRow('Aperture 类型数', `${stats.apertureTypes} 种`)}
    </div>
  `

  // Make params sections collapsible
  _initParamsCollapse()
}

function _initParamsCollapse() {
  ;['params-board-info', 'params-layers', 'params-stats'].forEach(id => {
    const el = document.getElementById(id)
    if (!el || el.children.length < 2) return
    const header = el.children[0]
    const body = el.children[1]
    el.classList.add('collapse-section')
    header.className = 'collapse-header'
    header.removeAttribute('style')
    body.className = 'collapse-body'
    body.removeAttribute('style')
    header.addEventListener('click', () => {
      el.classList.toggle('collapsed')
    })
  })
}

// ========== 辅助函数 ==========

function paramRow(label, value, color) {
  return `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:7px 10px; border-bottom:1px solid var(--border-color); font-size:12px;">
      <span style="color:var(--text-secondary);">${label}</span>
      <span style="font-weight:500; color:${color || 'var(--text-primary)'};">${value || '-'}</span>
    </div>
  `
}

/**
 * 提取板子基础信息
 */
function extractBoardInfo(layers) {
  const identifiedLayers = layers.filter(l => l.layerType)
  const copperLayers = identifiedLayers.filter(l => ['tcu', 'bcu', 'icu1', 'icu2'].includes(l.layerType.id))
  const drillLayers = layers.filter(l => l.isDrill)

  // 计算板子尺寸（从板框层或所有层合并边界）
  let bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

  for (const l of layers) {
    if (!l.parsed?.bounds) continue
    const b = l.parsed.bounds
    if (!isFinite(b.minX)) continue
    // 用铜层和板框层来计算尺寸（排除可能坐标不准的钻孔层）
    const lid = l.layerType?.id
    if (['tcu', 'bcu', 'out', 'tsm', 'bsm', 'tss', 'bss', 'icu1', 'icu2'].includes(lid)) {
      bounds.minX = Math.min(bounds.minX, b.minX)
      bounds.minY = Math.min(bounds.minY, b.minY)
      bounds.maxX = Math.max(bounds.maxX, b.maxX)
      bounds.maxY = Math.max(bounds.maxY, b.maxY)
    }
  }

  const widthIn = isFinite(bounds.minX) ? (bounds.maxX - bounds.minX) : 0
  const heightIn = isFinite(bounds.minY) ? (bounds.maxY - bounds.minY) : 0
  const widthMm = (widthIn * 25.4).toFixed(2)
  const heightMm = (heightIn * 25.4).toFixed(2)

  // 判断单位
  const units = layers[0]?.parsed?.units === 'IN' ? '英寸 (inch)' : '毫米 (mm)'

  // 总图形数和钻孔数
  let totalShapes = 0
  let totalHoles = 0
  for (const l of layers) {
    totalShapes += l.parsed?.shapes?.length || 0
    totalHoles += l.parsed?.holes?.length || 0
  }

  return {
    layerCount: copperLayers.length,
    copperLayerCount: copperLayers.length,
    dimensionsMm: `${widthMm} × ${heightMm} mm`,
    dimensionsIn: `${widthIn.toFixed(4)} × ${heightIn.toFixed(4)} in`,
    area: `${(widthMm * heightMm).toFixed(2)} mm²`,
    units,
    fileCount: layers.length,
    totalShapes,
    totalHoles,
  }
}

/**
 * 提取设计参数统计
 */
/**
 * 提取设计参数统计
 */
function extractDesignStats(layers) {
  // Detect unit from first parsed layer
  const rawUnit = (layers.find(l => l.parsed?.units))?.parsed?.units || 'MM'
  const isInch = rawUnit === 'IN'

  let minTraceWidth = Infinity, maxTraceWidth = 0
  let minPadSize = Infinity, maxPadSize = 0
  let minDrillSize = Infinity, maxDrillSize = 0
  let traceCount = 0, padCount = 0, polygonCount = 0, holeCount = 0
  const apertureSet = new Set()

  // Collect flashes for spacing calculation
  const flashes = []

  for (const l of layers) {
    if (!l.parsed) continue

    for (const s of (l.parsed.shapes || [])) {
      if (s.type === 'line') {
        traceCount++
        const w = s.width || 0
        if (w > 0) {
          minTraceWidth = Math.min(minTraceWidth, w)
          maxTraceWidth = Math.max(maxTraceWidth, w)
        }
      } else if (s.type === 'flash') {
        padCount++
        const size = Math.min(s.width || 0, s.height || 0)
        if (size > 0) {
          minPadSize = Math.min(minPadSize, size)
          maxPadSize = Math.max(maxPadSize, size)
        }
        const r = Math.max(s.width || 0, s.height || 0) / 2
        flashes.push({ x: s.x, y: s.y, radius: r })
      } else if (s.type === 'polygon') {
        polygonCount++
      }
    }

    for (const h of (l.parsed.holes || [])) {
      holeCount++
      if (h.diameter > 0) {
        minDrillSize = Math.min(minDrillSize, h.diameter)
        maxDrillSize = Math.max(maxDrillSize, h.diameter)
      }
    }

    for (const code of Object.keys(l.parsed.apertures || {})) {
      const ap = l.parsed.apertures[code]
      apertureSet.add(`${ap.shape}-${ap.width}-${ap.height}`)
    }
  }

  // Compute minimum pad-to-pad spacing
  let minSpacing = Infinity
  for (let i = 0; i < flashes.length; i++) {
    for (let j = i + 1; j < flashes.length; j++) {
      const dist = Math.sqrt((flashes[i].x - flashes[j].x) ** 2 + (flashes[i].y - flashes[j].y) ** 2)
      const gap = dist - flashes[i].radius - flashes[j].radius
      if (gap > 0 && gap < minSpacing) {
        minSpacing = gap
      }
    }
  }

  // Compute minimum annular ring (pad_radius - drill_radius)
  let minAnnularRing = Infinity
  const drillLayers = layers.filter(l => l.isDrill)
  const copperLayerIds = ['tcu', 'bcu', 'icu1', 'icu2']
  const copperLayers = layers.filter(l => copperLayerIds.includes(l.layerType?.id))
  for (const dl of drillLayers) {
    if (!dl.parsed?.holes) continue
    for (const hole of dl.parsed.holes) {
      const drillR = hole.diameter / 2
      for (const cl of copperLayers) {
        if (!cl.parsed?.shapes) continue
        for (const s of cl.parsed.shapes) {
          if (s.type === 'flash') {
            const dx = Math.abs(s.x - hole.x)
            const dy = Math.abs(s.y - hole.y)
            if (dx < 0.01 && dy < 0.01) {
              const padR = Math.max(s.width || 0, s.height || 0) / 2
              const ring = padR - drillR
              if (ring > 0 && ring < minAnnularRing) {
                minAnnularRing = ring
              }
            }
          }
        }
      }
    }
  }

  // Format: mm as primary, mil as secondary
  const fmtMm = (v) => {
    if (!isFinite(v)) return '-'
    const mm = isInch ? v * 25.4 : v
    const mil = isInch ? v * 1000 : v * 1000 / 25.4
    return `${mm.toFixed(4)} mm (${mil.toFixed(1)} mil)`
  }

  return {
    minTraceWidth: fmtMm(minTraceWidth),
    maxTraceWidth: fmtMm(maxTraceWidth),
    minSpacing: fmtMm(minSpacing),
    minPadSize: fmtMm(minPadSize),
    maxPadSize: fmtMm(maxPadSize),
    minDrillSize: fmtMm(minDrillSize),
    maxDrillSize: fmtMm(maxDrillSize),
    minAnnularRing: fmtMm(minAnnularRing),
    traceCount,
    padCount,
    polygonCount,
    holeCount,
    apertureTypes: apertureSet.size,
  }
}

/**
 * 渲染仪表盘汇总
 * @param {object} summary - DFM 分析汇总
 * @param {HTMLElement} summaryEl - 汇总卡片容器
 * @param {HTMLElement} resultsEl - 规则结果列表容器
 */
export function renderDashboard(summary, summaryEl, resultsEl) {
  // 更新汇总数字
  document.getElementById('count-errors').textContent = summary.totalErrors
  document.getElementById('count-warnings').textContent = summary.totalWarnings
  document.getElementById('count-passes').textContent = summary.passedRules

  // 渲染每个规则的结果
  resultsEl.innerHTML = ''

  for (const rule of summary.ruleResults) {
    const item = document.createElement('div')
    item.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      margin-bottom: 4px;
      background: var(--bg-card);
      border-radius: 6px;
      font-size: 13px;
    `

    const statusIcon = rule.status === 'pass' ? '✅'
      : rule.status === 'warning' ? '⚠️'
      : rule.status === 'fail' ? '❌'
      : '❓'

    const statusColor = rule.status === 'pass' ? 'var(--accent-green)'
      : rule.status === 'warning' ? 'var(--accent-yellow)'
      : 'var(--accent-red)'

    item.innerHTML = `
      <span style="display:flex; align-items:center; gap:8px;">
        <span>${statusIcon}</span>
        <span>${rule.name}</span>
      </span>
      <span style="color:${statusColor}; font-size:12px; font-weight:500;">
        ${rule.totalViolations > 0 ? `${rule.totalViolations} 项` : '通过'}
      </span>
    `

    resultsEl.appendChild(item)
  }

  // 总体状态
  const overallEl = document.createElement('div')
  const overallStatus = summary.overallStatus
  const overallIcon = overallStatus === 'pass' ? '🎉'
    : overallStatus === 'warning' ? '⚡'
    : '🚨'
  const overallText = overallStatus === 'pass' ? '全部检查通过'
    : overallStatus === 'warning' ? '存在警告项'
    : '存在错误项'
  const overallColor = overallStatus === 'pass' ? 'var(--accent-green)'
    : overallStatus === 'warning' ? 'var(--accent-yellow)'
    : 'var(--accent-red)'

  overallEl.style.cssText = `
    margin-top: 12px;
    padding: 12px;
    background: var(--bg-card);
    border-radius: 8px;
    text-align: center;
    border: 1px solid ${overallColor}33;
  `
  overallEl.innerHTML = `
    <div style="font-size:24px; margin-bottom:4px;">${overallIcon}</div>
    <div style="font-size:14px; font-weight:600; color:${overallColor};">${overallText}</div>
    <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
      ${summary.totalRules} 项检查 · ${summary.totalErrors} 错误 · ${summary.totalWarnings} 警告
    </div>
  `

  resultsEl.appendChild(overallEl)
}

/**
 * 渲染层列表到左侧边栏
 * @param {Array} layers - 已解析的层
 * @param {HTMLElement} container - 层列表容器
 * @param {function} onToggle - 层切换回调 (layerId, visible)
 */
export function renderLayerList(layers, container, onToggle) {
  container.innerHTML = ''

  for (const layer of layers) {
    if (!layer.layerType) continue

    const li = document.createElement('li')
    li.className = 'layer-item'

    const color = layer.layerType.color || '#666'

    li.innerHTML = `
      <span class="layer-color" style="background:${color};"></span>
      <span class="layer-name"><span style="font-weight:500;">${layer.layerType.name}</span><span style="display:block;font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${layer.filename}</span></span>
      <input type="checkbox" class="layer-toggle" checked data-layer="${layer.layerType.id}">
    `

    const checkbox = li.querySelector('.layer-toggle')
    checkbox.addEventListener('change', () => {
      if (onToggle) onToggle(layer.layerType.id, checkbox.checked)
    })

    container.appendChild(li)
  }
}

/**
 * 渲染规则配置列表到左侧边栏
 * @param {object} settings - 当前规则设置
 * @param {HTMLElement} container - 规则列表容器
 * @param {function} onChange - 配置变更回调 (ruleId, value)
 */
export function renderRuleConfig(settings, container, onChange, onPresetChange, currentPreset) {
  container.innerHTML = ''

  // Preset selector
  const presetNames = Object.keys(MANUFACTURER_PRESETS)
  const presetRow = document.createElement('div')
  presetRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-size:12px;'
  const presetLabel = document.createElement('span')
  presetLabel.style.cssText = 'color:var(--text-secondary);'
  presetLabel.textContent = '厂商标准'
  const presetSelect = document.createElement('select')
  presetSelect.style.cssText = 'background:var(--bg-primary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);font-size:12px;padding:2px 6px;cursor:pointer;'
  for (const name of presetNames) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    if (name === (currentPreset || '默认')) opt.selected = true
    presetSelect.appendChild(opt)
  }
  presetSelect.addEventListener('change', () => {
    if (onPresetChange) onPresetChange(presetSelect.value)
  })
  presetRow.appendChild(presetLabel)
  presetRow.appendChild(presetSelect)
  container.appendChild(presetRow)

  const rules = [
    { id: 'traceWidth', name: '最小线宽', unit: 'mil', default: 4 },
    { id: 'traceWidthInner', name: '内层最小线宽', unit: 'mil', default: 3 },
    { id: 'traceClearance', name: '线距/铜间距', unit: 'mil', default: 6 },
    { id: 'drillHoleSize', name: '最小钻孔尺寸', unit: 'mil', default: 6 },
    { id: 'annularRing', name: '焊盘环宽', unit: 'mil', default: 5 },
    { id: 'soldermaskWeb', name: '阻焊桥宽度', unit: 'mil', default: 4 },
    { id: 'copperToEdge', name: '铜皮到板边距', unit: 'mil', default: 10 },
  ]

  for (const rule of rules) {
    const div = document.createElement('div')
    div.className = 'rule-item'

    const currentValue = settings[rule.id] || rule.default

    div.innerHTML = `
      <span class="rule-name">${rule.name}</span>
      <span>
        <input type="number" class="rule-input" value="${currentValue}" min="0" step="0.5" data-rule="${rule.id}">
        <span class="rule-unit">${rule.unit}</span>
      </span>
    `

    const input = div.querySelector('.rule-input')
    input.addEventListener('change', () => {
      const val = parseFloat(input.value)
      if (!isNaN(val) && val >= 0) {
        if (onChange) onChange(rule.id, val)
      }
    })

    container.appendChild(div)
  }
}
