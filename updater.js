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
    'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml',
    'http://feeds.bbci.co.uk/news/business/rss.xml',
    'http://feeds.bbci.co.uk/news/world/rss.xml'
];

const TRADE_KEYWORDS = ['관세', '통관', '수출금액', '수입금액', '수출규제', '수입규제', '미국관세', '자유무역', '보호무역', 'fta', '원산지규정', '수출지원제도', '코트라', '무역협회', '관세청', '세관', '수출바우처', '해외전시회', '글로벌무역환경', '관세장벽', '비관세장벽', '해외규격인증', '국제수지', '환율', '외환거래', '무역제재', '해외무역관', '수출기업', '해외무역', '국제무역', '글로벌밸류체인', '글로벌벨류체인', '무역계약', '국제물류', '해상운임'];
const GLOBAL_TRADE_KEYWORDS = ['tariff', 'tariffs', 'customs', 'export', 'exports', 'import', 'imports', 'trade', 'free trade', 'protectionism', 'fta', 'rules of origin', 'trade support', 'kotra', 'kita', 'customs service', 'trade barrier', 'non-tariff barrier', 'certification', 'current account', 'exchange rate', 'fx', 'foreign exchange', 'sanctions', 'trade mission', 'exporter', 'international trade', 'global value chain', 'value chain', 'shipping', 'freight', 'ocean freight', 'supply chain', 'trade agreement', 'trade policy', 'trade restriction', 'trade surplus', 'trade deficit'];
const BLACKLIST_KEYWORDS = ['sports', 'espn', 'nhl', 'nba', 'mlb', 'nfl', 'entertainment', 'celebrity', 'movie', 'music', '결혼', '연예', '스포츠', '야구', '축구', '농구', '골프', '드라마', 'player', 'coach', 'game score', 'highlights', 'trade deadline', 'draft pick', 'signing', 'lottery', 'sweepstakes', 'momentum trade', 'trading strategy', 'options trade', 'options', 'buying opportunity', 'investing club', 'stock market', 'market data', 'sell-off'];
const KOREAN_SOURCE_ALLOWLIST = ['연합뉴스', '조선비즈', '매일경제', '한국경제', '서울경제', 'kotra', '코트라', '무역협회', '관세청', '세관', '뉴스1', '중앙일보', '동아일보', '한국무역협회'];
const GLOBAL_SOURCE_ALLOWLIST = ['reuters', 'bloomberg', 'financial times', 'ft', 'wall street journal', 'wsj', 'nikkei', 'economist', 'cnbc', 'bbc'];
const KOREAN_DOMAIN_ALLOWLIST = ['yna.co.kr', 'chosun.com', 'mk.co.kr', 'hankyung.com', 'sedaily.com', 'news1.kr', 'joins.com', 'donga.com', 'kotra.or.kr', 'kita.net', 'customs.go.kr'];
const GLOBAL_DOMAIN_ALLOWLIST = ['reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'nikkei.com', 'economist.com', 'cnbc.com', 'bbc.com'];
const MAX_ARTICLES_PER_CATEGORY = 5;
const MIN_SUMMARY_WORDS = 80;

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
        /Reuters[A-Z\s,&.-]+/g, /[A-Z]{2,}\s+\d{4}년\s*\d{1,2}월\s*\d{1,2}일[^.]+/g,
        /Standard Digital[^.]*\./gi, /Premium Digital[^.]*\./gi,
        /unlock this article[^.]*\./gi, /subscribe[^.]*access[^.]*\./gi,
        /pay yearly[^.]*\./gi, /save \d+%[^.]*\./gi,
        /이 기사를 잠금 해제하려면 구독하세요[^.]*\./g, /무제한 액세스를 시도하세요[^.]*\./g,
        /1년 선불로 지불하고[^.]*\./g, /월\s*\d+[,.]?\d*[^.]*\./g,
        /4주 동안[^.]*\./g
    ];
    boilerplate.forEach(regex => clean = clean.replace(regex, ''));
    clean = clean.replace(/^[가-힣]+\([가-힣]+\)\s*=\s*/g, '');
    clean = clean.replace(/^\d{4}[./-]\d{1,2}[./-]\d{1,2}[^가-힣A-Za-z0-9]+/g, '');
    clean = clean.replace(/[^\u0000-\u007F\u3131-\uD79D\s,.?!()"'\[\]]/g, "");
    return clean.replace(/\s+/g, ' ').trim();
}

function isPaywallNoise(text) {
    const sample = (text || '').toLowerCase();
    return ['standard digital', 'premium digital', 'unlock this article', 'subscribe', '무제한 액세스', '이 기사를 잠금 해제하려면', '1년 선불로 지불', 'ft weekend', '고품질 ft 저널리즘', '완전한 디지털 액세스', '체험 기간 중 언제든지 취소', '모든 구독 범위를 살펴보세요', '더 많은 혜택을 살펴보세요']
        .some(pattern => sample.includes(pattern));
}

function normalizeSourceName(url, sourceName) {
    const lowerUrl = (url || '').toLowerCase();
    const lowerSource = (sourceName || '').toLowerCase();

    if (lowerUrl.includes('economist.com') || lowerSource.includes('finance & economics')) return 'The Economist';
    if (lowerUrl.includes('nikkei.com')) return 'Nikkei Asia';
    if (lowerUrl.includes('ft.com')) return 'Financial Times';
    if (lowerUrl.includes('wsj.com') || lowerUrl.includes('a.dj.com')) return 'WSJ';
    if (lowerUrl.includes('cnbc.com')) return 'CNBC';
    if (lowerUrl.includes('bbc.com') || lowerUrl.includes('bbci.co.uk')) return 'BBC';
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

function relevanceScore(title, content) {
    const text = (title + ' ' + content).toLowerCase();
    const hasBlacklist = BLACKLIST_KEYWORDS.some(word => text.includes(word));
    if (hasBlacklist) return -1;

    const koScore = TRADE_KEYWORDS
        .filter(word => text.includes(word.toLowerCase()))
        .reduce((sum, word) => sum + keywordWeight(word.toLowerCase()), 0);
    const globalScore = GLOBAL_TRADE_KEYWORDS
        .filter(word => text.includes(word))
        .reduce((sum, word) => sum + keywordWeight(word), 0);

    return koScore + globalScore;
}

function isRelevant(title, content, categoryPrefix = 'kr') {
    const score = relevanceScore(title, content);
    if (score < 0) return false;

    const titleText = (title || '').toLowerCase();
    const titleHasTradeKeyword = [...TRADE_KEYWORDS, ...GLOBAL_TRADE_KEYWORDS]
        .some(word => titleText.includes(word.toLowerCase()));

    if (categoryPrefix === 'gl') {
        return score >= 2 || (score >= 1 && titleHasTradeKeyword);
    }

    return score >= 2;
}

function splitSentences(text) {
    return (text || '')
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?。])\s+|(?<=다\.)\s+|(?<=요\.)\s+/)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length >= 40);
}

