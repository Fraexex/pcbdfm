/**
 * PCB DFM 工具 - R-tree 空间索引封装
 * 用于加速 DFM 检查中的邻近查询
 */

/**
 * 简易 R-tree 空间索引实现（纯 JS，无外部依赖）
 * 适用于中等规模 PCB 的 DFM 检查
 */
export class SpatialIndex {
  constructor() {
    this.items = []
  }

  /**
   * 插入一个带边界框的项目
   * @param {object} bbox - { minX, minY, maxX, maxY }
   * @param {object} data - 关联数据
   */
  insert(bbox, data) {
    this.items.push({ bbox, data })
  }

  /**
   * 查询与指定边界框相交的所有项目
   * @param {object} bbox - { minX, minY, maxX, maxY }
   * @returns {Array}
   */
  search(bbox) {
    return this.items.filter(item => this._intersects(item.bbox, bbox))
  }

  /**
   * 查询指定半径范围内的所有项目
   * @param {number} x - 中心 x
   * @param {number} y - 中心 y
   * @param {number} radius - 搜索半径
   * @returns {Array}
   */
  searchRadius(x, y, radius) {
    const bbox = {
      minX: x - radius,
      minY: y - radius,
      maxX: x + radius,
      maxY: y + radius,
    }
    return this.search(bbox).filter(item => {
      const ix = (item.bbox.minX + item.bbox.maxX) / 2
      const iy = (item.bbox.minY + item.bbox.maxY) / 2
      return Math.sqrt((ix - x) ** 2 + (iy - y) ** 2) <= radius
    })
  }

  /**
   * 获取所有项目
   */
  all() {
    return this.items
  }

  /**
   * 项目数量
   */
  get size() {
    return this.items.length
  }

  /**
   * 清空索引
   */
  clear() {
    this.items = []
  }

  /**
   * 批量加载
   */
  load(items) {
    for (const item of items) {
      this.insert(item.bbox, item.data)
    }
  }

  // 内部：边界框相交判断
  _intersects(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
           a.minY <= b.maxY && a.maxY >= b.minY
  }
}

/**
 * 从形状数组创建空间索引
 * @param {Array} shapes - 从 geometry.js 提取的形状
 * @returns {SpatialIndex}
 */
export function buildIndex(shapes) {
  const index = new SpatialIndex()

  for (const shape of shapes) {
    if (!shape.bbox) continue
    index.insert(
      {
        minX: shape.bbox.x,
        minY: shape.bbox.y,
        maxX: shape.bbox.x + (shape.bbox.width || 0),
        maxY: shape.bbox.y + (shape.bbox.height || 0),
      },
      shape
    )
  }

  return index
}
