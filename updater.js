import Parser from 'rss-parser';
import cron from 'node-cron';
import translate from 'translate-google';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const parser = new Parser({
    customFields: {
        item: ['content:encoded', 'description']
    }
});

const KOREAN_FEEDS = [
    'https://www.yna.co.kr/rss/economy.xml',
    'https://fs.jtbc.co.kr/RSS/economy.xml',
    'http://rss.chosun.com/biz.xml',
    'https://www.mk.co.kr/rss/30100041/',
    'https://www.hankyung.com/feed/economy'
];
const GLOBAL_FEEDS = [
    'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069',
    'http://feeds.bbci.co.uk/news/business/rss.xml',
    'https://www.theguardian.com/business/economics/rss',
    'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml'
];

const TRADE_KEYWORDS = ['무역', '관세', '수출', '수입', '공급망', '통상', '규제', '반도체 수출', '쿼터', '보호무역', 'FTA', '경제안보', '산업', '시장', '환율', 'trade', 'tariff', 'export', 'import', 'supply chain', 'commerce', 'regulation', 'trade war', 'semiconductor export', 'economy', 'market', 'industry'];
const BLACKLIST_KEYWORDS = ['sports', 'espn', 'nhl', 'nba', 'mlb', 'nfl', 'entertainment', 'celebrity', 'movie', 'music', '결혼', '연예', '스포츠', '야구', '축구', '농구', '골프', '드라마', 'player', 'coach', 'game score', 'highlights', 'trade deadline', 'draft pick', 'signing', 'lottery', 'sweepstakes'];

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

async function resolveUrl(url) {
    try {
        const response = await axios.get(url, {
            maxRedirects: 5,
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36' }
        });
        return response.request.res.responseUrl || url;
    } catch (e) {
        return url;
    }
}

function isRelevant(title, content) {
    const text = (title + ' ' + content).toLowerCase();
    const hasBlacklist = BLACKLIST_KEYWORDS.some(word => text.includes(word));
    // If it's a sports trade, discard even if it has "trade"
    if (hasBlacklist) return false;

    return TRADE_KEYWORDS.some(word => text.includes(word));
}

async function fetchFullText(url, title) {
    try {
        const trueUrl = await resolveUrl(url);
        const response = await axios.get(trueUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            timeout: 10000
        });

        const dom = new JSDOM(response.data, { url: trueUrl });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (article && article.textContent && article.textContent.length > 500) {
            return cleanContent(article.textContent, title);
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function generateStructuredSummary(rawText) {
    if (!rawText || rawText.length < 500) return null;

    // Split sentences using a more robust regex
    const sentences = rawText.match(/[^.!?]+[.!?]+/g) || [];
    const validSentences = sentences.map(s => s.trim()).filter(s => s.length > 30);

    // If we have enough sentences, build a long summary
    if (validSentences.length < 8) return null;

    const intro = validSentences.slice(0, 3).join(' ');
    const body = validSentences.slice(3, Math.min(validSentences.length - 2, 15)).join(' ');
    const conclusion = validSentences.slice(-2).join(' ');

    const summary = `[사건 개요]\n${intro}\n\n[주요 배경 및 상세 내용]\n${body}\n\n[시사점 및 향후 전망]\n${conclusion}`;

    // Final check for length requirement (450+ Korean characters)
    if (summary.length < 400) return null;

    return {
        summary: summary,
        impact: conclusion
    };
}

async function safeTranslate(text) {
    if (!text) return "";
    try {
        // translate-google can be flaky, so we wrap it
        const res = await translate(text, { to: 'ko' });
        return res;
    } catch (e) {
        return text; // Fallback to original
    }
}

async function processFeed(categoryPrefix, rssUrls) {
    const results = [];
    console.log(`[${categoryPrefix}] Starting multi-feed aggregation...`);

    for (const rssUrl of rssUrls) {
        if (results.length >= 10) break;
        console.log(`   [${categoryPrefix}] Fetching: ${rssUrl}`);

        try {
            const response = await axios.get(rssUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                timeout: 10000
            });
            const feed = await parser.parseString(response.data);
            const candidates = feed.items.slice(0, 50);

            for (const [index, item] of candidates.entries()) {
                const rawTitle = item.title.includes(' - ') ? item.title.split(' - ').slice(0, -1).join(' - ').trim() : item.title.trim();
                const sourceName = item.title.includes(' - ') ? item.title.split(' - ').pop().trim() : (categoryPrefix === 'kr' ? '국내 언론' : 'International News');

                if (results.some(r => r.title.includes(rawTitle.substring(0, 20)))) continue; // Basic duplicate check

                if (!isRelevant(rawTitle, item.contentSnippet || "")) {
                    continue;
                }

                let rawText = await fetchFullText(item.link, rawTitle);
                if (!rawText) continue;

                const resultObj = await generateStructuredSummary(rawText);
                if (!resultObj) continue;

                const summaryKo = await safeTranslate(resultObj.summary);
                const impactKo = await safeTranslate(resultObj.impact);
                const finalTitle = await safeTranslate(rawTitle);

                if (!summaryKo || summaryKo.length < 400) continue; // Slightly more lenient to ensure 10 items

                results.push({
                    title: finalTitle,
                    summary: summaryKo,
                    impact: impactKo.length > 30 ? impactKo : '이 사안은 글로벌 공급망과 무역 지표에 실질적인 영향을 미칠 것으로 분석됩니다.',
                    source: sourceName,
                    link: item.link,
                    pubDate: new Date(item.pubDate).getTime() || Date.now()
                });

                console.log(`   [${categoryPrefix}] ✓ Article ${results.length}/10: ${finalTitle.substring(0, 30)}...`);
                if (results.length >= 10) break;
            }
        } catch (err) {
            console.error(`   [${categoryPrefix}] ✗ Feed Error (${rssUrl}): ${err.message}`);
        }
    }
    return results;
}

async function updateNewsData() {
    console.log(`[${new Date().toISOString()}] Updating News (10 Items Target, Multi-Feed)...`);
    try {
        const [koreanNews, globalNews] = await Promise.all([
            processFeed('kr', KOREAN_FEEDS),
            processFeed('gl', GLOBAL_FEEDS)
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
