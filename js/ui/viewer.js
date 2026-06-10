/**
 * PCB DFM 工具 - SVG 交互查看器
 * 支持缩放、平移、层切换
 */

export class BoardViewer {
  constructor(container) {
    this.container = container
    this.svg = null
    this.scale = 1
    this.translateX = 0
    this.translateY = 0
    this.isDragging = false
    this.startX = 0
    this.startY = 0
    this.activeLayers = new Set()
    this.viewMode = 'top' // top | bottom
    this.onViolationClick = null

    // Measure mode
    this.measureMode = false
    this.measurePoints = []
    this.rawUnit = 'MM' // set by app.js after loading

    this._bindEvents()
  }

  /**
   * 设置 SVG 内容
   */
  setSvg(svgElement) {
    this.svg = svgElement
    this.fitToView()
  }

  /**
   * 适应窗口大小
   */
  fitToView() {
    this.scale = 1
    this.translateX = 0
    this.translateY = 0
    this._updateTransform()
  }

  /**
   * 放大
   */
  zoomIn(factor = 1.3) {
    this.scale *= factor
    this._clampScale()
    this._updateTransform()
  }

  /**
   * 缩小
   */
  zoomOut(factor = 1.3) {
    this.scale /= factor
    this._clampScale()
    this._updateTransform()
  }

  /**
   * 缩放到指定点
   */
  zoomToPoint(x, y, factor) {
    const rect = this.container.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2

    this.translateX = x - (x - this.translateX) * factor
    this.translateY = y - (y - this.translateY) * factor
    this.scale *= factor
    this._clampScale()
    this._updateTransform()
  }

  /**
   * 切换层可见性
   */
  toggleLayer(layerId, visible) {
    if (visible) {
      this.activeLayers.add(layerId)
    } else {
      this.activeLayers.delete(layerId)
    }

    const group = this.container.querySelector(`[data-layer="${layerId}"]`)
    if (group) {
      group.style.display = visible ? '' : 'none'
    }
  }

  /**
   * 定位到指定坐标 (用于违规定位)
   */
  panTo(x, y, zoomLevel = 5) {
    this.scale = zoomLevel
    this.translateX = -x * this.scale
    this.translateY = -y * this.scale
    this._updateTransform()
  }

  /**
   * 高亮指定区域
   */
  highlightArea(x, y, radius = 2) {
    // 移除旧高亮
    this.clearHighlights()

    const ns = 'http://www.w3.org/2000/svg'
    const highlight = document.createElementNS(ns, 'circle')
    highlight.setAttribute('cx', x)
    highlight.setAttribute('cy', y)
    highlight.setAttribute('r', radius)
    highlight.setAttribute('fill', 'none')
    highlight.setAttribute('stroke', '#ef4444')
    highlight.setAttribute('stroke-width', radius * 0.15)
    highlight.setAttribute('stroke-dasharray', `${radius * 0.3} ${radius * 0.2}`)
    highlight.classList.add('highlight-marker')

    const violationLayer = this.container.querySelector('[data-layer="violations"]')
    if (violationLayer) {
      violationLayer.appendChild(highlight)
    }
  }

  /**
   * 清除所有高亮
   */
  clearHighlights() {
    const highlights = this.container.querySelectorAll('.highlight-marker')
    highlights.forEach(h => h.remove())
  }

  /**
   * 添加违规标记到 SVG
   */
  addViolationMarker(violation) {
    if (!violation.location) return

    const ns = 'http://www.w3.org/2000/svg'
    const marker = document.createElementNS(ns, 'g')
    marker.setAttribute('class', 'violation-marker')
    marker.setAttribute('data-violation-id', violation.id)
    marker.style.cursor = 'pointer'

    // 外圈
    const outerCircle = document.createElementNS(ns, 'circle')
    outerCircle.setAttribute('cx', violation.location.x)
    outerCircle.setAttribute('cy', violation.location.y)
    outerCircle.setAttribute('r', 1.5)
    outerCircle.setAttribute('fill', 'none')
    outerCircle.setAttribute('stroke', violation.severity === 'error' ? '#ef4444' : '#fbbf24')
    outerCircle.setAttribute('stroke-width', '0.2')
    outerCircle.setAttribute('opacity', '0.8')

    // 内圈
    const innerCircle = document.createElementNS(ns, 'circle')
    innerCircle.setAttribute('cx', violation.location.x)
    innerCircle.setAttribute('cy', violation.location.y)
    innerCircle.setAttribute('r', 0.3)
    innerCircle.setAttribute('fill', violation.severity === 'error' ? '#ef4444' : '#fbbf24')
    innerCircle.setAttribute('opacity', '0.9')

    marker.appendChild(outerCircle)
    marker.appendChild(innerCircle)

    // 点击事件
    marker.addEventListener('click', () => {
      if (this.onViolationClick) {
        this.onViolationClick(violation)
      }
    })

    const violationLayer = this.container.querySelector('[data-layer="violations"]')
    if (violationLayer) {
      violationLayer.appendChild(marker)
    }
  }

