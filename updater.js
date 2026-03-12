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
    'http://rss.chosun.com/biz.xml',
    'https://www.mk.co.kr/rss/30100041/',
    'https://www.hankyung.com/feed/economy',
    'https://www.sedaily.com/RSS/Main.xml'
];
const GLOBAL_FEEDS = [
    'https://feeds.reuters.com/reuters/businessNews',
    'https://www.ft.com/rss/home',
    'https://www.ft.com/world?format=rss',
    'https://asia.nikkei.com/rss/feed/nar',
    'https://www.economist.com/finance-and-economics/rss.xml',
    'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069',
    'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml'
];

const TRADE_KEYWORDS = ['관세', '통관', '수출금액', '수입금액', '수출규제', '수입규제', '미국관세', '자유무역', '보호무역', 'fta', '원산지규정', '수출지원제도', '코트라', '무역협회', '관세청', '세관', '수출바우처', '해외전시회', '글로벌무역환경', '관세장벽', '비관세장벽', '해외규격인증', '국제수지', '환율', '외환거래', '무역제재', '해외무역관', '수출기업', '해외무역', '국제무역', '글로벌벨류체인', '무역계약', '국제물류', '해상운임'];
const GLOBAL_TRADE_KEYWORDS = ['tariff', 'tariffs', 'customs', 'export', 'exports', 'import', 'imports', 'trade', 'free trade', 'protectionism', 'fta', 'rules of origin', 'trade support', 'kotra', 'kita', 'customs service', 'trade barrier', 'non-tariff barrier', 'certification', 'current account', 'exchange rate', 'fx', 'foreign exchange', 'sanctions', 'trade mission', 'exporter', 'international trade', 'global value chain', 'value chain', 'shipping', 'freight', 'ocean freight', 'supply chain', 'trade agreement', 'trade policy', 'trade restriction', 'trade surplus', 'trade deficit'];
const BLACKLIST_KEYWORDS = ['sports', 'espn', 'nhl', 'nba', 'mlb', 'nfl', 'entertainment', 'celebrity', 'movie', 'music', '결혼', '연예', '스포츠', '야구', '축구', '농구', '골프', '드라마', 'player', 'coach', 'game score', 'highlights', 'trade deadline', 'draft pick', 'signing', 'lottery', 'sweepstakes'];
const KOREAN_SOURCE_ALLOWLIST = ['연합뉴스', '조선비즈', '매일경제', '한국경제', '서울경제', 'kotra', '코트라', '무역협회', '관세청', '세관', '뉴스1', '중앙일보', '동아일보', '한국무역협회'];
const GLOBAL_SOURCE_ALLOWLIST = ['reuters', 'bloomberg', 'financial times', 'ft', 'wall street journal', 'wsj', 'nikkei', 'economist', 'cnbc'];
const KOREAN_DOMAIN_ALLOWLIST = ['yna.co.kr', 'chosun.com', 'mk.co.kr', 'hankyung.com', 'sedaily.com', 'news1.kr', 'joins.com', 'donga.com', 'kotra.or.kr', 'kita.net', 'customs.go.kr'];
const GLOBAL_DOMAIN_ALLOWLIST = ['reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'nikkei.com', 'economist.com', 'cnbc.com'];
const MAX_ARTICLES_PER_CATEGORY = 5;

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
        /©\s*\d{4}.*?All Rights Reserved/gi,
        /경제\s*>\s*[^ ]+/g, /국제\s*>\s*[^ ]+/g, /금융\s*>\s*[^ ]+/g,
        /입력\s*:\s*\d{4}\.\d{2}\.\d{2}[^ ]*/g, /업데이트\s*:\s*\d{4}\.\d{2}\.\d{2}[^ ]*/g,
        /주소\s*:\s*[^.]+/g, /전화\s*:\s*[\d-]+/g, /등록일자\s*:\s*[\d.]+/g,
        /발행\/편집인\s*:\s*[^.]+/g, /연합뉴스 경제 최신기사/g, /Nikkei staff writers/gi,
        /Reuters[A-Z\s,&.-]+/g, /[A-Z]{2,}\s+\d{4}년\s*\d{1,2}월\s*\d{1,2}일[^.]+/g
    ];
    boilerplate.forEach(regex => clean = clean.replace(regex, ''));
    clean = clean.replace(/^[가-힣]+\([가-힣]+\)\s*=\s*/g, '');
    clean = clean.replace(/^\d{4}[./-]\d{1,2}[./-]\d{1,2}[^가-힣A-Za-z0-9]+/g, '');
    clean = clean.replace(/[^\u0000-\u007F\u3131-\uD79D\s,.?!()"'\[\]]/g, "");
    return clean.replace(/\s+/g, ' ').trim();
}

function normalizeSourceName(url, sourceName) {
    const lowerUrl = (url || '').toLowerCase();
    const lowerSource = (sourceName || '').toLowerCase();

    if (lowerUrl.includes('economist.com') || lowerSource.includes('finance & economics')) return 'The Economist';
    if (lowerUrl.includes('nikkei.com')) return 'Nikkei Asia';
    if (lowerUrl.includes('ft.com')) return 'Financial Times';
    if (lowerUrl.includes('wsj.com') || lowerUrl.includes('a.dj.com')) return 'WSJ';
    if (lowerUrl.includes('cnbc.com')) return 'CNBC';
    if (lowerUrl.includes('yna.co.kr')) return '연합뉴스';
    if (lowerUrl.includes('mk.co.kr')) return '매일경제';
    if (lowerUrl.includes('hankyung.com')) return '한국경제';
    if (lowerUrl.includes('sedaily.com')) return '서울경제';
    if (lowerUrl.includes('chosun.com')) return '조선비즈';

    return (sourceName || '').replace(/\s+/g, ' ').trim();
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

function isAllowedSource(categoryPrefix, sourceName, url) {
    const lowerSource = (sourceName || '').toLowerCase();
    const lowerUrl = (url || '').toLowerCase();
    const sourceAllowlist = categoryPrefix === 'kr' ? KOREAN_SOURCE_ALLOWLIST : GLOBAL_SOURCE_ALLOWLIST;
    const domainAllowlist = categoryPrefix === 'kr' ? KOREAN_DOMAIN_ALLOWLIST : GLOBAL_DOMAIN_ALLOWLIST;

    return sourceAllowlist.some(source => lowerSource.includes(source.toLowerCase())) ||
        domainAllowlist.some(domain => lowerUrl.includes(domain));
}

function keywordWeight(word) {
    const weakKeywords = ['trade', 'trades'];
    const mediumKeywords = ['import', 'imports', 'export', 'exports', 'fta', '환율', '외환거래', '국제수지'];
    if (weakKeywords.includes(word)) return 1;
    if (mediumKeywords.includes(word)) return 2;
    return 3;
}

function isRelevant(title, content) {
    const text = (title + ' ' + content).toLowerCase();
    const hasBlacklist = BLACKLIST_KEYWORDS.some(word => text.includes(word));
    if (hasBlacklist) return false;

    const koScore = TRADE_KEYWORDS
        .filter(word => text.includes(word.toLowerCase()))
        .reduce((sum, word) => sum + keywordWeight(word.toLowerCase()), 0);
    const globalScore = GLOBAL_TRADE_KEYWORDS
        .filter(word => text.includes(word))
        .reduce((sum, word) => sum + keywordWeight(word), 0);

    return koScore + globalScore >= 2;
}

function splitSentences(text) {
    return (text || '')
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?。])\s+|(?<=다\.)\s+|(?<=요\.)\s+/)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length >= 40);
}

