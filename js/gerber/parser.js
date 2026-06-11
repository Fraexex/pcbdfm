/**
 * PCB DFM 工具 - 纯 JS Gerber RS-274X 解析器
 * 零外部依赖，直接解析 Gerber/Excellon 文本格式
 *
 * 支持：
 * - Aperture 定义 (circle, rect, oblong, polygon)
 * - D01 (draw), D02 (move), D03 (flash) 命令
 * - G36/G37 (region fill)
 * - G04 (comment)
 * - 极性 %LPD% / %LPC%
 * - 坐标格式 %FS%
 * - 单位 %MO%
 */

/**
 * 解析单个 Gerber 文件，返回结构化数据
 * @param {string} content - Gerber 文件文本内容
 * @param {string} filename - 文件名
 * @returns {object} { shapes, apertures, bounds, units, errors }
 */
export function parseGerber(content, filename = 'unknown') {
  const result = {
    filename,
    units: 'mm',       // 默认 mm
    format: null,       // { xInt, xDec, yInt, yDec }
    shapes: [],         // 所有图形元素
    apertures: {},      // aperture 定义
    bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    errors: [],
  }

  if (!content || typeof content !== 'string') {
    result.errors.push('文件内容为空')
    return result
  }

  const lines = content.split(/\r?\n/)
  let currentX = 0, currentY = 0
  let currentAperture = null
  let interpolation = 'linear'   // linear | cw | ccw
  let regionMode = false
  let regionPoints = []
  let polarity = 'dark'          // dark | clear
  let lastDCode = 'D01'          // 记住上一个 D 码，隐含时复用
  let multiQuadrant = true       // G75=多象限圆弧（默认）, G74=单象限圆弧

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    try {
      // 单位
      if (line.startsWith('%MO')) {
        const m = line.match(/%MO(IN|MM)\*%/i)
        if (m) result.units = m[1].toUpperCase()
        continue
      }

      // 格式规范  %FSLAX35Y35*%  或  %FSLAX24Y24*%  或  %FSLAX44Y44*%
      if (line.startsWith('%FS')) {
        const m = line.match(/X(\d)(\d)Y(\d)(\d)/i)
        if (m) {
          result.format = { xInt: parseInt(m[1]) || 2, xDec: parseInt(m[2]) || 4 }
        }
        continue
      }

      // 极性
      if (line.startsWith('%LPD')) { polarity = 'dark'; continue }
      if (line.startsWith('%LPC')) { polarity = 'clear'; continue }

      // Aperture 定义 %ADDnnC,size*% 或 %ADDnnR,sizeXsize*%
      const addMatch = line.match(/%ADD(\d+)([CORS])(?:,([\d.]+)(?:X([\d.]+))?)?\*%/i)
      if (addMatch) {
        // 去除前导零，统一存储为无前导零的数字字符串（与 D 码选择一致）
        const code = String(parseInt(addMatch[1], 10))
        const shape = addMatch[2].toUpperCase()
        const size1 = parseFloat(addMatch[3]) || 0
        const size2 = addMatch[4] ? parseFloat(addMatch[4]) : size1
        result.apertures[code] = { shape, width: size1, height: size2 }
        continue
      }

      // Aperture Macro (简化：跳过)
      if (line.startsWith('%AM')) continue

      // 选择 aperture Dnn* 或 G54Dnn* (PADS format)
      const selMatch = line.match(/^(?:G54)?D(\d+)\*$/)
      if (selMatch) {
        currentAperture = String(parseInt(selMatch[1], 10))
        continue
      }

      // G codes (only pure G commands, not G01X... coordinate lines)
      if (line === 'G01*' || line === 'G1*') { interpolation = 'linear'; continue }
      if (line === 'G02*' || line === 'G2*') { interpolation = 'cw'; continue }
      if (line === 'G03*' || line === 'G3*') { interpolation = 'ccw'; continue }
      if (line === 'G75*') { multiQuadrant = true; continue }   // 多象限圆弧
      if (line === 'G74*') { multiQuadrant = false; continue }  // 单象限圆弧
      if (line === 'G36*') { regionMode = true; regionPoints = []; continue }
      if (line === 'G37*') {
        regionMode = false
        if (regionPoints.length > 2) {
          const shape = {
            type: 'polygon',
            points: [...regionPoints],
            polarity,
            aperture: currentAperture,
          }
          result.shapes.push(shape)
          updateBounds(result.bounds, shape)
        }
        regionPoints = []
        continue
      }

      // 注释
      if (line.startsWith('G04') || line.startsWith('G4')) continue

      // 空行或纯 * 行
      if (line === '*' || line === '') continue

      // M code
      if (line.startsWith('M02') || line.startsWith('M2')) continue

      // 坐标命令（支持内联 G01/G02/G03 + I/J 圆弧偏移）
      // 捕获组: 1=G码, 2/3=X, 4/5=Y, 6=I, 7=J, 8=D码
      const cmdMatch = line.match(/^(?:G0?([123])\*?)?(X([-\d]+))?(Y([-\d]+))?(?:I([-\d]+))?(?:J([-\d]+))?\s*(D0[123])?\*$/)
      if (cmdMatch) {
        const rawX = cmdMatch[3]
        const rawY = cmdMatch[5]
        const rawI = cmdMatch[6]
        const rawJ = cmdMatch[7]

        // 内联 G 码覆盖插补模式
        if (cmdMatch[1]) {
          const gNum = parseInt(cmdMatch[1])
          if (gNum === 1) interpolation = 'linear'
          else if (gNum === 2) interpolation = 'cw'
          else if (gNum === 3) interpolation = 'ccw'
        }

        // RS-274X: 省略 D 码时隐含上一个 D 码
        if (cmdMatch[8]) {
          lastDCode = cmdMatch[8]
        }
        const dCode = lastDCode

        // 保存前一位置（startX/startY 需要它）
        const prevX = currentX
        const prevY = currentY

        if (rawX !== undefined) {
          currentX = parseCoord(rawX, result.format)
        }
        if (rawY !== undefined) {
          currentY = parseCoord(rawY, result.format)
        }

        // 解析 I/J 圆弧偏移
        const offsetI = rawI !== undefined ? parseCoord(rawI, result.format) : 0
        const offsetJ = rawJ !== undefined ? parseCoord(rawJ, result.format) : 0
        const isArc = (interpolation === 'cw' || interpolation === 'ccw') && (offsetI !== 0 || offsetJ !== 0)

        if (dCode === 'D02') {
          // Move (不画线)
          if (regionMode) regionPoints.push({ x: currentX, y: currentY })
        } else if (dCode === 'D01') {
          // Draw (画线或圆弧) — 从前一位置到当前位置
          if (regionMode) {
            if (isArc) {
              // 区域模式下圆弧：生成点序列
              const arcPoints = discretizeArc(prevX, prevY, currentX, currentY, offsetI, offsetJ, interpolation === 'ccw', multiQuadrant)
              regionPoints.push(...arcPoints)
            } else {
              regionPoints.push({ x: currentX, y: currentY })
            }
          } else {
            const ap = result.apertures[currentAperture]
            if (isArc) {
              const shape = {
                type: 'arc',
                startX: prevX,
                startY: prevY,
                endX: currentX,
                endY: currentY,
                offsetI,
                offsetJ,
                clockwise: interpolation === 'cw',
                multiQuadrant,
                width: ap ? ap.width : 0,
                aperture: currentAperture,
                polarity,
              }
              result.shapes.push(shape)
              updateArcBounds(result.bounds, shape)
            } else {
              const shape = {
                type: 'line',
                startX: prevX,
                startY: prevY,
                endX: currentX,
                endY: currentY,
                width: ap ? ap.width : 0,
                aperture: currentAperture,
                polarity,
                interpolation,
              }
              result.shapes.push(shape)
              updateBounds(result.bounds, shape)
            }
          }
        } else if (dCode === 'D03') {
          // Flash (放 pad)
          const ap = result.apertures[currentAperture]
          if (ap) {
            const shape = {
              type: 'flash',
              x: currentX,
              y: currentY,
              aperture: currentAperture,
              apertureShape: ap.shape,
              width: ap.width,
              height: ap.height,
              polarity,
            }
            result.shapes.push(shape)
            updateBounds(result.bounds, shape)
          }
          if (regionMode) regionPoints.push({ x: currentX, y: currentY })
        }

        continue
      }

    } catch (e) {
      result.errors.push(`行 ${i + 1}: ${e.message}`)
    }
  }

  // 修正 bounds（如果为空则设默认值）
  if (!isFinite(result.bounds.minX)) {
    result.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  }

  return result
}

