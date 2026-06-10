/**
 * PCB DFM 工具 - SVG 截图工具
 * 将 SVG 元素渲染到 Canvas，导出为 PNG base64
 */

/**
 * 将 SVG 元素截图为 PNG
 * @param {SVGElement} svg - SVG DOM 元素
 * @param {object} options - { width, height, scale }
 * @returns {Promise<string>} - PNG base64 data URL
 */
export function captureSvgToPng(svg, options = {}) {
  const {
    width = 800,
    height = 600,
    scale = 2, // 2x for retina
  } = options

  return new Promise((resolve, reject) => {
    if (!svg) {
      reject(new Error('SVG 元素不存在'))
      return
    }

    // 克隆 SVG
    const clone = svg.cloneNode(true)

    // 设置尺寸
    clone.setAttribute('width', width)
    clone.setAttribute('height', height)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

    // 序列化为字符串
    const serializer = new XMLSerializer()
    let svgString = serializer.serializeToString(clone)

    // 添加 XML 声明
    svgString = '<?xml version="1.0" encoding="UTF-8"?>' + svgString

    // 创建 Image
    const img = new Image()
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale

      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#0f1117'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0, width, height)

      URL.revokeObjectURL(url)

      const dataUrl = canvas.toDataURL('image/png')
      resolve(dataUrl)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 渲染失败'))
    }

    img.src = url
  })
}

/**
 * 将 SVG 字符串截图为 PNG
 * @param {string} svgString - SVG 字符串内容
 * @param {object} options - { width, height, scale }
 * @returns {Promise<string>}
 */
export function captureSvgStringToPng(svgString, options = {}) {
  const {
    width = 800,
    height = 600,
    scale = 2,
  } = options

  return new Promise((resolve, reject) => {
    const img = new Image()
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale

      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#0f1117'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0, width, height)

      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 渲染失败'))
    }

    img.src = url
  })
}

/**
 * 将 data URL 转为 base64 纯数据（去掉前缀）
 */
export function dataUrlToBase64(dataUrl) {
  return dataUrl.replace(/^data:image\/png;base64,/, '')
}
