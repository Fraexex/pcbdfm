/**
 * PCB DFM 在线分析工具 - 主入口
 * 初始化所有模块，协调工作流
 */

import { initUpload } from './ui/upload.js'
import { BoardViewer } from './ui/viewer.js'
import { renderViolationList } from './ui/violations.js'
import { renderDashboard, renderLayerList, renderRuleConfig, renderParamsPanel } from './ui/dashboard.js'
import { identifyLayers } from './gerber/layer-id.js'
import { parseAllFiles } from './gerber/parser.js'
import { renderLayers } from './gerber/renderer.js'
import { runDfmAnalysis } from './dfm/engine.js'
import { generatePdfReport } from './report/pdf-builder.js'
import { DEFAULT_RULES, APP_STATES, MANUFACTURER_PRESETS } from './utils/constants.js'

class PCB_DFM_App {
  constructor() {
    this.state = APP_STATES.IDLE
    this.files = []         // 原始文件
    this.layerMap = []      // 层类型映射
    this.layers = []        // 解析后的层
    this.stackup = null     // 板层堆叠
    this.violations = []    // 违规列表
    this.summary = null     // 分析汇总
    this.viewer = null      // 查看器实例
    this.settings = {       // 规则设置
      traceWidth: DEFAULT_RULES.traceWidth.outerDefault,
      traceWidthInner: DEFAULT_RULES.traceWidth.innerDefault,
      traceClearance: DEFAULT_RULES.traceClearance.defaultValue,
      drillHoleSize: DEFAULT_RULES.drillHoleSize.defaultValue,
      annularRing: DEFAULT_RULES.annularRing.defaultValue,
      soldermaskWeb: DEFAULT_RULES.soldermaskWeb.defaultValue,
      copperToEdge: DEFAULT_RULES.copperToEdge.defaultValue,
    }
    this.currentPreset = '默认'  // 当前厂商标准预设

    this._init()
  }

