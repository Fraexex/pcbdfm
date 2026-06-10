# PCB DFM 在线分析工具

> 轻量化浏览器端 PCB 可制造性设计（DFM）分析工具，支持 Gerber 文件解析、9 项 DFM 检查、PDF 报告自动生成。

## ✨ 功能特性

- **拖拽上传** — 支持 ZIP 包或单个 Gerber 文件，自动识别层类型
- **SVG 渲染** — 浏览器端实时渲染 PCB 各层，支持缩放/平移/层切换
- **9 项 DFM 检查** — 线宽、线距、钻孔、环宽、阻焊桥、丝印、板框、铜边距、缺失层
- **交互式违规定位** — 点击违规项自动定位到 SVG 对应区域
- **PDF 报告生成** — 一键生成专业中文 DFM 分析报告（含截图和改进建议）
- **纯前端** — 零服务器成本，可部署到任何静态托管

## 🚀 使用方式

### 直接打开

```bash
# 用浏览器打开 index.html 即可使用
open index.html
```

### 本地服务器（推荐，部分 CDN 依赖需要 HTTP）

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# 然后访问 http://localhost:8080
```

### 部署到 Vercel

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel
```

## 📁 项目结构

```
pcb-dfm-tool/
├── index.html                # 单页入口
├── css/
│   └── style.css             # 样式表
├── js/
│   ├── app.js                # 主入口，编排所有模块
│   ├── gerber/
│   │   ├── parser.js         # Gerber 解析（tracespace v4）
│   │   ├── layer-id.js       # 层类型自动识别
│   │   ├── renderer.js       # SVG 层渲染
│   │   └── geometry.js       # 几何数据提取
│   ├── dfm/
│   │   ├── engine.js         # DFM 引擎编排器
│   │   ├── rules.js          # 9 项 DFM 检查规则
│   │   └── spatial-index.js  # R-tree 空间索引
│   ├── ui/
│   │   ├── upload.js         # 拖拽上传 + ZIP 解压
│   │   ├── viewer.js         # SVG 交互查看器
│   │   ├── violations.js     # 违规列表 UI
│   │   └── dashboard.js      # 仪表盘 + 层列表 + 规则配置
│   ├── report/
│   │   ├── pdf-builder.js    # PDF 报告生成（PDFMake）
│   │   └── svg-capture.js    # SVG 截图工具
│   └── utils/
│       ├── constants.js      # 常量和默认配置
│       └── units.js          # mil/mm/inch 单位转换
├── public/
│   └── favicon.svg
└── README.md
```

## 🔍 DFM 检查规则

| # | 规则 | 默认阈值 | 说明 |
|---|------|---------|------|
| 1 | 最小线宽 | 4 mil (外) / 3 mil (内) | 检查走线宽度是否满足制造要求 |
| 2 | 线距/铜间距 | 6 mil | 检查走线之间的最小间距 |
| 3 | 最小钻孔尺寸 | 6 mil (0.15mm) | 检查过孔和通孔的最小钻孔直径 |
| 4 | 焊盘环宽 | 5 mil | 检查焊盘环宽是否足够 |
| 5 | 阻焊桥宽度 | 4 mil | 检查相邻焊盘之间的阻焊桥 |
| 6 | 丝印上焊盘 | 不允许重叠 | 检查丝印是否覆盖了焊盘 |
| 7 | 板框完整性 | 必须闭合 | 检查板框轮廓是否完整 |
| 8 | 铜皮到板边距 | 10 mil | 检查铜皮到板边的安全距离 |
| 9 | 缺失层检测 | 必须有铜层+板框 | 检查是否缺少必要的 PCB 层 |

所有规则阈值均可自定义。

## 🛠️ 技术栈

| 依赖 | 用途 | 加载方式 |
|------|------|---------|
| tracespace v4 | Gerber 解析和 SVG 渲染 | CDN (esm.sh) |
| JSZip | ZIP 文件解压 | CDN (esm.sh) |
| PDFMake | 浏览器端 PDF 生成 | CDN (esm.sh) |

纯 HTML + CSS + JS，无构建工具、无 npm 打包。

## 📋 支持的文件格式

| 格式 | 扩展名 |
|------|--------|
| Gerber 顶层铜 | .gtl, .top |
| Gerber 底层铜 | .gbl, .bot |
| Gerber 顶层阻焊 | .gts |
| Gerber 底层阻焊 | .gbs |
| Gerber 顶层丝印 | .gto |
| Gerber 底层丝印 | .gbo |
| Gerber 板框 | .gko, .gml, .gm1 |
| Excellon 钻孔 | .xnc, .drl |
| ZIP 包 | .zip（包含以上文件） |

## 📝 License

MIT
