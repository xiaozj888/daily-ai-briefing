/**
 * 每日 AI 信息摘要生成器
 * 从多个公开信息源搜索 AI 领域最新动态，生成结构化摘要，推送至 IMA 笔记
 *
 * 依赖：Node.js 22+（内置 fetch 支持）
 */

// ============ 配置 ============
const IMA_CLIENT_ID = process.env.IMA_CLIENT_ID;
const IMA_API_KEY = process.env.IMA_API_KEY;
const IMA_BASE_URL = 'https://ima.qq.com';
const SKILL_VERSION = '1.0.0';

if (!IMA_CLIENT_ID || !IMA_API_KEY) {
  console.error('❌ 缺少 IMA_CLIENT_ID 或 IMA_API_KEY 环境变量');
  process.exit(1);
}

// ============ 工具函数 ============

// 获取今日日期（北京时间，UTC+8）
function getBeijingDate() {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 3600 * 1000);
  return beijingTime.toISOString().split('T')[0];
}

// IMA API 通用请求（使用 fetch，与 ima_api.cjs 保持一致）
async function imaFetch(apiPath, body, options = {}) {
  const url = `${IMA_BASE_URL}/${apiPath}`;
  const headers = {
    'Content-Type': 'application/json',
    'ima-openapi-clientid': IMA_CLIENT_ID,
    'ima-openapi-apikey': IMA_API_KEY,
  };
  if (options.ctx) {
    headers['ima-openapi-ctx'] = options.ctx;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`IMA API HTTP error: status=${resp.status}, body=${text.substring(0, 200)}`);
  }
  return text;
}

// IMA API 调用（含 update check）
async function callImaApi(apiPath, body) {
  // 先调 check_skill_update（与 ima_api.cjs 行为一致）
  if (apiPath !== 'openapi/check_skill_update') {
    try {
      await imaFetch('openapi/check_skill_update', { version: SKILL_VERSION }, { ctx: `skill_version=${SKILL_VERSION}` });
    } catch (e) {
      // 更新检查失败不阻断主流程
      console.log('⚠️ skill update check failed, continuing...');
    }
  }

  const ctx = `skill_version=${SKILL_VERSION}`;
  const text = await imaFetch(apiPath, body, { ctx });
  const result = JSON.parse(text);
  if (result.code !== 0) {
    throw new Error(`IMA API business error: code=${result.code}, msg=${result.msg}`);
  }
  return result.data;
}

// 通用 HTTP GET（用于采集外部信息源）
async function httpGet(url, headers = {}) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'daily-ai-briefing/1.0', ...headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  return { statusCode: resp.status, body: await resp.text() };
}

// ============ 信息源采集 ============