function enforceSentenceSpacing(text) {
    return (text || '')
        .replace(/\s+/g, ' ')
        .replace(/\.{2,}/g, '.')
        .replace(/(?<!\d)\.(?!\d)\s*/g, '. ')
        .replace(/\s+([,!?])/g, '$1')
        .trim();
}

function normalizeSentence(sentence) {
    return sentence
        .replace(/["“”]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\([^)]*\)/g, '')
        .replace(/^[^가-힣A-Za-z0-9]+/, '')
        .trim();
}

function isUsableSummarySentence(sentence) {
    const text = (sentence || '').trim();
    if (!text || text.length < 30) return false;
    if (text.length > 150) return false;

    const bannedPatterns = [
        /기자/,
        /좋아요/,
        /이미지 확대/,
        /관련기사/,
        /무단 전재/,
        /All rights reserved/i,
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
        /#/,
        /MI/,
        /닫기/,
        /속보/,
        /Copyright/i,
        /RSS/i,
        /^\d{1,2}\s+\d{2}/,
        /^\d{4}\s+\d{1,2}\s+\d{1,2}/
    ];

    if (bannedPatterns.some(pattern => pattern.test(text))) return false;
    if ((text.match(/[,:;]/g) || []).length >= 5) return false;
    return true;
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
        .replace(/^[가-힣A-Za-z\s]+기자\s*=\s*/g, '')
        .replace(/\b(?:JST|KST|EST|GMT|UTC)\b/gi, '')
        .replace(/\b[A-Z]{2,}\s*--\s*/g, '')
        .replace(/(라고|이라며|이라고)\s[^.]+/g, '')
        .replace(/(보도했다|밝혔다|설명했다|전했다|분석했다|평가했다)\.$/g, '했다.')
        .replace(/무단 전재.*$/g, '')
        .replace(/All rights reserved.*$/gi, '')
        .replace(/기사\s*전문.*$/g, '')
        .replace(/관련기사.*$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return '';
    const shortened = cleaned.length > 150 ? `${cleaned.slice(0, 147).trim()}` : cleaned;
    const polished = enforceSentenceSpacing(shortened.replace(/다다\./g, '다.'));
    if (!polished) return '';
    if (polished.endsWith('다.') || polished.endsWith('요.') || polished.endsWith('.')) return polished;
    return `${polished}.`;
}

function pickKeySentences(rawText) {
    const ranked = splitSentences(rawText)
        .filter(isUsableSummarySentence)
        .map(sentence => ({ sentence, score: scoreSentence(sentence) }))
        .sort((a, b) => b.score - a.score || b.sentence.length - a.sentence.length);

    const selected = [];
    for (const item of ranked) {
        const normalized = item.sentence.toLowerCase();
        if (selected.some(existing => existing.toLowerCase().slice(0, 30) === normalized.slice(0, 30))) {
            continue;
        }
        selected.push(item.sentence);
        if (selected.length === 8) break;
    }

    return selected;
}

function buildFallbackInputs(rawText) {
    return splitSentences(rawText)
        .filter(isUsableSummarySentence)
        .slice(0, 10);
}

function normalizeSummaryCandidate(sentence) {
    return enforceSentenceSpacing(
        compactKoreanSentence(sentence)
            .replace(/[‘’“”"']/g, '')
            .replace(/^[^가-힣A-Za-z0-9]+/g, '')
            .replace(/^\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*/g, '')
            .replace(/^\d{1,2}일\s*/g, '')
            .replace(/^(이 기사|해당 기사|이 보도)는\s*/g, '')
            .replace(/^(정책|국제|경제|산업|기업|금융)\s*/g, '')
            .replace(/^[가-힣\s]+기자\s*\d{1,2}\s*\d{2}\s*/g, '')
            .replace(/^미국[, ]+/g, '미국은 ')
            .replace(/^한국[, ]+/g, '한국은 ')
            .replace(/(것으로 보인다|것으로 전망된다)\./g, '것으로 예상된다.')
            .replace(/\s*:\s*/g, ' ')
    );
}

function rewriteTitleAsLead(title) {
    const sentence = enforceSentenceSpacing(
        (title || '')
            .replace(/美/g, '미국')
            .replace(/韓/g, '한국')
            .replace(/[‘’“”"']/g, '')
            .replace(/[…·]/g, ' ')
            .replace(/[<>]/g, '')
            .replace(/[|]/g, ' ')
            .replace(/\s*[:\-]\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    );

    if (!sentence) return '';
    const base = sentence
        .replace(/ 전망 속 /g, ' 가운데 ')
        .replace(/ 우려도$/g, ' 우려가 커지고 있다')
        .replace(/ 확정$/g, ' 확정됐다')
        .replace(/ 상향$/g, ' 상향됐다')
        .replace(/ 증가$/g, ' 증가했다')
        .replace(/ 시작$/g, ' 시작됐다')
        .replace(/ 타격합니다$/g, ' 타격을 주고 있다')
        .replace(/ 우려하고 있다\.$/g, ' 우려가 커지고 있다.')
        .replace(/ 답했습니다\.$/g, ' 대응했다.');

    if (/(다|요|니다)\.$/.test(base)) return base;
    return `${base}.`;
}

function buildTemplateDetail(title, rawText) {
    const text = `${title} ${rawText}`.toLowerCase();

    if (text.includes('걸프만') || text.includes('석유') || text.includes('oil') || text.includes('hormuz') || text.includes('홍해')) {
        return '핵심은 중동발 군사 충돌이 에너지 수출 경로와 국제 운송 흐름을 동시에 흔들며 원자재 가격과 물류비를 밀어 올리고 있다는 점이다.';
    }
    if (text.includes('trade war') || text.includes('무역전쟁')) {
        return '핵심은 지정학 갈등이 관세와 대중 견제 논리를 다시 자극하면서 미중 통상 갈등의 강도를 높일 수 있다는 데 있다.';
    }
    if (text.includes('수입규제') || text.includes('컨설팅 지원')) {
        return '정부는 예산과 기업당 지원 한도를 동시에 늘려 중소·중견기업의 통상 대응 부담을 낮추기로 했다.';
    }
    if (text.includes('301조')) {
        return '기존 관세 부담은 유지될 가능성이 거론되지만, 품목별 추가 조치 가능성도 함께 제기된다.';
    }
    if (text.includes('무관세')) {
        return '국제 품목 분류 기준이 한국 측 주장대로 정리되면서 주요 시장에서 가격 경쟁력 개선이 기대된다.';
    }
    if (text.includes('현대차') || text.includes('기아') || text.includes('폭스바겐')) {
        return '관세와 경쟁 심화 속에서도 현지화 전략과 고수익 차종 판매가 수익성 방어에 기여한 것으로 해석된다.';
    }
    if (text.includes('수출') && text.includes('증가')) {
        return '반도체 중심의 수출 호조가 이어지면서 주요 시장 전반에서 증가 폭이 확대된 것으로 나타났다.';
    }
    if (text.includes('airfreight') || text.includes('항공 화물') || text.includes('도하') || text.includes('두바이')) {
        return '중동 허브 공항 운영 차질이 이어지면서 아시아와 유럽을 잇는 긴급 물류망의 불안도 커지고 있다.';
    }
    if (text.includes('made in europe') || text.includes('메이드 인 유럽')) {
        return '중국 견제를 겨냥한 유럽 산업정책이 동맹국 기업에는 새로운 비관세 장벽으로 작용할 수 있다는 우려가 나온다.';
    }
    if (text.includes('무역 조사') || text.includes('trade probe')) {
        return '기존 조치의 법적 정당성이 흔들린 뒤 미국이 새 절차에 나서면서 추가 관세 부과 가능성이 다시 커졌다.';
    }
    if (text.includes('무역 혼란')) {
        return '관세를 둘러싼 법적·정치적 충돌이 이어지면서 미국 통상정책의 변동성이 장기화할 가능성이 크다.';
    }
    if (text.includes('관세 위협') || text.includes('tariff threat')) {
        return '사법 판단 이후에도 관세 카드를 다시 꺼내 들면서 대외 통상 환경의 불확실성이 더 커졌다는 평가가 나온다.';
    }

    return '';
}

function buildTemplateBackground(title, rawText) {
    const text = `${title} ${rawText}`.toLowerCase();

    if (text.includes('걸프만') || text.includes('석유') || text.includes('oil') || text.includes('hormuz') || text.includes('홍해')) {
        return '호르무즈 해협과 홍해는 원유와 컨테이너 물동량이 겹치는 전략 요충지여서, 이 구간의 차질은 정유·화학 원가와 글로벌 선복 운영에 곧바로 반영될 수 있다.';
    }
    if (text.includes('trade war') || text.includes('무역전쟁')) {
        return '미국의 대중 강경 기조와 중동 변수까지 겹치면 외교·안보 이슈가 다시 관세와 수출규제 논리로 번질 가능성이 높다는 점이 배경으로 지목된다.';
    }
    if (text.includes('301조')) {
        return '배경에는 미국이 자국 산업 보호와 세수 확보를 동시에 노리며 통상 압박 수단을 다시 확대하고 있다는 판단이 깔려 있다.';
    }
    if (text.includes('수입규제') || text.includes('컨설팅 지원')) {
        return '최근 미국과 주요 교역국의 반덤핑, 상계관세, 세이프가드 조치가 늘면서 중소·중견 수출기업의 대응 비용도 빠르게 커진 상황이다.';
    }
    if (text.includes('무관세')) {
        return '품목 분류가 달라지면 동일 제품이라도 국가별 세율이 크게 달라질 수 있어 국제 기준 확정 자체가 수출 경쟁력과 직결된다.';
    }
    if (text.includes('현대차') || text.includes('기아') || text.includes('폭스바겐')) {
        return '완성차 업계는 전기차 수요 둔화와 지역별 통상 장벽 강화가 동시에 진행되는 환경에서 생산지 재편과 차종 믹스 조정을 병행해 왔다.';
    }
    if (text.includes('수출') && text.includes('증가')) {
        return '월초 수출 지표는 당월 전체 교역 흐름을 가늠하는 선행 자료로 활용되며, 주요 시장별 회복 속도를 함께 보여준다는 점에서 의미가 있다.';
    }
    if (text.includes('airfreight') || text.includes('항공 화물') || text.includes('도하') || text.includes('두바이')) {
        return '중동은 아시아와 유럽을 잇는 항공 화물의 핵심 환적 거점이어서 해당 지역 충격은 반도체, 의약품, 고부가가치 소비재 운송에 곧바로 영향을 준다.';
    }
    if (text.includes('made in europe') || text.includes('메이드 인 유럽')) {
        return '유럽연합이 중국발 공급 과잉에 대응해 역내 산업 육성 색채를 강화하면서, 비유럽권 제조업체에는 시장 접근 요건이 더 까다로워질 가능성이 제기된다.';
    }
    if (text.includes('무역 조사') || text.includes('trade probe')) {
        return '법원 판단으로 기존 관세 조치의 근거가 흔들린 뒤에도 미국 정부가 새 조사 절차를 통해 통상 압박을 이어가려는 흐름으로 읽힌다.';
    }
    if (text.includes('무역 혼란')) {
        return '미국 통상정책은 법원 판결, 행정부 대응, 의회와 대선 정치가 맞물리며 단기 이슈가 아니라 구조적 불확실성으로 번지는 모습이다.';
    }
    if (text.includes('관세 위협') || text.includes('tariff threat')) {
        return '사법부 제동에도 불구하고 행정부가 새로운 관세 카드를 검토하면서 기업들은 계약, 가격, 재고 전략을 다시 조정해야 하는 상황에 놓였다.';
    }

    return '이번 보도는 통상 규제와 공급망 변화가 실제 거래 조건과 수출 전략에 어떻게 연결되는지를 보여주는 사례로 볼 수 있다.';
}

function buildTemplateImplication(title, rawText) {
    const text = `${title} ${rawText}`.toLowerCase();

    if (text.includes('걸프만') || text.includes('석유') || text.includes('oil') || text.includes('hormuz') || text.includes('홍해')) {
        return '에너지 의존도가 높거나 장거리 해상 운송 비중이 큰 수출기업은 유가, 운임, 보험료 상승을 함께 반영해 조달과 출하 계획을 재점검할 필요가 있다.';
    }
    if (text.includes('trade war') || text.includes('무역전쟁')) {
        return '수출기업 입장에서는 미중 관계 악화가 추가 관세, 공급망 재편, 대체시장 확보 이슈로 연결될 수 있어 지역별 영업 전략을 다시 짜야 한다.';
    }
    if (text.includes('관세') || text.includes('tariff')) {
        return '실무적으로는 수출 단가 산정, 원산지 검토, 미국향 투자와 생산 배분 전략을 다시 점검해야 한다는 뜻으로 해석된다.';
    }
    if (text.includes('수입규제') || text.includes('규제')) {
        return '기업 입장에서는 조사 대응 자료, 법률 자문, 원가 구조 정비를 선제적으로 준비해야 규제 확대에 따른 손실을 줄일 수 있다.';
    }
    if (text.includes('수출') || text.includes('import') || text.includes('export')) {
        return '수출기업과 물류 담당자는 시장별 수요 변화와 통관 여건을 함께 확인하면서 계약 일정과 출하 계획을 보수적으로 조정할 필요가 있다.';
    }
    if (text.includes('물류') || text.includes('shipping') || text.includes('freight')) {
        return '공급망 측면에서는 대체 운송 경로 확보와 재고 완충 전략이 중요해지며, 항공·해상 운임 변동성 관리도 핵심 과제로 떠오른다.';
    }
    if (text.includes('환율') || text.includes('외환') || text.includes('fx')) {
        return '환율 민감도가 높은 업종은 결제 조건과 환헤지 전략을 조정하지 않으면 마진 변동성이 커질 수 있다.';
    }

    return '결국 이번 이슈는 통상 정책 변화가 계약 조건, 시장 접근성, 공급망 운영에 어떤 부담을 주는지 점검해야 한다는 신호로 읽힌다.';
}

function buildNumericSentence(sentences) {
    const numeric = sentences.find(sentence => /\d+(?:[.,]\d+)?%|\d+(?:[.,]\d+)?억|\d+(?:[.,]\d+)?조|\d+(?:[.,]\d+)?달러/.test(sentence));
    if (!numeric) return '';

    const cleaned = normalizeSummaryCandidate(numeric)
        .replace(/했다\.$/, '한 것으로 파악된다.')
        .replace(/증가했다\.$/, '증가한 것으로 집계됐다.')
        .replace(/감소했다\.$/, '감소한 것으로 집계됐다.')
        .replace(/확정됐다\.$/, '확정된 상태다.');

    if (!cleaned) return '';
    return `구체적으로 ${cleaned}`;
}

function buildContextSentence(sentences, usedSentences) {
    const candidate = sentences.find(sentence => {
        const normalized = normalizeSummaryCandidate(sentence);
        if (!normalized) return false;
        if (usedSentences.has(normalized)) return false;
        return normalized.length >= 45;
    });

    if (!candidate) return '';

    const normalized = normalizeSummaryCandidate(candidate)
        .replace(/했다\.$/, '한 상황이다.')
        .replace(/있다\.$/, '있는 상황이다.')
        .replace(/예상된다\.$/, '는 분석이 나온다.');

    return normalized ? `배경으로는 ${normalized.charAt(0).toLowerCase() === normalized.charAt(0) ? normalized : normalized}` : '';
}

function countWords(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function splitParagraphToSentences(text) {
    return (text || '')
        .split(/(?<=\.)\s+/)
        .map(sentence => enforceSentenceSpacing(sentence).trim())
        .filter(Boolean);
}

function classifySummarySentence(sentence, title) {
    const text = `${title} ${sentence}`.toLowerCase();
    if (/\d+(?:[.,]\d+)?%|\d+(?:[.,]\d+)?억|\d+(?:[.,]\d+)?조|\d+(?:[.,]\d+)?달러/.test(sentence)) return 'detail';
    if (text.includes('관세') || text.includes('tariff') || text.includes('규제') || text.includes('restriction')) return 'lead';
    if (text.includes('수출') || text.includes('수입') || text.includes('export') || text.includes('import')) return 'lead';
    if (text.includes('환율') || text.includes('외환') || text.includes('해상운임') || text.includes('물류') || text.includes('shipping')) return 'context';
    if (text.includes('배경') || text.includes('영향') || text.includes('압박') || text.includes('대응')) return 'context';
    return 'detail';
}

function buildSummaryFromCandidates(title, translatedTitle, sentences, translatedExcerpt = '') {
    const normalizedSentences = [];
    const seen = new Set();

    for (const raw of [...sentences, ...splitParagraphToSentences(translatedExcerpt)]) {
        const sentence = normalizeSummaryCandidate(raw);
        if (!sentence || !isUsableSummarySentence(sentence)) continue;
        const key = sentence.replace(/\s+/g, '').slice(0, 42);
        if (seen.has(key)) continue;
        seen.add(key);
        normalizedSentences.push(sentence);
    }

    const titleLead = rewriteTitleAsLead(translatedTitle || title);
    const detail = buildTemplateDetail(translatedTitle || title, normalizedSentences.join(' '));
    const background = buildTemplateBackground(translatedTitle || title, normalizedSentences.join(' '));
    const implication = buildTemplateImplication(translatedTitle || title, normalizedSentences.join(' '));
    const numeric = buildNumericSentence(normalizedSentences);
    const usedSentences = new Set([titleLead, detail, background, implication, numeric].filter(Boolean));
    const context = buildContextSentence(normalizedSentences, usedSentences);

    const summaryParts = [titleLead, detail, background, numeric, context, implication]
        .filter(Boolean)
        .filter((sentence, index, array) => array.findIndex(item => item.replace(/\s+/g, '').slice(0, 32) === sentence.replace(/\s+/g, '').slice(0, 32)) === index);

    let summary = enforceSentenceSpacing(summaryParts.join(' '));

    if (countWords(summary) < MIN_SUMMARY_WORDS) {
        const extras = normalizedSentences
            .map(sentence => normalizeSummaryCandidate(sentence))
            .filter(Boolean)
            .filter(sentence => !summaryParts.some(existing => existing.replace(/\s+/g, '').slice(0, 32) === sentence.replace(/\s+/g, '').slice(0, 32)))
            .slice(0, 5)
            .map(sentence => sentence
                .replace(/했다\.$/, '한 것으로 전해진다.')
                .replace(/있다\.$/, '있는 상태다.')
            );

        summary = enforceSentenceSpacing([summary, ...extras].join(' '));
    }

    return countWords(summary) >= MIN_SUMMARY_WORDS ? summary : null;
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
            const cleaned = cleanContent(article.textContent, title);
            if (cleaned && !isPaywallNoise(cleaned)) {
                return cleaned;
            }
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
    const fallbackInputs = buildFallbackInputs(rawText);
    const summaryInputs = keySentences.length >= 3
        ? keySentences.slice(0, 8)
        : fallbackInputs.length >= 3
            ? fallbackInputs.slice(0, 8)
            : [title, rawText.slice(0, 2000)].filter(Boolean);

    const [translatedTitle, translatedExcerpt, ...translated] = await Promise.all([
        safeTranslate(title),
        safeTranslate(rawText.slice(0, 2200)),
        ...summaryInputs.map(sentence => safeTranslate(sentence))
    ]);
    const sanitizedExcerpt = isPaywallNoise(translatedExcerpt) ? '' : translatedExcerpt;
    const sanitizedSentences = translated.filter(sentence => !isPaywallNoise(sentence));
    const summary = buildSummaryFromCandidates(title, translatedTitle, sanitizedSentences, sanitizedExcerpt);
    if (!summary || countWords(summary) < MIN_SUMMARY_WORDS) return null;
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

                if (!isRelevant(rawTitle, item.contentSnippet || "", categoryPrefix)) {
                    continue;
                }

                let rawText = await fetchFullText(item.link, rawTitle);
                if (!rawText) {
                    rawText = extractFeedText(item, rawTitle);
                }
                if (!rawText) continue;

                if (!isRelevant(rawTitle, rawText, categoryPrefix)) continue;

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
