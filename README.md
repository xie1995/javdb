# JavdBviewed

<div align="center">

![Jav 助手](src/assets/favicons/light/favicon-128x128.png)

**Jav 视频浏览助手**

[![GitHub release](https://img.shields.io/github/v/release/xie1995/javdb)](https://github.com/xie1995/javdb/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://github.com/xie1995/javdb/releases)

</div>

> 🔱 本项目 Fork 自 [Adsryen/JavdBviewed](https://github.com/Adsryen/JavdBviewed)，基于个人需求进行定制化维护。

## 📖 简介

Jav 助手是一个功能强大的浏览器扩展，专为 JavDB 等 Jav 视频网站设计。它能够在列表页和详情页标记视频的"已浏览"或"我看过"状态，并提供丰富的数据管理功能，包括 WebDAV 同步、数据导入导出、115 v2 离线下载集成等高级特性。

📚 **[查看详细使用教程](https://javd-bviewed-docs.vercel.app/guide/)** - 包含完整的功能说明和使用指南

---

> **⚠️ 重要提示**
> 
> 本扩展仅供**年满18周岁的成年用户**使用。
> 
> - 🔞 本扩展涉及的内容相关功能，请确保您已达到所在地区的法定成年年龄
> - 🚫 请勿在未成年人可访问的设备上安装或使用本扩展
> - 🔒 建议启用扩展内置的隐私保护功能，保护个人隐私
> 
> **开发者不对用户的使用行为承担任何责任，请合法合规使用。**

## ✨ 核心功能

- 🎯 **视频标记** - 已浏览、已观看、想看三种状态标记，智能优先级显示
- 📚 **数据管理** - 番号库、演员库管理，支持导入导出和统计分析
- ☁️ **云端同步** - WebDAV 自动同步，支持多设备数据一致性
- 💾 **115网盘** - 115 v2 离线下载授权、详情页推送、任务管理与联动标记
- 🎨 **页面增强** - 列表预览、详情增强、智能过滤和隐藏
- 👥 **演员管理** - 演员收藏、订阅、黑名单和智能过滤
- 🆕 **新作品监控** - 跟踪订阅演员的新作品，并与详情页操作联动
- 🔍 **磁力搜索** - 多源自动搜索，支持自定义搜索引擎
- 🔒 **隐私保护** - 截图模糊模式，保护敏感信息
- 📊 **数据分析** - 统计报告与可视化结果查看
- 🎬 **Emby增强** - Emby服务器集成和快捷跳转
- 🤖 **AI翻译** - 支持多种AI模型的内容翻译

> 📖 **查看完整功能清单**: [功能总览](https://javd-bviewed-docs.vercel.app/reference/features)

## 🔄 本 Fork 改动

基于原项目 [Adsryen/JavdBviewed](https://github.com/Adsryen/JavdBviewed) 的个人定制版本，主要改动：

- 🔗 替换所有原仓库链接为 Fork 地址
- 🛠️ 根据个人使用习惯调整部分功能细节

## 📦 安装方式

### 前置要求

- **基本功能**: 支持 Chrome、Edge 等基于 Chromium 的浏览器
- **115网盘功能**: 建议准备可用的 115 账号，并在扩展 `设置 → 115网盘` 中完成 v2 授权

### 方式一：下载预编译版本（推荐）

> **📢 关于 Chrome 应用商店发布说明**
> 
> 根据 Chrome Web Store 开发者计划政策第 2.7 条规定，本扩展无法上架 Chrome Web Store。
> 用户需要通过以下方式手动安装。

**安装步骤：**

1. 访问 [Releases 页面](https://github.com/xie1995/javdb/releases)
2. 下载最新版本的 `javdb-extension-v*.zip` 文件
3. 解压到本地文件夹
4. 打开浏览器扩展管理页面：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
5. 开启"开发者模式"
6. 点击"加载已解压的扩展程序"，选择解压后的文件夹

## 🛠️ 二次开发与部署

技术文档请参考原项目文档：

- [二次开发指南](https://javd-bviewed-docs.vercel.app/developer/development)
- [架构说明](https://javd-bviewed-docs.vercel.app/developer/architecture)
- [开发文档首页](https://javd-bviewed-docs.vercel.app/developer/)

### 部署与打包

#### 本地构建扩展
```bash
pnpm install
pnpm run build
```

构建完成后，将 `dist` 目录作为未打包扩展加载到浏览器中。

#### 提交前检查
```bash
pnpm run typecheck
pnpm run build
```

#### 发布扩展
1. 更新版本号：
   ```bash
   pnpm run version:patch
   ```
2. 构建发布版本：
   ```bash
   pnpm run build
   ```
3. 创建 GitHub Release 并上传打包产物

## 📄 许可证

本项目采用 [GPL-3.0](LICENSE) 许可证。

## 🤝 支持与反馈

如有问题或建议，欢迎通过以下方式联系：
- 💬 提交 [Issue](https://github.com/xie1995/javdb/issues) - 报告问题或提出功能建议
- 🔗 原项目 [Adsryen/JavdBviewed](https://github.com/Adsryen/JavdBviewed) - 上游更新和讨论

---

<div align="center">

### ⭐ 如果您觉得这个项目对您有帮助，请给它一个 Star！

**您的支持是我持续维护和改进的最大动力 💪**

</div>
