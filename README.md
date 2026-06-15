# 每日 AI 信息摘要

自动采集 AI 领域最新动态，生成结构化摘要，推送到 IMA 笔记。

## 信息源

| 来源 | 内容 | 更新频率 |
|------|------|----------|
| GitHub | AI/LLM/Agent 热门开源项目 | 每日 |
| HuggingFace | 热门模型与空间 | 每日 |
| arXiv | cs.AI / cs.CL / cs.LG 最新论文 | 每日 |

## 部署方式

部署在 GitHub Actions 上，每天北京时间 07:30 自动运行。

## 所需 Secrets

| Secret 名称 | 说明 |
|-------------|------|
| `IMA_CLIENT_ID` | IMA OpenAPI Client ID |
| `IMA_API_KEY` | IMA OpenAPI API Key |

## 手动触发

在 GitHub 仓库的 Actions 页面，选择 "Daily AI Briefing" workflow，点击 "Run workflow" 即可手动触发。