  /**
   * 清除所有违规标记
   */
  clearViolationMarkers() {
    const violationLayer = this.container.querySelector('[data-layer="violations"]')
    if (violationLayer) {
      violationLayer.innerHTML = ''
    }
  }

  // ========== 测量功能 ==========

  /**
   * 切换测量模式
   */
  toggleMeasure() {
    this.measureMode = !this.measureMode
    this.container.classList.toggle('measure-mode', this.measureMode)
    if (!this.measureMode) {
      this._clearMeasure()
    }
  }

  /**
   * 屏幕坐标转 Gerber 坐标
   */
  screenToGerber(clientX, clientY) {
    const svg = this.container.querySelector('svg')
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const svgPt = pt.matrixTransform(ctm.inverse())
    return { x: svgPt.x, y: svgPt.y }
  }

  /**
   * 获取或创建测量层
   */
  _getMeasureLayer() {
    let layer = this.container.querySelector('[data-layer="measure"]')
    if (!layer) {
      const ns = 'http://www.w3.org/2000/svg'
      layer = document.createElementNS(ns, 'g')
      layer.setAttribute('data-layer', 'measure')
      const svg = this.container.querySelector('svg')
      if (svg) svg.appendChild(layer)
    }
    return layer
  }

  /**
   * 处理测量点击
   */
  _handleMeasureClick(e) {
    if (!this.measureMode) return
    const coord = this.screenToGerber(e.clientX, e.clientY)
    if (!coord) return

    this.measurePoints.push(coord)

    const layer = this._getMeasureLayer()
    const ns = 'http://www.w3.org/2000/svg'

    if (this.measurePoints.length === 1) {
      // First point: draw marker
      this._drawMeasurePoint(layer, coord.x, coord.y)
    } else if (this.measurePoints.length === 2) {
      // Second point: draw final measurement
      const p1 = this.measurePoints[0]
      const p2 = this.measurePoints[1]
      this._clearMeasure()
      this._drawMeasureResult(layer, p1, p2)
      this.measurePoints = [] // reset for next measurement
    }
  }

  /**
   * 获取合适的测量标记尺寸（基于板子尺寸动态缩放）
   */
  _getMeasureScale() {
    const svg = this.container.querySelector('svg')
    if (!svg) return { point: 0.05, line: 0.03, font: 0.15 }
    const vb = svg.getAttribute('viewBox')
    if (!vb) return { point: 0.05, line: 0.03, font: 0.15 }
    const parts = vb.split(' ').map(Number)
    const boardSize = Math.max(parts[2], parts[3])
    // Scale: markers ~1.5% of board size
    return {
      point: boardSize * 0.008,
      line: boardSize * 0.004,
      font: boardSize * 0.035,
    }
  }

  /**
   * 绘制测量点标记
   */
  _drawMeasurePoint(layer, x, y) {
    const ns = 'http://www.w3.org/2000/svg'
    const s = this._getMeasureScale()
    const circle = document.createElementNS(ns, 'circle')
    circle.setAttribute('cx', x)
    circle.setAttribute('cy', y)
    circle.setAttribute('r', s.point)
    circle.setAttribute('fill', '#4a9eff')
    circle.setAttribute('class', 'measure-el')
    layer.appendChild(circle)
  }