  /**
   * 初始化应用
   */
  _init() {
    // 初始化上传
    initUpload(this)

    // 初始化查看器
    const wrapper = document.getElementById('svg-wrapper')
    this.viewer = new BoardViewer(wrapper)

    // 违规点击 → SVG 定位
    this.viewer.onViolationClick = (v) => {
      if (v.location) {
        this.viewer.panTo(v.location.x, v.location.y)
        this.viewer.highlightArea(v.location.x, v.location.y)
      }
    }

    // 工具栏按钮
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.viewer.zoomIn())
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.viewer.zoomOut())
    document.getElementById('btn-zoom-fit').addEventListener('click', () => this.viewer.fitToView())
    document.getElementById('btn-view-top').addEventListener('click', () => this._switchView('top'))
    document.getElementById('btn-view-bottom').addEventListener('click', () => this._switchView('bottom'))

    // 测量按钮
    document.getElementById('btn-measure').addEventListener('click', () => {
      this.viewer.toggleMeasure()
      document.getElementById('btn-measure').classList.toggle('active', this.viewer.measureMode)
    })

    // 分析按钮
    document.getElementById('btn-analyze').addEventListener('click', () => this._runAnalysis())

    // 报告按钮
    document.getElementById('btn-report').addEventListener('click', () => this._showReportTab())
    document.getElementById('btn-generate-pdf').addEventListener('click', () => this._generateReport())

    // 新建按钮
    document.getElementById('btn-new').addEventListener('click', () => this._reset())

    // TabBar 横向拖动
    this._initTabDrag()

    // 面板调整功能
    this._initResize()
    this._initPanelToggle()
    this._initSectionCollapse()

    // Tab 切换
    document.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'))
        document.querySelectorAll('.panel-content').forEach(c => c.style.display = 'none')
        tab.classList.add('active')
        const target = tab.getAttribute('data-tab')
        document.getElementById(`tab-${target}`).style.display = ''
      })
    })

    // 渲染规则配置
    this._renderRules()

    this.setStatus('就绪 — 请上传 Gerber 文件开始分析')

    this.setStatus('就绪 — 请上传 Gerber 文件开始分析')
  }

  /**
   * 加载 Gerber 文件（由 upload 模块调用）
   */
  async loadGerberFiles(files) {
    this.files = files
    this.showLoading('正在识别层类型...')

    try {
      // Step 1: 识别层类型
      this.layerMap = identifyLayers(files)
      this.setStatus(`已识别 ${this.layerMap.filter(m => m.layerType).length} 个层`)

      // Step 2: 解析 Gerber
      this.showLoading('正在解析 Gerber 文件...')
      const { layers, stackup } = await parseAllFiles(files, this.layerMap)
      this.layers = layers
      this.stackup = stackup

      // Step 3: 渲染 SVG
      this.showLoading('正在渲染 PCB 视图...')
      const wrapper = document.getElementById('svg-wrapper')
      const renderedLayers = layers.filter(l =>
        l.parsed && ((l.parsed.shapes?.length || 0) + (l.parsed.holes?.length || 0)) > 0
      )
      if (renderedLayers.length > 0) {
        renderLayers(renderedLayers, wrapper)
        // 重新初始化查看器
        const svg = wrapper.querySelector('svg')
        if (svg) {
          this.viewer.setSvg(svg)
        }
      }

      // Step 4: 显示 UI
      document.getElementById('upload-zone').style.display = 'none'
      document.getElementById('viewer-container').classList.add('active')
      document.getElementById('right-panel').classList.add('active')

      // 渲染层列表
      renderLayerList(layers, document.getElementById('layer-list'), (layerId, visible) => {
        this.viewer.toggleLayer(layerId, visible)
      })

      // 默认只显示顶层视图
      this._setDefaultView()

      // 设置测量工具单位
      this.viewer.rawUnit = layers[0]?.parsed?.units || 'MM'

      // 渲染参数列表
      renderParamsPanel(layers)

      // 更新状态
      const layerNames = layers
        .filter(l => l.layerType)
        .map(l => l.layerType.name)
        .join('、')

      this.setStatus(`已加载 ${layers.length} 层: ${layerNames}`)
      document.getElementById('status-info').textContent =
        `${layers.length} 层 · ${files.length} 文件`

      // 启用分析按钮
      document.getElementById('btn-analyze').disabled = false

      this.showToast(`成功加载 ${layers.length} 个 PCB 层`, 'success')

    } catch (err) {
      console.error('Gerber 处理失败:', err)
      this.showToast(`处理失败: ${err.message}`, 'error')
    } finally {
      this.hideLoading()
    }
  }

  /**
   * 运行 DFM 分析
   */
  async _runAnalysis() {
    if (!this.layers.length) return

    this.showLoading('正在执行 DFM 分析...')
    document.getElementById('btn-analyze').disabled = true

    try {
      const context = {
        layers: this.layers,
        stackup: this.stackup,
        geometry: {},
        settings: { ...this.settings },
        boardInfo: {},
      }

      const result = await runDfmAnalysis(context, (i, total, name) => {
        this.showLoading(`正在检查: ${name} (${i + 1}/${total})`)
      })

      this.violations = result.violations
      this.summary = result.summary

      // 渲染违规标记
      this.viewer.clearViolationMarkers()
      for (const v of this.violations) {
        this.viewer.addViolationMarker(v)
      }

      // 渲染仪表盘
      renderDashboard(
        this.summary,
        document.getElementById('dashboard-summary'),
        document.getElementById('rule-results')
      )

      // 渲染违规列表
      renderViolationList(
        this.violations,
        document.getElementById('violation-list'),
        (v) => {
          if (v.location) {
            this.viewer.panTo(v.location.x, v.location.y)
            this.viewer.highlightArea(v.location.x, v.location.y)
          }
        }
      )

      // 启用报告按钮
      document.getElementById('btn-report').disabled = false

      const statusText = this.summary.overallStatus === 'pass'
        ? '分析完成 — 全部通过'
        : this.summary.overallStatus === 'warning'
          ? `分析完成 — ${this.summary.totalWarnings} 个警告`
          : `分析完成 — ${this.summary.totalErrors} 个错误`

      this.setStatus(statusText)
      this.showToast(statusText, this.summary.overallStatus === 'pass' ? 'success' : 'warning')

    } catch (err) {
      console.error('DFM 分析失败:', err)
      this.showToast(`分析失败: ${err.message}`, 'error')
    } finally {
      document.getElementById('btn-analyze').disabled = false
      this.hideLoading()
    }
  }

  /**
   * 默认只显示顶层视图
   */
  _setDefaultView() {
    const visible = this._getViewLayers('top')
    const wrapper = document.getElementById('svg-wrapper')
    wrapper.querySelectorAll('[data-layer]').forEach(g => {
      const lid = g.getAttribute('data-layer')
      if (lid === 'violations') return
      g.style.display = visible.has(lid) ? '' : 'none'
    })
    document.querySelectorAll('.layer-toggle').forEach(cb => {
      cb.checked = visible.has(cb.getAttribute('data-layer'))
    })
  }

  /**
   * 获取某视角的可见层集合
   */
  _getViewLayers(side) {
    const shared = new Set(['out', 'drl', 'icu1', 'icu2'])
    const topOnly = new Set(['tcu', 'tsm', 'tss', 'tsp'])
    const bottomOnly = new Set(['bcu', 'bsm', 'bss', 'bsp'])
    if (side === 'top') {
      return new Set([...shared, ...topOnly])
    }
    return new Set([...shared, ...bottomOnly])
  }

  /**
   * 切换查看视角（层显隐方式，无需替换 SVG）
   */
  _switchView(view) {
    document.getElementById('btn-view-top').classList.toggle('active', view === 'top')
    document.getElementById('btn-view-bottom').classList.toggle('active', view === 'bottom')
    const visible = this._getViewLayers(view)
    const wrapper = document.getElementById('svg-wrapper')
    wrapper.querySelectorAll('[data-layer]').forEach(g => {
      const lid = g.getAttribute('data-layer')
      if (lid === 'violations') return
      g.style.display = visible.has(lid) ? '' : 'none'
    })
    document.querySelectorAll('.layer-toggle').forEach(cb => {
      cb.checked = visible.has(cb.getAttribute('data-layer'))
    })
  }

  /**
   * 显示报告 Tab
   */
  _showReportTab() {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.panel-content').forEach(c => c.style.display = 'none')
    document.querySelector('[data-tab="report"]').classList.add('active')
    document.getElementById('tab-report').style.display = ''
  }

  /**
   * 渲染规则配置（含预设下拉框）
   */
  _renderRules() {
    renderRuleConfig(
      this.settings,
      document.getElementById('rule-list'),
      (ruleId, value) => { this.settings[ruleId] = value },
      (presetName) => {
        const preset = MANUFACTURER_PRESETS[presetName]
        if (!preset) return
        this.currentPreset = presetName
        Object.assign(this.settings, preset)
        this._renderRules()
      },
      this.currentPreset
    )
  }

  /**
   * 生成 PDF 报告
   */
  async _generateReport() {
    if (!this.summary) {
      this.showToast('请先执行 DFM 分析', 'warning')
      return
    }

    this.showLoading('正在生成 PDF 报告...')

    try {
      const wrapper = document.getElementById('svg-wrapper')
      const svgElement = wrapper?.querySelector('svg')

      await generatePdfReport({
        layers: this.layers,
        summary: this.summary,
        violations: this.violations,
        boardInfo: {},
        settings: this.settings,
        svgElement,
      })

      this.showToast('PDF 报告已下载', 'success')
    } catch (err) {
      console.error('报告生成失败:', err)
      this.showToast(`报告生成失败: ${err.message}`, 'error')
    } finally {
      this.hideLoading()
    }
  }

  /**
   * 重置应用
   */
  _reset() {
    this.files = []
    this.layerMap = []
    this.layers = []
    this.stackup = null
    this.violations = []
    this.summary = null

    document.getElementById('upload-zone').style.display = ''
    document.getElementById('viewer-container').classList.remove('active')
    document.getElementById('right-panel').classList.remove('active')
    document.getElementById('right-panel').classList.remove('collapsed')
    document.getElementById('sidebar').classList.remove('collapsed')
    const resizeL = document.getElementById('resize-left')
    const resizeR = document.getElementById('resize-right')
    if (resizeL) resizeL.classList.remove('hidden')
    if (resizeR) resizeR.classList.remove('hidden')
    document.getElementById('btn-analyze').disabled = true
    document.getElementById('btn-report').disabled = true
    document.getElementById('svg-wrapper').innerHTML = ''
    document.getElementById('layer-list').innerHTML = ''
    document.getElementById('violation-list').innerHTML = ''
    document.getElementById('rule-results').innerHTML = ''
    document.getElementById('params-board-info').innerHTML = ''
    document.getElementById('params-layers').innerHTML = ''
    document.getElementById('params-stats').innerHTML = ''
    document.getElementById('status-info').textContent = ''

    // 重置 tab 到参数列表
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.panel-content').forEach(c => c.style.display = 'none')
    document.querySelector('[data-tab="params"]').classList.add('active')
    document.getElementById('tab-params').style.display = ''

    this.viewer.clearViolationMarkers()
    this.setStatus('就绪 — 请上传 Gerber 文件开始分析')
  }

  // ========== UI 辅助 ==========

  setStatus(text) {
    document.getElementById('status-text').textContent = text
  }

  showLoading(text) {
    const overlay = document.getElementById('loading-overlay')
    const loadingText = document.getElementById('loading-text')
    if (text) loadingText.textContent = text
    overlay.classList.add('active')
  }

  hideLoading() {
    document.getElementById('loading-overlay').classList.remove('active')
  }

  /**
   * TabBar 横向拖动支持
   */
  _initTabDrag() {
    const tabbar = document.getElementById('ui-tabbar')
    if (!tabbar) return

    let isDragging = false
    let startX = 0
    let scrollLeft = 0

    tabbar.addEventListener('mousedown', (e) => {
      isDragging = true
      startX = e.pageX - tabbar.offsetLeft
      scrollLeft = tabbar.scrollLeft
      tabbar.classList.add('dragging')
    })

    tabbar.addEventListener('mouseleave', () => {
      isDragging = false
      tabbar.classList.remove('dragging')
    })

    tabbar.addEventListener('mouseup', () => {
      isDragging = false
      tabbar.classList.remove('dragging')
    })

    tabbar.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      e.preventDefault()
      const x = e.pageX - tabbar.offsetLeft
      const walk = (x - startX) * 1.5
      tabbar.scrollLeft = scrollLeft - walk
    })
  }

  /**
   * 初始化面板拖拽调整宽度
   */
  _initResize() {
    const leftHandle = document.getElementById('resize-left')
    const rightHandle = document.getElementById('resize-right')
    const sidebar = document.getElementById('sidebar')
    const rightPanel = document.getElementById('right-panel')

    if (leftHandle) {
      this._setupResize(leftHandle, sidebar, 180, 400, 'left')
    }
    if (rightHandle) {
      this._setupResize(rightHandle, rightPanel, 240, 500, 'right')
    }
  }

  _setupResize(handle, panel, minW, maxW, side) {
    let startX, startW

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault()
      startX = e.clientX
      startW = panel.offsetWidth
      handle.classList.add('active')

      const onMove = (e) => {
        const dx = e.clientX - startX
        const newW = side === 'left' ? startW + dx : startW - dx
        const clamped = Math.max(minW, Math.min(maxW, newW))
        panel.style.width = clamped + 'px'
        panel.style.minWidth = clamped + 'px'
      }

      const onUp = () => {
        handle.classList.remove('active')
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  /**
   * 初始化面板折叠/展开
   */
  _initPanelToggle() {
    const sidebar = document.getElementById('sidebar')
    const rightPanel = document.getElementById('right-panel')
    const resizeLeft = document.getElementById('resize-left')
    const resizeRight = document.getElementById('resize-right')
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar')
    const btnTogglePanel = document.getElementById('btn-toggle-panel')

    if (btnToggleSidebar) {
      btnToggleSidebar.classList.add('active')
      btnToggleSidebar.addEventListener('click', () => {
        const isCollapsed = sidebar.classList.toggle('collapsed')
        if (resizeLeft) resizeLeft.classList.toggle('hidden', isCollapsed)
        btnToggleSidebar.classList.toggle('active', !isCollapsed)
      })
    }

    if (btnTogglePanel) {
      btnTogglePanel.addEventListener('click', () => {
        // right panel not shown yet
        if (!rightPanel.classList.contains('active') && !rightPanel.classList.contains('collapsed')) return
        const isCollapsed = rightPanel.classList.toggle('collapsed')
        if (resizeRight) resizeRight.classList.toggle('hidden', isCollapsed)
        btnTogglePanel.classList.toggle('active', !isCollapsed)
      })
    }
  }

  /**
   * 初始化侧边栏 Section 折叠
   */
  _initSectionCollapse() {
    document.querySelectorAll('.sidebar-section .section-title').forEach(title => {
      title.addEventListener('click', () => {
        title.parentElement.classList.toggle('collapsed')
      })
    })
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container')
    const toast = document.createElement('div')
    toast.className = `toast ${type}`
    toast.textContent = message
    container.appendChild(toast)

    setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transition = 'opacity 0.3s'
      setTimeout(() => toast.remove(), 300)
    }, 3000)
  }
}

// 启动应用
const app = new PCB_DFM_App()
