# 起笔 (QiBi) - AI 辅助小说写作桌面工作台

「起笔」是一款专为网络文学作家与长篇故事创作者打造的 **AI 辅助写作桌面工作台**。深度结合大语言模型的创作能力与专业写作工作流，帮助创作者构思世界观、推演冲突剧情、雕琢正文并保持专属文风。

---

## ✨ 核心特性

- 🚀 **开箱即用（便携版）**：无需配置复杂的 Node.js、Python 或数据库环境。下载便携版 EXE，双击即可直接运行。
- 🔒 **隐私安全第一**：纯本地化数据存储（数据存放在本地 `%APPDATA%/起笔` 目录下的 SQLite 中），创作草稿、设定资料绝不外泄。
- ✍️ **小说创作工作流**：
  - **大纲与卷章体系**：多卷结构、细纲脉络、卡点推演一目了然。
  - **沉浸式章节写作**：内置专属编辑器，支持正文实时字数统计与自动保存。
  - **世界观与人物设定库**：角色卡片、势力关系、装备道具设定随时检索联动。
- 🤖 **广泛的大模型支持**：支持 OpenAI 兼容 API、Anthropic Claude 等主流模型，SSE 极速流式输出，灵感即刻涌现。
- 🎭 **作者风格蒸馏**：支持导入参考文本提炼语言风格与叙述韵味，打造量身定制的 AI 写作助手。

---

## 📥 快速下载

前往 [GitHub Releases 最新发布页](https://github.com/huajikano/qibi-desktop/releases/latest) 下载：

- **Windows 64位 便携版**：`起笔-1.2.3-portable.exe`
- **运行方式**：无需安装，下载后双击即可启动运行。

---

## 🛠️ 从源码构建

如果您希望自行编译或进行二次开发：

```bash
# 1. 克隆代码仓库
git clone https://github.com/huajikano/qibi-desktop.git
cd qibi-desktop

# 2. 安装项目依赖
npm install

# 3. 运行开发模式
npm run dev:web       # 启动前端开发服务
npm run dev:server    # 启动本地后端服务

# 4. 打包 Windows 便携版 EXE
npm run build:exe
```

打包完成后，可执行文件将生成在 `desktop/release/起笔-1.2.3-portable.exe`。

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 开源。
