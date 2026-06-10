/**
 * PCB DFM 工具 - 层类型识别
 * 纯 JS，根据文件名模式匹配判断 Gerber 文件对应的 PCB 层类型
 * 无外部依赖
 */

import { LAYER_TYPES } from '../utils/constants.js'

/**
 * 识别所有 Gerber 文件的层类型
 * @param {Array<{name: string}>} files
 * @returns {Array<{filename: string, layerType: object|null, confidence: number}>}
 */
export function identifyLayers(files) {
  const results = []

  for (const file of files) {
    const { layerType, confidence } = manualIdentify(file.name)
    results.push({
      filename: file.name,
      layerType,
      confidence,
    })
  }

  return results
}

/**
 * 手动识别层类型（基于文件名模式匹配）
 */
function manualIdentify(filename) {
  const name = filename.toLowerCase()
  const ext = name.split('.').pop()

  // 扩展名映射（最常见的 Protel/Altium 命名）
  const extMap = {
    'gtl': LAYER_TYPES.TOP_COPPER,       // Gerber Top Layer
    'gbl': LAYER_TYPES.BOTTOM_COPPER,     // Gerber Bottom Layer
    'gts': LAYER_TYPES.TOP_SOLDERMASK,    // Gerber Top Soldermask
    'gbs': LAYER_TYPES.BOTTOM_SOLDERMASK, // Gerber Bottom Soldermask
    'gto': LAYER_TYPES.TOP_SILKSCREEN,    // Gerber Top Silkscreen
    'gbo': LAYER_TYPES.BOTTOM_SILKSCREEN, // Gerber Bottom Silkscreen
    'gko': LAYER_TYPES.OUTLINE,           // Gerber KeepOut/Outline
    'gml': LAYER_TYPES.OUTLINE,           // Gerber Mechanical Layer
    'gm1': LAYER_TYPES.OUTLINE,
    'gm2': LAYER_TYPES.OUTLINE,
    'gdd': LAYER_TYPES.TOP_PASTE,         // Paste
    'gtp': LAYER_TYPES.TOP_PASTE,
    'gbp': LAYER_TYPES.BOTTOM_PASTE,
    'xnc': LAYER_TYPES.DRILL,
    'drl': LAYER_TYPES.DRILL,
    'rou': LAYER_TYPES.OUTLINE,
    // KiCad style
    'cu': LAYER_TYPES.TOP_COPPER,         // 需要上下文判断
  }

  if (extMap[ext]) {
    return { layerType: extMap[ext], confidence: 0.9 }
  }

  // 文件名关键字匹配（按优先级排列）
  const patterns = [
    // Altium / Protel 标准扩展名
    { regex: /\.gtl$/i, type: LAYER_TYPES.TOP_COPPER },
    { regex: /\.gbl$/i, type: LAYER_TYPES.BOTTOM_COPPER },
    { regex: /\.gts$/i, type: LAYER_TYPES.TOP_SOLDERMASK },
    { regex: /\.gbs$/i, type: LAYER_TYPES.BOTTOM_SOLDERMASK },
    { regex: /\.gto$/i, type: LAYER_TYPES.TOP_SILKSCREEN },
    { regex: /\.gbo$/i, type: LAYER_TYPES.BOTTOM_SILKSCREEN },
    { regex: /\.gko$/i, type: LAYER_TYPES.OUTLINE },
    { regex: /\.gml$/i, type: LAYER_TYPES.OUTLINE },
    { regex: /\.gm\d$/i, type: LAYER_TYPES.OUTLINE },
    { regex: /\.xnc$/i, type: LAYER_TYPES.DRILL },
    { regex: /\.drl$/i, type: LAYER_TYPES.DRILL },
    { regex: /\.rou$/i, type: LAYER_TYPES.OUTLINE },
    { regex: /\.gtp$/i, type: LAYER_TYPES.TOP_PASTE },
    { regex: /\.gbp$/i, type: LAYER_TYPES.BOTTOM_PASTE },

    // KiCad 风格 (e.g., board-F_Cu.gbr, board-B_Mask.gbr)
    { regex: /[-_]f[_.]cu|[-_]top[_.]copper|[-_]front[_.]copper/i, type: LAYER_TYPES.TOP_COPPER },
    { regex: /[-_]b[_.]cu|[-_]bottom[_.]copper|[-_]back[_.]copper/i, type: LAYER_TYPES.BOTTOM_COPPER },
    { regex: /[-_]f[_.]mask|[-_]top[_.]mask|[-_]front[_.]solder/i, type: LAYER_TYPES.TOP_SOLDERMASK },
    { regex: /[-_]b[_.]mask|[-_]bottom[_.]mask|[-_]back[_.]solder/i, type: LAYER_TYPES.BOTTOM_SOLDERMASK },
    { regex: /[-_]f[_.]silk|[-_]top[_.]silk|[-_]front[_.]silk/i, type: LAYER_TYPES.TOP_SILKSCREEN },
    { regex: /[-_]b[_.]silk|[-_]bottom[_.]silk|[-_]back[_.]silk/i, type: LAYER_TYPES.BOTTOM_SILKSCREEN },
    { regex: /[-_]edge[_.]cuts|[-_]outline|[-_]board[_.]outline|[-_]profile/i, type: LAYER_TYPES.OUTLINE },
    { regex: /[-_]drill|[-_]ncdrill|[-_]pth|[-_]npth/i, type: LAYER_TYPES.DRILL },
    { regex: /[-_]f[_.]paste|[-_]top[_.]paste/i, type: LAYER_TYPES.TOP_PASTE },
    { regex: /[-_]b[_.]paste|[-_]bottom[_.]paste/i, type: LAYER_TYPES.BOTTOM_PASTE },
    { regex: /[-_]in1[_.]cu|[-_]inner1[_.]copper|[-_]gnd[_.]cu/i, type: LAYER_TYPES.INNER_COPPER_1 },
    { regex: /[-_]in2[_.]cu|[-_]inner2[_.]copper|[-_]pwr[_.]cu/i, type: LAYER_TYPES.INNER_COPPER_2 },

    // Eagle 风格 (e.g., .Brd, .CMP, .SOL, .STC, .STS, .PLC, .PLS, .DRD)
    { regex: /\.cmp$/i, type: LAYER_TYPES.TOP_COPPER },
    { regex: /\.sol$/i, type: LAYER_TYPES.BOTTOM_COPPER },
    { regex: /\.stc$/i, type: LAYER_TYPES.TOP_SOLDERMASK },
    { regex: /\.sts$/i, type: LAYER_TYPES.BOTTOM_SOLDERMASK },
    { regex: /\.plc$/i, type: LAYER_TYPES.TOP_SILKSCREEN },
    { regex: /\.pls$/i, type: LAYER_TYPES.BOTTOM_SILKSCREEN },
    { regex: /\.drd$/i, type: LAYER_TYPES.DRILL },
    { regex: /\.dim$/i, type: LAYER_TYPES.OUTLINE },

    // 通用关键字匹配
    { regex: /top.*cop|cop.*top|front.*cop/i, type: LAYER_TYPES.TOP_COPPER },
    { regex: /bot.*cop|cop.*bot|back.*cop/i, type: LAYER_TYPES.BOTTOM_COPPER },
    { regex: /top.*sold|top.*mask/i, type: LAYER_TYPES.TOP_SOLDERMASK },
    { regex: /bot.*sold|bot.*mask/i, type: LAYER_TYPES.BOTTOM_SOLDERMASK },
    { regex: /top.*silk|top.*ss/i, type: LAYER_TYPES.TOP_SILKSCREEN },
    { regex: /bot.*silk|bot.*ss/i, type: LAYER_TYPES.BOTTOM_SILKSCREEN },
    { regex: /outlin|profil|board.*edge|mech/i, type: LAYER_TYPES.OUTLINE },
    { regex: /drill|nc.*drill/i, type: LAYER_TYPES.DRILL },
  ]

  for (const p of patterns) {
    if (p.regex.test(name)) {
      return { layerType: p.type, confidence: 0.7 }
    }
  }

  // 无法识别
  return { layerType: null, confidence: 0 }
}
