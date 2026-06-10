/**
 * PCB DFM 工具 - 常量和默认配置
 */

// 层类型定义
export const LAYER_TYPES = {
  TOP_COPPER: { id: 'tcu', name: '顶层铜', color: '#e63946', required: true },
  INNER_COPPER_1: { id: 'icu1', name: '内层铜1', color: '#f4a261', required: false },
  INNER_COPPER_2: { id: 'icu2', name: '内层铜2', color: '#e9c46a', required: false },
  BOTTOM_COPPER: { id: 'bcu', name: '底层铜', color: '#2a9d8f', required: true },
  TOP_SOLDERMASK: { id: 'tsm', name: '顶层阻焊', color: '#00b894', required: false },
  BOTTOM_SOLDERMASK: { id: 'bsm', name: '底层阻焊', color: '#00cec9', required: false },
  TOP_SILKSCREEN: { id: 'tss', name: '顶层丝印', color: '#ffffff', required: false },
  BOTTOM_SILKSCREEN: { id: 'bss', name: '底层丝印', color: '#dfe6e9', required: false },
  OUTLINE: { id: 'out', name: '板框', color: '#fdcb6e', required: true },
  DRILL: { id: 'drl', name: '钻孔', color: '#636e72', required: false },
  TOP_PASTE: { id: 'tsp', name: '顶层锡膏', color: '#fab1a0', required: false },
  BOTTOM_PASTE: { id: 'bsp', name: '底层锡膏', color: '#81ecec', required: false },
}

// DFM 检查规则默认阈值
export const DEFAULT_RULES = {
  traceWidth: {
    id: 'trace-width',
    name: '最小线宽',
    description: '检查走线宽度是否满足最小制造要求',
    defaultValue: 4, // mil
    outerDefault: 4,
    innerDefault: 3,
    unit: 'mil',
    severity: 'error',
    category: 'manufacturing',
  },
  traceClearance: {
    id: 'trace-clearance',
    name: '线距/铜间距',
    description: '检查走线之间的最小间距',
    defaultValue: 6, // mil
    unit: 'mil',
    severity: 'error',
    category: 'manufacturing',
  },
  drillHoleSize: {
    id: 'drill-hole-size',
    name: '最小钻孔尺寸',
    description: '检查过孔和通孔的最小钻孔直径',
    defaultValue: 6, // mil (0.15mm)
    unit: 'mil',
    severity: 'error',
    category: 'manufacturing',
  },
  annularRing: {
    id: 'annular-ring',
    name: '焊盘环宽',
    description: '检查焊盘环宽(annular ring)是否足够',
    defaultValue: 5, // mil
    unit: 'mil',
    severity: 'warning',
    category: 'manufacturing',
  },
  soldermaskWeb: {
    id: 'soldermask-web',
    name: '阻焊桥宽度',
    description: '检查相邻焊盘之间的阻焊桥是否太窄',
    defaultValue: 4, // mil
    unit: 'mil',
    severity: 'warning',
    category: 'manufacturing',
  },
  silkscreenOnPad: {
    id: 'silkscreen-on-pad',
    name: '丝印上焊盘',
    description: '检查丝印是否覆盖了焊盘区域',
    defaultValue: 0, // 不允许
    unit: 'mil',
    severity: 'warning',
    category: 'assembly',
  },
  boardOutline: {
    id: 'board-outline',
    name: '板框完整性',
    description: '检查板框轮廓是否闭合完整',
    defaultValue: null,
    unit: '',
    severity: 'error',
    category: 'manufacturing',
  },
  copperToEdge: {
    id: 'copper-to-edge',
    name: '铜皮到板边距',
    description: '检查铜皮到板边的安全距离',
    defaultValue: 10, // mil (0.25mm)
    unit: 'mil',
    severity: 'warning',
    category: 'manufacturing',
  },
  missingLayers: {
    id: 'missing-layers',
    name: '缺失层检测',
    description: '检查是否缺少必要的PCB层',
    defaultValue: null,
    unit: '',
    severity: 'warning',
    category: 'manufacturing',
  },
}

// 厂商工艺标准预设
export const MANUFACTURER_PRESETS = {
  '默认': {
    traceWidth: 4, traceWidthInner: 3, traceClearance: 6,
    drillHoleSize: 6, annularRing: 5, soldermaskWeb: 4, copperToEdge: 10,
  },
  '嘉立创': {
    traceWidth: 5, traceWidthInner: 4, traceClearance: 6,
    drillHoleSize: 8, annularRing: 6, soldermaskWeb: 5, copperToEdge: 10,
  },
  '华秋': {
    traceWidth: 4, traceWidthInner: 3.5, traceClearance: 5,
    drillHoleSize: 6, annularRing: 5, soldermaskWeb: 4, copperToEdge: 8,
  },
}

// 违规严重等级
export const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
}

// 违规严重等级中文映射
export const SEVERITY_LABELS = {
  error: '错误',
  warning: '警告',
  info: '提示',
}

// 违规严重等级颜色
export const SEVERITY_COLORS = {
  error: '#e63946',
  warning: '#f4a261',
  info: '#457b9d',
}

// 应用状态
export const APP_STATES = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  PARSING: 'parsing',
  RENDERING: 'rendering',
  ANALYZING: 'analyzing',
  COMPLETE: 'complete',
  ERROR: 'error',
}

// PCB 层颜色映射 (用于 SVG 渲染)
export const LAYER_COLORS_SVG = {
  tcu: { fill: '#c0392b', stroke: '#c0392b', opacity: 0.8 },
  bcu: { fill: '#27ae60', stroke: '#27ae60', opacity: 0.8 },
  icu1: { fill: '#e67e22', stroke: '#e67e22', opacity: 0.6 },
  icu2: { fill: '#f39c12', stroke: '#f39c12', opacity: 0.6 },
  tsm: { fill: '#2980b9', stroke: '#2980b9', opacity: 0.4 },
  bsm: { fill: '#16a085', stroke: '#16a085', opacity: 0.4 },
  tss: { fill: '#ecf0f1', stroke: '#ecf0f1', opacity: 0.9 },
  bss: { fill: '#bdc3c7', stroke: '#bdc3c7', opacity: 0.9 },
  out: { fill: 'none', stroke: '#f1c40f', opacity: 1.0 },
  drl: { fill: '#7f8c8d', stroke: '#7f8c8d', opacity: 0.7 },
  tsp: { fill: '#e74c3c', stroke: '#e74c3c', opacity: 0.3 },
  bsp: { fill: '#1abc9c', stroke: '#1abc9c', opacity: 0.3 },
}
