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

      // 格式规范  %FSLAX44Y44*%  或  %FSLAX24Y24*%
      if (line.startsWith('%FS')) {
        const m = line.match(/X(\d)(\d)Y\1\2/i)
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
        const code = addMatch[1]
        const shape = addMatch[2].toUpperCase()
        const size1 = parseFloat(addMatch[3]) || 0
        const size2 = addMatch[4] ? parseFloat(addMatch[4]) : size1
        result.apertures[code] = { shape, width: size1, height: size2 }
        continue
      }

      // Aperture Macro (简化：跳过)
      if (line.startsWith('%AM')) continue

      // 选择 aperture Dnn*
      const selMatch = line.match(/^D(\d+)\*$/)
      if (selMatch) {
        currentAperture = selMatch[1]
        continue
      }

      // G codes
      if (line === 'G01*' || line.startsWith('G01')) { interpolation = 'linear'; continue }
      if (line === 'G02*' || line.startsWith('G02')) { interpolation = 'cw'; continue }
      if (line === 'G03*' || line.startsWith('G03')) { interpolation = 'ccw'; continue }
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

      // M code
      if (line.startsWith('M02') || line.startsWith('M2')) continue

      // 坐标命令
      const cmdMatch = line.match(/^(?:G0?[123]\*?)?(X([-\d]+))?(Y([-\d]+))?(?:I([-\d]+))?(?:J([-\d]+))?\s*(D0[123])?\*$/)
      if (cmdMatch) {
        const rawX = cmdMatch[2]
        const rawY = cmdMatch[4]
        const dCode = cmdMatch[7] || ''

        // 保存前一位置（startX/startY 需要它）
        const prevX = currentX
        const prevY = currentY

        if (rawX !== undefined) {
          currentX = parseCoord(rawX, result.format)
        }
        if (rawY !== undefined) {
          currentY = parseCoord(rawY, result.format)
        }

        if (dCode === 'D02') {
          // Move (不画线)
          if (regionMode) regionPoints.push({ x: currentX, y: currentY })
        } else if (dCode === 'D01') {
          // Draw (画线) — 从前一位置到当前位置
          if (regionMode) {
            regionPoints.push({ x: currentX, y: currentY })
          } else {
            const ap = result.apertures[currentAperture]
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    try {
      // 单位
      if (line.includes('INCH') || line.includes('M72')) { result.units = 'IN'; continue }
      if (line.includes('METRIC') || line.includes('M71') || line.includes('M004')) { result.units = 'MM'; continue }

      // Format:  FILE_FORMAT=2:4  或  FORMAT=2:4  或  2.4
      if (line.includes('FORMAT')) {
        const m = line.match(/(\d)[:\.](\d)/)
        if (m) { coordFormat.xInt = parseInt(m[1]); coordFormat.xDec = parseInt(m[2]) }
        continue
      }

      // Header end
      if (line === '%' || line === 'M95' || line === 'M48') {
        inHeader = false
        continue
      }

      // Tool definition T01C0.60
      const toolMatch = line.match(/^T(\d+)C([\d.]+)/)
      if (toolMatch) {
        result.tools[`T${toolMatch[1]}`] = parseFloat(toolMatch[2])
        continue
      }

      // Select tool T01
      const selMatch = line.match(/^(T\d+)/)
      if (selMatch && !line.includes('X')) {
        currentTool = selMatch[1]
        continue
      }

      // Coordinates X...Y...
      const coordMatch = line.match(/X([-\d]+)(?:Y([-\d]+))?/)
      if (coordMatch && currentTool) {
        const x = parseCoord(coordMatch[1], coordFormat)
        const y = coordMatch[2] ? parseCoord(coordMatch[2], coordFormat) : 0
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
      || file.name.toLowerCase().match(/\.(drl|xnc)$/)

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
