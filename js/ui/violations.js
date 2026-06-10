/**
 * PCB DFM 工具 - 违规列表 UI
 */

import { SEVERITY_LABELS, SEVERITY_COLORS } from '../utils/constants.js'

/**
 * 渲染违规列表到右侧面板
 * @param {Array} violations - 违规数组
 * @param {HTMLElement} container - 列表容器
 * @param {function} onItemClick - 点击回调 (violation)
 */
export function renderViolationList(violations, container, onItemClick) {
  container.innerHTML = ''

  if (!violations.length) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:var(--text-muted);">
        <div style="font-size:32px; margin-bottom:8px;">✅</div>
        <div>未发现违规项</div>
      </div>
    `
    return
  }

  // 按严重程度排序: error > warning > info
  const sorted = [...violations].sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 }
    return (order[a.severity] || 3) - (order[b.severity] || 3)
  })

  for (const v of sorted) {
    const card = document.createElement('div')
    card.className = `violation-card severity-${v.severity}`
    card.setAttribute('data-violation-id', v.id)

    card.innerHTML = `
      <div class="violation-header">
        <span class="violation-rule">${v.ruleName}</span>
        <span class="violation-severity ${v.severity}">${SEVERITY_LABELS[v.severity] || v.severity}</span>
      </div>
      <div class="violation-message">${v.message}</div>
      ${v.suggestion ? `<div class="violation-message" style="margin-top:4px; color:var(--accent-blue); font-size:11px;">💡 ${v.suggestion}</div>` : ''}
      ${v.location ? `<div class="violation-location">📍 (${v.location.x.toFixed(2)}, ${v.location.y.toFixed(2)})</div>` : ''}
    `

    card.addEventListener('click', () => {
      // 移除其他高亮
      container.querySelectorAll('.violation-card.active').forEach(c => c.classList.remove('active'))
      card.classList.add('active')
      if (onItemClick) onItemClick(v)
    })

    container.appendChild(card)
  }
}

/**
 * 高亮指定违规卡片
 */
export function highlightViolation(violationId, container) {
  container.querySelectorAll('.violation-card.active').forEach(c => c.classList.remove('active'))
  const card = container.querySelector(`[data-violation-id="${violationId}"]`)
  if (card) {
    card.classList.add('active')
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}
