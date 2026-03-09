import Parser from 'rss-parser';
import cron from 'node-cron';
import translate from 'translate-google';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parser = new Parser({
    customFields: {
        item: ['content:encoded', 'description']
    }
});

const KOREAN_QUERY = '무역 OR 관세 OR 수출 OR 수입 OR 공급망 OR KOTRA OR 무역협회 OR "미중 무역" when:7d';
const KOREAN_RSS_URL = `https://news.google.com/rss/search?q=${encodeURIComponent(KOREAN_QUERY)}&hl=ko&gl=KR&ceid=KR:ko`;

const GLOBAL_QUERY = 'trade OR tariff OR export OR import OR "supply chain" OR "trade war" OR "semiconductor export" when:7d';
const GLOBAL_RSS_URL = `https://news.google.com/rss/search?q=${encodeURIComponent(GLOBAL_QUERY)}&hl=en-US&gl=US&ceid=US:en`;

function cleanContent(text, titleToRemove = "") {
    if (!text) return "";
    let clean = text.replace(/<[^>]*>?/gm, ' ');

    // Aggressive title and duplicate stripping
    if (titleToRemove) {
        const t = titleToRemove.replace(/["'\[\]\s]/g, '').toLowerCase();
        const cleanRaw = clean.replace(/["'\[\]\s]/g, '').toLowerCase();
        if (cleanRaw.startsWith(t)) {
            clean = clean.substring(titleToRemove.length).trim();
        }
    }

    const boilerplate = [
        /Copyrights\s*ⓒ.*$/gi, /저작권자.*재배포 금지$/g, /무단 전재.*금지$/g,
        /\[[^\]]+뉴스\]/g, /\[[^\]]+기자\]/g, /▲.*$/g,
        /Title\s*:\s*.*$/gi, /기사입력.*$/g, /PDF로 보기.*$/g,
        /View original.*$/gi, /Article continues after.*$/gi,
        /\(.*?=연합뉴스\)/g, /\[.*?\]/g,
        /©\s*\d{4}.*?All Rights Reserved/gi
    ];
    boilerplate.forEach(regex => clean = clean.replace(regex, ''));
    clean = clean.replace(/^[가-힣]+\([가-힣]+\)\s*=\s*/g, '');
    clean = clean.replace(/[^\u0000-\u007F\u3131-\uD79D\s,.?!()"'\[\]]/g, "");
    return clean.replace(/\s+/g, ' ').trim();
}

async function resolveUrl(googleUrl) {
    try {
        const response = await fetch(googleUrl, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
        return response.url;
    } catch (e) {
        return googleUrl;
    }
}

async function fetchFullText(url, title) {
    try {
        const trueUrl = await resolveUrl(url);
        if (trueUrl.includes('news.google.com')) return null;

        const response = await fetch(trueUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36' },
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) return null;
        const html = await response.text();

        const contentPatterns = [
            /<div[^>]*(id|class)="[^"]*(article-body|article_body|story-content|news-content|post-content|view-content|art_body|articletxt|article_view|articleContent|entry-content|div_article)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
            /<article[^>]*>([\s\S]*?)<\/article>/gi,
            /<section[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/section>/gi,
            /<main[^>]*>([\s\S]*?)<\/main>/gi,
            /<div[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
        ];

        let bestBody = "";
        for (const pattern of contentPatterns) {
            const match = pattern.exec(html);
            if (match && (match[3] || match[0]).length > bestBody.length) {
                bestBody = match[3] || match[0];
            }
        }

        if (bestBody.length > 50) {
            const pMatches = bestBody.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
            if (pMatches) {
                const text = pMatches.map(p => cleanContent(p, title)).filter(t => t.length > 30).slice(0, 25).join(' ');
                if (text.length > 100) return text;
            }
            return cleanContent(bestBody, title);
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function safeTranslate(text, to = 'ko') {
    if (!text || text.length < 5) return text;
    try {
        const chunks = text.match(/.{1,1500}/g) || [text];
        let translated = "";
        for (const chunk of chunks) {
            const t = await translate(chunk, { to });
            translated += t + " ";
        }
        return translated.trim();
    } catch (err) {
        return text;
    }
}

async function generateStructuredSummary(rawText) {
    if (!rawText || rawText.length < 50) return "";
    const sentences = rawText.split(/[.!?]\s+/).filter(s => s.trim().length > 15);

    if (sentences.length < 3) return rawText;

    // Structure: What happened (2-3 sentences), Context/Details (3-6 sentences), Impact (1-2 sentences)
    const what = sentences.slice(0, 3).join('. ') + '.';
    const details = sentences.slice(3, Math.min(15, sentences.length - 2)).join('. ') + '.';
    const impact = sentences.length > 3 ? sentences.slice(-2).join('. ') + '.' : '';

    return `[사건 개요]\n${what}\n\n[주요 배경 및 상세 내용]\n${details}\n\n[시사점 및 향후 전망]\n${impact}`.trim();
}

async function processFeed(feedUrl, categoryPrefix) {
    console.log(`[${categoryPrefix}] Fetching RSS...`);
    try {
        const feed = await parser.parseURL(feedUrl);
        const candidates = feed.items.slice(0, 100);
        const results = [];

        for (const [index, item] of candidates.entries()) {
            const rawTitle = item.title.replace(/ - .*$/, '').trim();
            const sourceName = item.title.includes(' - ') ? item.title.split(' - ').pop().trim() : 'News Source';

            // Filter out sports/irrelevant news
            if (rawTitle.toLowerCase().match(/nhl|mlb|nfl|nba|sports|trade deadline|sign to|player/)) {
                if (!rawTitle.toLowerCase().match(/tariff|export|import|supply|trade war/)) continue;
            }

            let rawText = await fetchFullText(item.link, rawTitle);

            if (!rawText || rawText.length < 300) {
                const desc = cleanContent(item.contentSnippet || item.description || "", rawTitle);
                const encoded = cleanContent(item['content:encoded'] || "", rawTitle);
                rawText = encoded.length > desc.length ? encoded : desc;
            }

            if (!rawText || rawText.length < 100) continue;

            const summaryRaw = await generateStructuredSummary(rawText);
            const summaryKo = await safeTranslate(summaryRaw);
            const finalTitle = await safeTranslate(rawTitle);

            // Length verification (Aiming for 450+ Korean characters)
            if (!summaryKo || summaryKo.length < 200) continue;
            if (results.some(r => r.title === finalTitle)) continue;

            results.push({
                id: `${categoryPrefix}-${Date.now()}-${results.length}`,
                title: finalTitle,
                summary: summaryKo,
                impact: '이 사안은 글로벌 공급망의 변동성과 주요국 간의 통상 마찰을 반영하며, 향후 국내 수출 기업들의 대응 전략 수립에 있어 중요한 지표가 될 것으로 보입니다.',
                source: sourceName,
                link: item.link,
                score: index,
                pubDate: new Date(item.pubDate).getTime()
            });

            console.log(`   [${categoryPrefix}] ✓ Article ${results.length}/10 added (Len: ${summaryKo.length}): ${finalTitle.substring(0, 30)}...`);
            if (results.length >= 10) break;
        }

        return results;
    } catch (err) {
        console.error(`Error processing ${categoryPrefix} feed:`, err);
        return [];
    }
}

async function updateNewsData() {
    console.log(`[${new Date().toISOString()}] Updating News (10 Items Target, Resilient Logic)...`);
    try {
        const [koreanNews, globalNews] = await Promise.all([
            processFeed(KOREAN_RSS_URL, 'kr'),
            processFeed(GLOBAL_RSS_URL, 'gl')
        ]);

        fs.writeFileSync(path.join(__dirname, 'public', 'data.json'), JSON.stringify({ koreanNews, globalNews }, null, 2));
        console.log(`DONE: KR=${koreanNews.length}, GL=${globalNews.length}`);
    } catch (error) {
        console.error('UpdateNewsData error:', error);
    }
}

const runOnce = process.argv.includes('--run-once');
if (runOnce) {
    updateNewsData().then(() => process.exit(0));
} else {
    updateNewsData();
    cron.schedule('0 6 * * *', updateNewsData);
}