function normalizeSentence(sentence) {
    return sentence
        .replace(/["“”]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\([^)]*\)/g, '')
        .replace(/^[^가-힣A-Za-z0-9]+/, '')
        .trim();
}

function scoreSentence(sentence) {
    const text = sentence.toLowerCase();
    const keywordHits = TRADE_KEYWORDS.filter(word => text.includes(word.toLowerCase())).length +
        GLOBAL_TRADE_KEYWORDS.filter(word => text.includes(word)).length;
    const numberHits = (sentence.match(/\d+(?:[.,]\d+)?%?/g) || []).length;
    return keywordHits * 3 + numberHits;
}

function compactKoreanSentence(sentence) {
    const cleaned = normalizeSentence(sentence)
        .replace(/^(경제|국제|금융)\s*>\s*[^ ]+\s*/g, '')
        .replace(/^\d{4}[./년-]\s*\d{1,2}[./월-]\s*\d{1,2}[^가-힣A-Za-z0-9]+/g, '')
        .replace(/^[A-Z][A-Z\s,&.-]{6,}/g, '')
        .replace(/(라고|이라며|이라고)\s[^.]+/g, '')
        .replace(/무단 전재.*$/g, '')
        .replace(/All rights reserved.*$/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return '';
    const shortened = cleaned.length > 180 ? `${cleaned.slice(0, 177).trim()}...` : cleaned;
    const polished = shortened.replace(/다다\./g, '다.').replace(/\.\.\.다\./g, '...');
    if (polished.endsWith('다.') || polished.endsWith('요.') || polished.endsWith('.')) return polished;
    return `${polished}다.`;
}

function pickKeySentences(rawText) {
    const ranked = splitSentences(rawText)
        .map(sentence => ({ sentence, score: scoreSentence(sentence) }))
        .sort((a, b) => b.score - a.score || b.sentence.length - a.sentence.length);

    const selected = [];
    for (const item of ranked) {
        const normalized = item.sentence.toLowerCase();
        if (selected.some(existing => existing.toLowerCase().slice(0, 30) === normalized.slice(0, 30))) {
            continue;
        }
        selected.push(item.sentence);
        if (selected.length === 3) break;
    }

    return selected;
}

function buildImportance(summary, title) {
    const text = `${title} ${summary}`.toLowerCase();

    if (text.includes('관세') || text.includes('tariff')) {
        return '관세 정책 변화는 기업의 가격 경쟁력과 수출 채산성에 직접 영향을 주기 때문에 향후 주문과 투자 판단의 핵심 변수다.';
    }
    if (text.includes('환율') || text.includes('외환') || text.includes('exchange rate') || text.includes('fx')) {
        return '환율과 외환 흐름의 변화는 수출입 단가와 기업 실적 전망을 동시에 흔들 수 있어 무역 전략 재조정이 필요하다.';
    }
    if (text.includes('해상운임') || text.includes('물류') || text.includes('shipping') || text.includes('freight')) {
        return '국제물류 비용과 운송 차질은 납기와 마진을 함께 압박해 글로벌 공급망 운영 전반에 부담을 준다.';
    }
    if (text.includes('수출') || text.includes('import') || text.includes('export')) {
        return '수출입 흐름 변화는 업종별 실적뿐 아니라 교역 상대국과의 통상 환경을 가늠하는 선행 신호로 볼 수 있다.';
    }

    return '이번 이슈는 통상 정책과 공급망 환경 변화가 기업의 해외 영업과 투자 판단에 어떤 영향을 주는지 보여준다.';
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

        if (article && article.textContent && article.textContent.length > 250) {
            return cleanContent(article.textContent, title);
        }
        return null;
    } catch (e) {
        return null;
    }
}

function extractFeedText(item, title) {
    return cleanContent(
        item['content:encoded'] ||
        item.content ||
        item.description ||
        item.contentSnippet ||
        '',
        title
    );
}

async function generateStructuredSummary(rawText, title) {
    if ((!rawText || rawText.length < 20) && !title) return null;

    const keySentences = pickKeySentences(rawText);
    const summaryInputs = keySentences.length >= 2
        ? keySentences.slice(0, 3)
        : [title, rawText].filter(Boolean);

    const translated = await Promise.all(summaryInputs.map(sentence => safeTranslate(sentence)));
    const summarySentences = translated.map(compactKoreanSentence).filter(Boolean);

    const uniqueSentences = [];
    for (const sentence of summarySentences) {
        const normalized = sentence.replace(/\s+/g, '').slice(0, 40);
        if (uniqueSentences.some(existing => existing.replace(/\s+/g, '').slice(0, 40) === normalized)) {
            continue;
        }
        uniqueSentences.push(sentence);
    }

    if (uniqueSentences.length < 2) return null;

    const summary = uniqueSentences.slice(0, 3).join(' ');
    const impact = buildImportance(summary, title);

    return { summary, impact };
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
    const seenTitles = new Set();
    console.log(`[${categoryPrefix}] Starting multi-feed aggregation...`);

    for (const rssUrl of rssUrls) {
        if (results.length >= MAX_ARTICLES_PER_CATEGORY) break;
        console.log(`   [${categoryPrefix}] Fetching: ${rssUrl}`);

        try {
            const response = await axios.get(rssUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                timeout: 10000
            });
            const feed = await parser.parseString(response.data);
            const candidates = feed.items.slice(0, 50);

            for (const item of candidates) {
                if (!item?.title || !item?.link) continue;
                if (/^\[표\]/.test(item.title.trim())) continue;
                const rawTitle = item.title.includes(' - ') ? item.title.split(' - ').slice(0, -1).join(' - ').trim() : item.title.trim();
                const sourceNameRaw = item.title.includes(' - ') ? item.title.split(' - ').pop().trim() : (feed.title || (categoryPrefix === 'kr' ? '국내 언론' : 'International News'));
                const sourceName = normalizeSourceName(item.link, sourceNameRaw);
                const normalizedTitle = rawTitle.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);

                if (seenTitles.has(normalizedTitle)) continue;
                if (!isAllowedSource(categoryPrefix, sourceName, item.link)) continue;

                if (!isRelevant(rawTitle, item.contentSnippet || "")) {
                    continue;
                }

                let rawText = await fetchFullText(item.link, rawTitle);
                if (!rawText) {
                    rawText = extractFeedText(item, rawTitle);
                }
                if (!rawText) continue;

                if (!isRelevant(rawTitle, rawText)) continue;

                const resultObj = await generateStructuredSummary(rawText, rawTitle);
                if (!resultObj) continue;

                const finalTitle = await safeTranslate(rawTitle);

                if (!resultObj.summary || resultObj.summary.length < 40) continue;

                seenTitles.add(normalizedTitle);

                results.push({
                    id: `${categoryPrefix}-${results.length + 1}-${Date.now()}`,
                    title: finalTitle,
                    summary: resultObj.summary,
                    impact: resultObj.impact,
                    source: sourceName,
                    link: item.link,
                    pubDate: new Date(item.pubDate).getTime() || Date.now()
                });

                console.log(`   [${categoryPrefix}] ✓ Article ${results.length}/${MAX_ARTICLES_PER_CATEGORY}: ${finalTitle.substring(0, 30)}...`);
                if (results.length >= MAX_ARTICLES_PER_CATEGORY) break;
            }
        } catch (err) {
            console.error(`   [${categoryPrefix}] ✗ Feed Error (${rssUrl}): ${err.message}`);
        }
    }
    return results
        .sort((a, b) => b.pubDate - a.pubDate)
        .slice(0, MAX_ARTICLES_PER_CATEGORY);
}

async function updateNewsData() {
    console.log(`[${new Date().toISOString()}] Updating News (${MAX_ARTICLES_PER_CATEGORY} Items Per Category Target)...`);
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