  /**
   * 绘制最终测量结果（线段 + 距离标签）
   */
  _drawMeasureResult(layer, p1, p2) {
    const ns = 'http://www.w3.org/2000/svg'
    const isInch = this.rawUnit === 'IN'
    const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
    const mm = isInch ? dist * 25.4 : dist
    const mil = isInch ? dist * 1000 : dist / 0.0254

    // Two endpoint markers
    this._drawMeasurePoint(layer, p1.x, p1.y)
    this._drawMeasurePoint(layer, p2.x, p2.y)

    // Measurement line
    const s = this._getMeasureScale()
    const line = document.createElementNS(ns, 'line')
    line.setAttribute('x1', p1.x)
    line.setAttribute('y1', p1.y)
    line.setAttribute('x2', p2.x)
    line.setAttribute('y2', p2.y)
    line.setAttribute('stroke', '#4a9eff')
    line.setAttribute('stroke-width', s.line)
    line.setAttribute('stroke-dasharray', `${s.line * 4},${s.line * 2}`)
    line.setAttribute('class', 'measure-el')
    layer.appendChild(line)

    // Distance label at midpoint
    const mx = (p1.x + p2.x) / 2
    const my = (p1.y + p2.y) / 2
    const label = document.createElementNS(ns, 'text')
    label.setAttribute('x', mx)
    label.setAttribute('y', my)
    label.setAttribute('fill', '#4a9eff')
    label.setAttribute('font-size', s.font)
    label.setAttribute('font-family', 'sans-serif')
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('dominant-baseline', 'hanging')
    label.setAttribute('class', 'measure-el')
    // Background rect for readability
    const labelText = `${mm.toFixed(3)} mm (${mil.toFixed(1)} mil)`
    label.textContent = labelText

    // Background rect
    const bg = document.createElementNS(ns, 'rect')
    const textLen = labelText.length * s.font * 0.5
    bg.setAttribute('x', mx - textLen / 2)
    bg.setAttribute('y', my - s.font * 0.2)
    bg.setAttribute('width', textLen)
    bg.setAttribute('height', s.font * 1.4)
    bg.setAttribute('rx', s.font * 0.2)
    bg.setAttribute('fill', 'rgba(15,17,23,0.85)')
    bg.setAttribute('class', 'measure-el')
    layer.appendChild(bg)
    layer.appendChild(label)
  }

  /**
   * 清除测量标记
   */
  _clearMeasure() {
    this.measurePoints = []
    const layer = this.container.querySelector('[data-layer="measure"]')
    if (layer) layer.innerHTML = ''
  }

  // ========== 内部方法 ==========

  _bindEvents() {
    // 鼠标滚轮缩放
    this.container.addEventListener('wheel', e => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.85 : 1.18
      const rect = this.container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      this.zoomToPoint(x, y, factor)
    }, { passive: false })

    // 鼠标拖拽平移
    this.container.addEventListener('mousedown', e => {
      if (e.button !== 0) return
      if (this.measureMode) {
        this._handleMeasureClick(e)
        return
      }
      this.isDragging = true
      this.startX = e.clientX - this.translateX
      this.startY = e.clientY - this.translateY
      this.container.style.cursor = 'grabbing'
    })

    document.addEventListener('mousemove', e => {
      if (!this.isDragging) return
      this.translateX = e.clientX - this.startX
      this.translateY = e.clientY - this.startY
      this._updateTransform()
    })

    document.addEventListener('mouseup', () => {
      this.isDragging = false
      this.container.style.cursor = 'grab'
    })

    // 触摸支持
    let lastTouchDist = 0
    this.container.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this.isDragging = true
        this.startX = e.touches[0].clientX - this.translateX
        this.startY = e.touches[0].clientY - this.translateY
      } else if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
      }
    }, { passive: true })

    this.container.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && this.isDragging) {
        this.translateX = e.touches[0].clientX - this.startX
        this.translateY = e.touches[0].clientY - this.startY
        this._updateTransform()
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        if (lastTouchDist > 0) {
          const factor = dist / lastTouchDist
          this.scale *= factor
          this._clampScale()
          this._updateTransform()
        }
        lastTouchDist = dist
      }
    }, { passive: true })

    this.container.addEventListener('touchend', () => {
      this.isDragging = false
      lastTouchDist = 0
    })

    // ESC退出测量模式
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.measureMode) {
        this.toggleMeasure()
        const btn = document.getElementById('btn-measure')
        if (btn) btn.classList.remove('active')
      }
    })
  }

  _updateTransform() {
    const svg = this.container.querySelector('svg')
    if (!svg) return

    svg.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`
    svg.style.transformOrigin = '0 0'
  }

  _clampScale() {
    this.scale = Math.max(0.1, Math.min(100, this.scale))
  }
}
