/**
 * PCB DFM 工具 - 文件上传处理
 */

import JSZip from 'jszip'

/**
 * 初始化上传区
 */
export function initUpload(app) {
  const dropArea = document.getElementById('drop-area')
  const fileInput = document.getElementById('file-input')

  // 拖拽事件
  ;['dragenter', 'dragover'].forEach(evt => {
    dropArea.addEventListener(evt, e => {
      e.preventDefault()
      e.stopPropagation()
      dropArea.classList.add('drag-over')
    })
  })

  ;['dragleave', 'drop'].forEach(evt => {
    dropArea.addEventListener(evt, e => {
      e.preventDefault()
      e.stopPropagation()
      dropArea.classList.remove('drag-over')
    })
  })

  dropArea.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer.files)
    handleFiles(files, app)
  })

  // 点击选择文件
  dropArea.addEventListener('click', () => {
    fileInput.click()
  })

  fileInput.addEventListener('change', e => {
    const files = Array.from(e.target.files)
    handleFiles(files, app)
    fileInput.value = '' // 重置，允许重复选择
  })
}

/**
 * 处理上传的文件
 */
async function handleFiles(files, app) {
  if (!files.length) return

  app.setStatus('正在读取文件...')
  app.showLoading('正在读取文件...')

  try {
    const gerberFiles = []

    for (const file of files) {
      if (file.name.endsWith('.zip')) {
        // 解压 ZIP
        const zipFiles = await extractZip(file)
        gerberFiles.push(...zipFiles)
      } else if (isGerberFile(file.name)) {
        // 直接读取 Gerber 文件
        const content = await readFileAsText(file)
        gerberFiles.push({ name: file.name, content, size: file.size })
      }
    }

    if (gerberFiles.length === 0) {
      app.showToast('未找到有效的 Gerber 文件', 'error')
      return
    }

    app.setStatus(`已加载 ${gerberFiles.length} 个文件，正在解析...`)
    await app.loadGerberFiles(gerberFiles)

  } catch (err) {
    console.error('文件处理失败:', err)
    app.showToast(`文件处理失败: ${err.message}`, 'error')
  } finally {
    app.hideLoading()
  }
}

/**
 * 解压 ZIP 文件（支持嵌套 ZIP）
 */
async function extractZip(zipFile) {
  const buffer = zipFile instanceof ArrayBuffer ? zipFile : await readFileAsArrayBuffer(zipFile)
  const zip = await JSZip.loadAsync(buffer)

  const files = []
  const entries = Object.entries(zip.files)

  for (const [path, entry] of entries) {
    // 跳过目录和 macOS 元数据
    if (entry.dir || path.startsWith('__MACOSX') || path.startsWith('.'))
      continue

    const name = path.split('/').pop()

    // 如果是嵌套 ZIP，递归解压
    if (name.toLowerCase().endsWith('.zip')) {
      const innerBuffer = await entry.async('arraybuffer')
      const innerFiles = await extractZip(innerBuffer)
      files.push(...innerFiles)
      continue
    }

    if (isGerberFile(name)) {
      const content = await entry.async('string')
      files.push({ name, content, size: content.length })
    }
  }

  return files
}

/**
 * 判断是否为 Gerber 相关文件
 */
function isGerberFile(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  const gerberExts = [
    'gbr', 'gtl', 'gbl', 'gbo', 'gto', 'gbs', 'gts', 'gko',
    'gml', 'gm1', 'gdo', 'gdd', 'xnc', 'drl', 'rou',
    'top', 'bot', 'smt', 'smb', 'sst', 'ssb', 'out', 'outline',
    'phd', 'dri', 'rep', 'crc',
  ]
  // 也检查文件名中常见的 Gerber 关键字
  const gerberNames = [
    'gerber', 'copper', 'silk', 'solder', 'paste', 'drill',
    'outline', 'board', 'top', 'bottom', 'inner',
  ]

  if (gerberExts.includes(ext)) return true

  const lowerName = filename.toLowerCase()
  return gerberNames.some(k => lowerName.includes(k))
}

/**
 * 读取文件为文本
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`))
    reader.readAsText(file)
  })
}

/**
 * 读取文件为 ArrayBuffer
 */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`))
    reader.readAsArrayBuffer(file)
  })
}
