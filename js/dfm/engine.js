/**
 * PCB DFM 工具 - DFM 引擎编排器
 * 依次运行所有 DFM 检查规则，收集违规结果
 */

import { ALL_RULES } from './rules.js'

/**
 * 运行完整的 DFM 分析
 * @param {object} context - 检查上下文
 * @param {Array} context.layers - 已解析的层列表
 * @param {object} context.stackup - pcb-stackup 输出
 * @param {object} context.geometry - 几何数据
 * @param {object} context.settings - 用户配置的规则阈值
 * @param {object} context.boardInfo - 板子信息
 * @param {function} onProgress - 进度回调 (ruleIndex, totalRules, ruleName)
 * @returns {Promise<{violations: Array, summary: object}>}
 */
export async function runDfmAnalysis(context, onProgress) {
  const allViolations = []
  const ruleResults = []

  for (let i = 0; i < ALL_RULES.length; i++) {
    const rule = ALL_RULES[i]

    if (onProgress) {
      onProgress(i, ALL_RULES.length, rule.name)
    }

    try {
      const violations = rule.fn(context)
      const errorCount = violations.filter(v => v.severity === 'error').length
      const warningCount = violations.filter(v => v.severity === 'warning').length
      const infoCount = violations.filter(v => v.severity === 'info').length

      ruleResults.push({
        id: rule.id,
        name: rule.name,
        status: errorCount > 0 ? 'fail' : (warningCount > 0 ? 'warning' : 'pass'),
        errorCount,
        warningCount,
        infoCount,
        totalViolations: violations.length,
      })

      allViolations.push(...violations)
    } catch (err) {
      console.error(`DFM 规则 ${rule.name} 执行出错:`, err)
      ruleResults.push({
        id: rule.id,
        name: rule.name,
        status: 'error',
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        totalViolations: 0,
        errorMessage: err.message,
      })
    }

    // 让 UI 有机会更新
    await new Promise(r => setTimeout(r, 10))
  }

  // 汇总统计
  const summary = {
    totalRules: ALL_RULES.length,
    passedRules: ruleResults.filter(r => r.status === 'pass').length,
    warningRules: ruleResults.filter(r => r.status === 'warning').length,
    failedRules: ruleResults.filter(r => r.status === 'fail').length,
    totalErrors: allViolations.filter(v => v.severity === 'error').length,
    totalWarnings: allViolations.filter(v => v.severity === 'warning').length,
    totalInfo: allViolations.filter(v => v.severity === 'info').length,
    overallStatus: ruleResults.some(r => r.status === 'fail')
      ? 'fail'
      : ruleResults.some(r => r.status === 'warning')
        ? 'warning'
        : 'pass',
    ruleResults,
  }

  return {
    violations: allViolations,
    summary,
  }
}