// 从 GitHub 搜索 AI 相关热门项目
async function fetchGithubTrending() {
  const items = [];
  try {
    const today = getBeijingDate();
    let resp = await httpGet(
      `https://api.github.com/search/repositories?q=topic:ai+topic:llm+topic:agent+pushed:>${today}&sort=stars&order=desc&per_page=10`,
      { 'Accept': 'application/vnd.github.v3+json' }
    );
    let data = JSON.parse(resp.body);

    if (data.items && data.items.length > 0) {
      for (const repo of data.items.slice(0, 5)) {
        items.push({
          title: repo.full_name,
          description: (repo.description || '').substring(0, 120),
          url: repo.html_url,
          stars: repo.stargazers_count,
          source: 'GitHub',
        });
      }
    }

    // Fallback：当天新项目不够，取最近一周
    if (items.length < 3) {
      const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().split('T')[0];
      resp = await httpGet(
        `https://api.github.com/search/repositories?q=topic:ai+topic:llm+topic:agent+pushed:>${weekAgo}&sort=stars&order=desc&per_page=10`,
        { 'Accept': 'application/vnd.github.v3+json' }
      );
      data = JSON.parse(resp.body);
      if (data.items) {
        for (const repo of data.items.slice(0, 5)) {
          if (!items.find(i => i.title === repo.full_name)) {
            items.push({
              title: repo.full_name,
              description: (repo.description || '').substring(0, 120),
              url: repo.html_url,
              stars: repo.stargazers_count,
              source: 'GitHub',
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('GitHub fetch error:', e.message);
  }
  return items;
}

// 从 arXiv 获取最新 AI 论文
async function fetchArxivPapers() {
  const items = [];
  try {
    const resp = await httpGet(
      'http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=8'
    );
    // 简单 XML 解析
    const entryBlocks = resp.body.split('<entry>').slice(1);
    for (const block of entryBlocks.slice(0, 5)) {
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
      const id = (block.match(/<id>([\s\S]*?)<\/id>/) || [])[1];
      const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1];
      if (title) {
        items.push({
          title: title.replace(/\n/g, ' ').trim(),
          description: summary ? summary.replace(/\n/g, ' ').trim().substring(0, 150) : '',
          url: (id || '').trim(),
          source: 'arXiv',
        });
      }
    }
  } catch (e) {
    console.error('arXiv fetch error:', e.message);
  }
  return items;
}

// 从 Hacker News 获取 AI 相关热门讨论
async function fetchHackerNewsAI() {
  const items = [];
  try {
    const resp = await httpGet('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = JSON.parse(resp.body).slice(0, 30);
    const promises = ids.slice(0, 15).map(id =>
      httpGet(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => JSON.parse(r.body)).catch(() => null)
    );
    const stories = (await Promise.all(promises)).filter(Boolean);
    const aiKeywords = ['ai', 'llm', 'gpt', 'claude', 'agent', 'model', 'openai', 'anthropic', 'gemini', 'mistral', 'hugging', 'diffusion', 'transformer', 'prompt', 'rag', 'fine-tun', 'embedding'];
    for (const story of stories) {
      const text = `${story.title || ''} ${(story.text || '')}`.toLowerCase();
      if (aiKeywords.some(k => text.includes(k))) {
        items.push({
          title: story.title || '',
          description: (story.text || '').substring(0, 100).replace(/<[^>]+>/g, ''),
          url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
          score: story.score || 0,
          source: 'HackerNews',
        });
      }
      if (items.length >= 5) break;
    }
  } catch (e) {
    console.error('HackerNews fetch error:', e.message);
  }
  return items;
}

// ============ 摘要生成 ============

function generateSummary(githubItems, arxivItems, hnItems) {
  const date = getBeijingDate();
  const lines = [];

  lines.push(`🤖 每日 AI 信息摘要 | ${date}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (githubItems.length > 0) {
    lines.push('📂 GitHub · AI 热门开源项目');
    lines.push('');
    for (const item of githubItems) {
      lines.push(`• **${item.title}** ⭐${item.stars || '?'}`);
      if (item.description) lines.push(`  > ${item.description}`);
      if (item.url) lines.push(`  🔗 ${item.url}`);
      lines.push('');
    }
  }

  if (hnItems.length > 0) {
    lines.push('🔥 Hacker News · AI 热门讨论');
    lines.push('');
    for (const item of hnItems) {
      lines.push(`• **${item.title}** 🔺${item.score || 0}`);
      if (item.url) lines.push(`  🔗 ${item.url}`);
      lines.push('');
    }
  }

  if (arxivItems.length > 0) {
    lines.push('📄 arXiv · 最新 AI 论文');
    lines.push('');
    for (const item of arxivItems) {
      lines.push(`• **${item.title}**`);
      if (item.description) lines.push(`  > ${item.description}`);
      if (item.url) lines.push(`  🔗 ${item.url}`);
      lines.push('');
    }
  }

  const hasContent = githubItems.length > 0 || hnItems.length > 0 || arxivItems.length > 0;
  if (!hasContent) {
    lines.push('⚠️ 今日未获取到新的 AI 动态信息，可能是因为 API 请求受限或网络问题。');
    lines.push('');
  }

  lines.push('---');
  lines.push(`⏰ 生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  lines.push('📡 信息源：GitHub · Hacker News · arXiv');

  return lines.join('\n');
}

// ============ 主流程 ============

async function main() {
  console.log('🚀 开始生成每日 AI 信息摘要...');

  // 1. 并行采集信息
  console.log('📡 采集信息源...');
  const [githubItems, arxivItems, hnItems] = await Promise.all([
    fetchGithubTrending(),
    fetchArxivPapers(),
    fetchHackerNewsAI(),
  ]);
  console.log(`✅ 采集完成：GitHub ${githubItems.length} | arXiv ${arxivItems.length} | HN ${hnItems.length}`);

  // 2. 生成摘要
  const summary = generateSummary(githubItems, arxivItems, hnItems);
  console.log('📝 摘要生成完成，内容长度：', summary.length);

  // 3. 推送到 IMA 笔记
  const date = getBeijingDate();
  const title = `🤖 每日AI摘要 ${date}`;

  console.log('📤 推送到 IMA 笔记...');
  try {
    // 先尝试创建新笔记
    const result = await callImaApi('openapi/note/v1/import_doc', {
      content_format: 1,
      content: `# ${title}\n\n${summary}`,
    });
    console.log('✅ IMA 笔记创建成功！note_id:', result.note_id || JSON.stringify(result));
  } catch (e) {
    console.error('❌ 创建笔记失败:', e.message);
    // 备用：搜索已有笔记，追加内容
    try {
      console.log('尝试搜索已有笔记并追加...');
      const searchResult = await callImaApi('openapi/note/v1/search_note', {
        search_type: 0,
        query_info: { title },
        start: 0,
        end: 5,
      });
      const notes = searchResult.search_note_infos || [];
      const existing = notes.find(n => n.note_book_info && n.note_book_info.title === title);
      if (existing) {
        await callImaApi('openapi/note/v1/append_doc', {
          note_id: existing.note_book_info.note_id,
          content_format: 1,
          content: '\n\n' + summary,
        });
        console.log('✅ 内容追加到已有笔记成功！');
      } else {
        throw new Error('未找到已有笔记');
      }
    } catch (e2) {
      console.error('❌ 备用方案也失败:', e2.message);
      process.exit(1);
    }
  }

  console.log('🎉 每日 AI 信息摘要任务完成！');
}

main().catch(err => {
  console.error('💥 主流程异常:', err);
  process.exit(1);
});
