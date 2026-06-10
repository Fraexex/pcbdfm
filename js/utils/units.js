/**
 * PCB DFM 工具 - 单位转换工具
 */

// 1 mil = 0.0254 mm = 0.001 inch
const MIL_TO_MM = 0.0254
const MIL_TO_INCH = 0.001
const MM_TO_MIL = 1 / 0.0254
const MM_TO_INCH = 1 / 25.4
const INCH_TO_MIL = 1000
const INCH_TO_MM = 25.4

/**
 * mil 转 mm
 */
export function milToMm(mil) {
  return mil * MIL_TO_MM
}

/**
 * mm 转 mil
 */
export function mmToMil(mm) {
  return mm * MM_TO_MIL
}

/**
 * mil 转 inch
 */
export function milToInch(mil) {
  return mil * MIL_TO_INCH
}

/**
 * inch 转 mil
 */
export function inchToMil(inch) {
  return inch * INCH_TO_MIL
}

/**
 * mm 转 inch
 */
export function mmToInch(mm) {
  return mm * MM_TO_INCH
}

/**
 * inch 转 mm
 */
export function inchToMm(inch) {
  return inch * INCH_TO_MM
}

/**
 * 格式化尺寸显示
 */
export function formatSize(value, fromUnit, toUnit) {
  let result = value
  if (fromUnit === 'mil' && toUnit === 'mm') result = milToMm(value)
  else if (fromUnit === 'mm' && toUnit === 'mil') result = mmToMil(value)
  else if (fromUnit === 'inch' && toUnit === 'mm') result = inchToMm(value)
  else if (fromUnit === 'inch' && toUnit === 'mil') result = inchToMil(value)
  else if (fromUnit === 'mm' && toUnit === 'inch') result = mmToInch(value)
  else if (fromUnit === 'mil' && toUnit === 'inch') result = milToInch(value)
  return Math.round(result * 1000) / 1000
}

/**
 * 格式化带单位的尺寸
 */
export function formatSizeWithUnit(value, unit) {
  if (unit === 'mm') return `${value.toFixed(3)} mm`
  if (unit === 'mil') return `${value.toFixed(1)} mil`
  if (unit === 'inch') return `${value.toFixed(4)} "`
  return `${value}`
}

/**
 * 检测 Gerber 文件中的单位系统 (通过 %MO 命令)
 */
export function detectGerberUnits(content) {
  const moMatch = content.match(/%MO(IN|MM)\*/i)
  return moMatch ? moMatch[1].toUpperCase() : null
}

/**
 * 将值统一转换为 mil (内部统一单位)
 */
export function toMil(value, fromUnit) {
  if (fromUnit === 'mil') return value
  if (fromUnit === 'mm') return mmToMil(value)
  if (fromUnit === 'inch') return inchToMil(value)
  return value
}