/**
 * 解析 Excellon 钻孔文件
 */
export function parseDrill(content, filename = 'unknown') {
  const result = {
    filename,
    units: 'mm',
    holes: [],
    tools: {},
    bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    errors: [],
  }

  if (!content || typeof content !== 'string') return result

  const lines = content.split(/\r?\n/)
  let currentTool = null
  let inHeader = true
  let coordFormat = { xInt: 2, xDec: 4 } // 默认 2.4 格式
  let zeroMode = 'TZ'  // 默认 Trailing Zeros kept（Leading zeros suppressed）

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    try {
      // 零抑制模式
      if (line.includes(',LZ') || line.includes(' LZ')) {
        zeroMode = 'LZ' // Leading zeros kept, trailing zeros suppressed
        // 继续处理，可能同时包含单位信息
      }
      if (line.includes(',TZ') || line.includes(' TZ')) {
        zeroMode = 'TZ'
      }

      // 单位
      if (line.includes('INCH') || line.includes('M72')) { result.units = 'IN'; continue }
      if (line.includes('METRIC') || line.includes('M71') || line.includes('M004')) { result.units = 'MM'; continue }

      // Format:  FILE_FORMAT=2:4  或  FORMAT=2:4  或  2.4
      if (line.includes('FORMAT')) {
        const m = line.match(/(\d)[:\.](\d)/)
        if (m) { coordFormat.xInt = parseInt(m[1]); coordFormat.xDec = parseInt(m[2]) }
        continue
      }

      // Header start/end
      if (line === 'M48') {
        inHeader = true
        continue
      }
      if (line === '%' || line === 'M95') {
        inHeader = false
        continue
      }

      // 纯工具定义（仅在 header 中）: T01C0.60
      if (inHeader) {
        const toolMatch = line.match(/^T(\d+)C([\d.]+)/)
        if (toolMatch) {
          result.tools[`T${toolMatch[1]}`] = parseFloat(toolMatch[2])
          continue
        }
      }

      // 工具选择（body 中，可能带 feed/speed: T1C.045F139S55）
      const selToolMatch = line.match(/^(T\d+)(?:C[\d.]+)?/)
      if (selToolMatch && !line.includes('X')) {
        currentTool = selToolMatch[1]
        // 如果附带直径定义（如 T1C.045F139S55），同时更新工具定义
        const redefineMatch = line.match(/^T(\d+)C([\d.]+)/)
        if (redefineMatch) {
          result.tools[`T${redefineMatch[1]}`] = parseFloat(redefineMatch[2])
        }
        continue
      }

      // Coordinates X...Y...
      const coordMatch = line.match(/X([-\d]+)(?:Y([-\d]+))?/)
      if (coordMatch && currentTool) {
        const drillFormat = { ...coordFormat, zeroMode }
        const x = parseDrillCoord(coordMatch[1], drillFormat)
        const y = coordMatch[2] ? parseDrillCoord(coordMatch[2], drillFormat) : 0
        const diameter = result.tools[currentTool] || 0

        result.holes.push({
          x, y, diameter,
          tool: currentTool,
          plating: 'pth', // 默认 PTH
        })

        const r = diameter / 2
        result.bounds.minX = Math.min(result.bounds.minX, x - r)
        result.bounds.minY = Math.min(result.bounds.minY, y - r)
        result.bounds.maxX = Math.max(result.bounds.maxX, x + r)
        result.bounds.maxY = Math.max(result.bounds.maxY, y + r)
      }
    } catch (e) {
      result.errors.push(`行 ${i + 1}: ${e.message}`)
    }
  }

  if (!isFinite(result.bounds.minX)) {
    result.bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  }

  return result
}

