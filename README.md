# pregrow · 乐学成长平台

Web 端乐学成长平台，包含学生与教师页面、成长任务、目标与梦想、班级管理、成长记录和分析接口。后端使用 Node.js / Express，数据与认证依赖 Supabase。

## 目录

源码在 `growth-dashboard/`：

| 路径 | 内容 |
| --- | --- |
| `index.html`、`register.html`、`onboarding.html` | 登录、注册与引导 |
| `student/`、`teacher/` | 学生端、教师端页面与界面插图 |
| `shared/`、`js/` | 页面共用逻辑与样式 |
| `backend/` | 服务接口、业务逻辑和数据库结构 |
| `api/`、`vercel.json` | 原工程的 Vercel 入口与配置 |

移动端源码单独同步至 [growth-mobile](https://github.com/Seeleangel/growth-mobile)。

## 本地运行

```bash
cd growth-dashboard
npm ci
cp backend/.env.example backend/.env
# 填写自有 Supabase 地址、anon key、service key；AI 功能另需 ECNU_API_KEY。
npm start
```

后端默认端口 3003，可通过 `PORT` 配置。健康检查为 `/health`。前端页面需另外使用静态服务器启动，例如在另一个终端执行：

```bash
cd growth-dashboard
python3 -m http.server 8081
```

然后访问前端服务器的 `index.html`。默认前端请求本地 3003 后端；自定义后端地址时可设置 `window.API_CONFIG.baseUrl`，并核对 CORS 配置。

数据库结构及历次更新在 `backend/db/`。需要在自己的数据库中准备对应结构；未包含生产数据、学生信息或原服务器的维护脚本。图片存储地址中的 `your-project` 是示例，使用自有 Supabase Storage 时请修改相关配置；挑战插图采用备份已有的优化图片并保留原文件名。

## 当前验证

```bash
cd growth-dashboard
npm test
```

后端及页面脚本语法检查通过；本地健康检查、静态图片响应和流式响应回归测试通过。恢复时修复了性能统计中间件重复写入响应头的问题，以及 5 个页面配置中多余的逗号。实际登录、数据库读写、AI 服务、全部前端流程和 Vercel 部署尚未验收。

运行数据、凭据、录屏、助手说明与历史调试记录未纳入源码。
