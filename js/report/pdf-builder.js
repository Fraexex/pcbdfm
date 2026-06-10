/**
 * PCB DFM 工具 - PDF 报告生成器
 * 使用 PDFMake 在浏览器端生成 DFM 分析报告
 */

import pdfMake from 'pdfmake'
import 'pdfmake/build/vfs_fonts'
import { captureSvgToPng, dataUrlToBase64 } from './svg-capture.js'
import { SEVERITY_LABELS } from '../utils/constants.js'
import { milToMm, formatSizeWithUnit } from '../utils/units.js'

/**
 * 生成 DFM 分析 PDF 报告
 * @param {object} data - 报告数据
 * @param {Array} data.layers - 层列表
 * @param {object} data.summary - DFM 分析汇总
 * @param {Array} data.violations - 违规列表
 * @param {object} data.boardInfo - 板子信息
 * @param {object} data.settings - 规则设置
 * @param {SVGElement} data.svgElement - 查看器的 SVG 元素
 */
export async function generatePdfReport(data) {
  const { layers, summary, violations, boardInfo, settings, svgElement } = data

  // 截取 SVG 截图
  let boardImage = null
  if (svgElement) {
    try {
      boardImage = await captureSvgToPng(svgElement, { width: 600, height: 400, scale: 2 })
    } catch (e) {
      console.warn('截图失败:', e)
    }
  }

  // 构建文档定义
  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],

    // 页眉
    header: {
      text: 'PCB DFM 可制造性分析报告',
      alignment: 'right',
      margin: [40, 20, 40, 0],
      fontSize: 8,
      color: '#999999',
    },

    // 页脚
    footer: (currentPage, pageCount) => ({
      text: `第 ${currentPage} 页 / 共 ${pageCount} 页`,
      alignment: 'center',
      fontSize: 8,
      color: '#999999',
    }),

    content: [
      // ====== 封面 ======
      { text: 'PCB DFM 分析报告', style: 'title' },
      { text: '可制造性设计检查报告', style: 'subtitle' },
      { text: '\n' },

      // 总体状态
      {
        text: `总体评估: ${summary.overallStatus === 'pass' ? '通过' : summary.overallStatus === 'warning' ? '存在警告' : '存在问题'}`,
        style: summary.overallStatus === 'pass' ? 'statusPass' : summary.overallStatus === 'warning' ? 'statusWarning' : 'statusFail',
      },
      { text: '\n' },

      // 基础信息表
      {
        table: {
          headerRows: 1,
          widths: ['*', '*'],
          body: [
            [{ text: '项目', style: 'tableHeader' }, { text: '信息', style: 'tableHeader' }],
            ['报告日期', new Date().toLocaleDateString('zh-CN')],
            ['检查规则数', `${summary.totalRules} 项`],
            ['错误', `${summary.totalErrors} 项`],
            ['警告', `${summary.totalWarnings} 项`],
            ['提示', `${summary.totalInfo} 项`],
            ['PCB 层数', `${layers.length} 层`],
          ],
        },
        layout: 'lightHorizontalLines',
      },
      { text: '\n\n' },

      // ====== 板子渲染图 ======
      { text: '1. PCB 层渲染图', style: 'sectionTitle' },
      { text: '\n' },

      ...(boardImage ? [{
        image: boardImage,
        width: 450,
        alignment: 'center',
      }] : [{ text: '（渲染图不可用）', color: '#999' }]),
      { text: '\n\n' },

      // ====== 层信息 ======
      { text: '2. 层文件清单', style: 'sectionTitle' },
      { text: '\n' },
      {
        table: {
          headerRows: 1,
          widths: ['*', '*', 'auto'],
          body: [
            [
              { text: '文件名', style: 'tableHeader' },
              { text: '层类型', style: 'tableHeader' },
              { text: '状态', style: 'tableHeader' },
            ],
            ...layers.map(l => [
              l.filename || '-',
              l.layerType?.name || '未识别',
              l.error ? '解析失败' : '正常',
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      { text: '\n\n' },

      // ====== DFM 分析结果汇总 ======
      { text: '3. DFM 检查结果汇总', style: 'sectionTitle' },
      { text: '\n' },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto', 'auto'],
          body: [
            [
              { text: '检查项目', style: 'tableHeader' },
              { text: '结果', style: 'tableHeader' },
              { text: '错误', style: 'tableHeader' },
              { text: '警告', style: 'tableHeader' },
              { text: '提示', style: 'tableHeader' },
            ],
            ...summary.ruleResults.map(r => [
              r.name,
              r.status === 'pass' ? '通过' : r.status === 'warning' ? '警告' : '未通过',
              String(r.errorCount),
              String(r.warningCount),
              String(r.infoCount),
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      { text: '\n\n' },

      // ====== 违规详情 ======
      ...(violations.length > 0 ? [
        { text: '4. 违规详情', style: 'sectionTitle' },
        { text: '\n' },
        ...violations.map((v, i) => [
          {
            text: `4.${i + 1} ${v.ruleName}`,
            style: 'violationTitle',
            margin: [0, 8, 0, 4],
          },
          {
            table: {
              widths: ['auto', '*'],
              body: [
                ['严重程度', SEVERITY_LABELS[v.severity] || v.severity],
                ['描述', v.message],
                ...(v.suggestion ? [['改进建议', v.suggestion]] : []),
                ...(v.location ? [['位置', `(${v.location.x.toFixed(2)}, ${v.location.y.toFixed(2)})`]] : []),
              ],
            },
            layout: 'noBorders',
            margin: [10, 0, 0, 4],
          },
        ]).flat(),
      ] : [
        { text: '4. 违规详情', style: 'sectionTitle' },
        { text: '\n无违规项。', color: '#34d399' },
      ]),
      { text: '\n\n' },

      // ====== 附录：规则阈值 ======
      { text: '5. 附录：规则阈值设置', style: 'sectionTitle' },
      { text: '\n' },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto'],
          body: [
            [
              { text: '规则名称', style: 'tableHeader' },
              { text: '当前值', style: 'tableHeader' },
              { text: '单位', style: 'tableHeader' },
            ],
            ...Object.entries(settings || {}).map(([key, val]) => [
              getRuleName(key),
              String(val),
              'mil',
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
    ],

    // 样式定义
    styles: {
      title: {
        fontSize: 22,
        bold: true,
        color: '#1a1a2e',
        margin: [0, 0, 0, 4],
      },
      subtitle: {
        fontSize: 12,
        color: '#666666',
        margin: [0, 0, 0, 8],
      },
      sectionTitle: {
        fontSize: 14,
        bold: true,
        color: '#2d3436',
        margin: [0, 8, 0, 4],
      },
      tableHeader: {
        bold: true,
        fontSize: 10,
        color: '#ffffff',
        fillColor: '#2d3436',
      },
      violationTitle: {
        fontSize: 11,
        bold: true,
        color: '#2d3436',
      },
      statusPass: {
        fontSize: 14,
        bold: true,
        color: '#27ae60',
      },
      statusWarning: {
        fontSize: 14,
        bold: true,
        color: '#f39c12',
      },
      statusFail: {
        fontSize: 14,
        bold: true,
        color: '#e74c3c',
      },
    },

    defaultStyle: {
      fontSize: 10,
      color: '#333333',
    },
  }

  // 生成并下载 PDF
  try {
    const pdfDoc = pdfMake.createPdf(docDefinition)
    pdfDoc.download(`DFM分析报告_${new Date().toISOString().slice(0, 10)}.pdf`)
  } catch (err) {
    console.error('PDF 生成错误:', err)
    throw err
  }
}

/**
 * 获取规则名称
 */
function getRuleName(key) {
  const names = {
    traceWidth: '最小线宽（外层）',
    traceWidthInner: '最小线宽（内层）',
    traceClearance: '线距/铜间距',
    drillHoleSize: '最小钻孔尺寸',
    annularRing: '焊盘环宽',
    soldermaskWeb: '阻焊桥宽度',
    copperToEdge: '铜皮到板边距',
  }
  return names[key] || key
}