/**
 * 批量解析所有文件
 */
export async function parseAllFiles(files, layerMap) {
  const layers = []
  let stackup = null

  for (const file of files) {
    const matched = layerMap.find(m => m.filename === file.name)
    const isDrill = matched?.layerType?.id === 'drl'
      || file.name.toLowerCase().match(/\.(drl|xnc|ncd)$/)

    const parsed = isDrill
      ? parseDrill(file.content, file.name)
      : parseGerber(file.content, file.name)

    layers.push({
      filename: file.name,
      content: file.content,
      size: file.size,
      layerType: matched?.layerType || null,
      parsed,
      isDrill: !!isDrill,
    })
  }

  // 生成合成板子视图（使用第一个有图形数据的层）
  return { layers, stackup }
}

// ========== 辅助函数 ==========

/**
 * 解析 Gerber 坐标字符串为数值
 * Gerber 坐标是没有小数点的定点数，如 "00100" 在 2.4 格式下 = 0.0100
 */
function parseCoord(str, format) {
  if (!str) return 0

  const num = parseInt(str, 10)
  if (isNaN(num)) return 0

  // 如果有格式信息，按格式解析
  if (format) {
    const divisor = Math.pow(10, format.xDec || 4)
    return num / divisor
  }

  // 自动检测：根据数字长度估算
  const len = str.replace(/^-/, '').length
  if (len === 6) return num / 10000  // 2.4 格式
  if (len === 7) return num / 100000 // 2.5 或 3.4 格式
  if (len === 5) return num / 1000   // 2.3 格式
  if (len === 8) return num / 1000000 // 3.5 格式
  return num / 10000 // 默认 2.4
}

/**
 * 解析钻孔坐标（支持 LZ/TZ 零抑制模式）
 * LZ 模式：前导零保留，尾零省略 → 需要补尾零
 * TZ 模式（默认）：尾零保留，前导零省略 → 需要补前导零
 */
function parseDrillCoord(str, format) {
  if (!str) return 0

  const isNegative = str.startsWith('-')
  const digits = isNegative ? str.slice(1) : str
  const totalExpected = (format.xInt || 2) + (format.xDec || 4)
  const divisor = Math.pow(10, format.xDec || 4)

  let padded
  if (format.zeroMode === 'LZ') {
    // LZ: 前导零保留，尾零省略 → 右侧补零
    padded = digits.padEnd(totalExpected, '0')
  } else {
    // TZ（默认）: 尾零保留，前导零省略 → 左侧补零
    padded = digits.padStart(totalExpected, '0')
  }

  const num = parseInt((isNegative ? '-' : '') + padded, 10)
  return isNaN(num) ? 0 : num / divisor
}

/**
 * 计算圆弧的几何参数（圆心、半径、起止角度）
 * @returns {{ cx, cy, radius, startAngle, endAngle, sweep }}
 */
function computeArcParams(startX, startY, endX, endY, offsetI, offsetJ, isCCW, multiQuad) {
  // I,J 是圆心相对于起点的偏移
  const cx = startX + offsetI
  const cy = startY + offsetJ
  const radius = Math.sqrt(offsetI * offsetI + offsetJ * offsetJ)

  let startAngle = Math.atan2(startY - cy, startX - cx)
  let endAngle = Math.atan2(endY - cy, endX - cx)

  // 确保扫过的角度方向正确
  if (isCCW) {
    // 逆时针：endAngle 应 > startAngle
    if (endAngle <= startAngle) endAngle += 2 * Math.PI
  } else {
    // 顺时针：endAngle 应 < startAngle
    if (endAngle >= startAngle) endAngle -= 2 * Math.PI
  }

  return { cx, cy, radius, startAngle, endAngle }
}

/**
 * 将圆弧离散为点序列（用于区域填充模式下的圆弧）
 */
function discretizeArc(startX, startY, endX, endY, offsetI, offsetJ, isCCW, multiQuad) {
  const { cx, cy, radius, startAngle, endAngle } = computeArcParams(startX, startY, endX, endY, offsetI, offsetJ, isCCW, multiQuad)

  // 计算弧长，决定采样点数
  let sweepAngle = Math.abs(endAngle - startAngle)
  if (sweepAngle > 2 * Math.PI) sweepAngle = 2 * Math.PI

  const steps = Math.max(8, Math.ceil(sweepAngle / (Math.PI / 36))) // 每5度一个点，最少8个
  const points = []

  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const angle = startAngle + (endAngle - startAngle) * t
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    })
  }

  return points
}

/**
 * 更新圆弧的边界框
 */
function updateArcBounds(bounds, shape) {
  const { cx, cy, radius, startAngle, endAngle } = computeArcParams(
    shape.startX, shape.startY, shape.endX, shape.endY,
    shape.offsetI, shape.offsetJ, !shape.clockwise, shape.multiQuadrant
  )

  // 检查 0°, 90°, 180°, 270° 四个极值角度是否在弧段范围内
  const extremes = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
  const points = [
    { x: shape.startX, y: shape.startY },
    { x: shape.endX, y: shape.endY },
  ]

  for (const angle of extremes) {
    // 将角度归一化到弧段范围内进行比较
    let a = angle
    // 判断该角度是否在 startAngle..endAngle 弧段内
    let normStart = startAngle
    let normEnd = endAngle
    let normA = a

    // 统一到同一圈
    while (normA < normStart) normA += 2 * Math.PI
    while (normA > normEnd + 0.001) {
      normA -= 2 * Math.PI
      if (normA < normStart - 0.001) break
    }

    if (normA >= normStart - 0.001 && normA <= normEnd + 0.001) {
      points.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
    }
  }

  const w = shape.width || 0
  for (const p of points) {
    bounds.minX = Math.min(bounds.minX, p.x - w / 2)
    bounds.minY = Math.min(bounds.minY, p.y - w / 2)
    bounds.maxX = Math.max(bounds.maxX, p.x + w / 2)
    bounds.maxY = Math.max(bounds.maxY, p.y + w / 2)
  }
}

/**
 * 更新边界框
 */
function updateBounds(bounds, shape) {
  let points = []

  switch (shape.type) {
    case 'line':
      points = [
        { x: shape.startX || shape.endX, y: shape.startY || shape.endY },
        { x: shape.endX, y: shape.endY },
      ]
      break
    case 'flash':
      points = [{ x: shape.x, y: shape.y }]
      break
    case 'polygon':
      points = shape.points || []
      break
  }

  for (const p of points) {
    bounds.minX = Math.min(bounds.minX, p.x)
    bounds.minY = Math.min(bounds.minY, p.y)
    bounds.maxX = Math.max(bounds.maxX, p.x)
    bounds.maxY = Math.max(bounds.maxY, p.y)
  }
}
