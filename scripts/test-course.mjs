// コースページ取得テスト
// 使い方: node test-course.mjs <id> <password>

const WEBCLASS = 'https://gymnast15.med.kagawa-u.ac.jp/webclass';

// 分子生物学（テスト用）
const TEST_COURSE_ID = '8d5215783015764ce951cc9024a8efa9';

function parseCookies(res, jar = new Map()) {
    (res.headers.getSetCookie?.() ?? []).forEach(c => {
        const [nameVal] = c.split(';');
        const eq = nameVal.indexOf('=');
        if (eq > 0) jar.set(nameVal.slice(0, eq).trim(), nameVal.slice(eq + 1).trim());
    });
    return jar;
}
const cookieStr = jar => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function login(id, password) {
    const jar = new Map();
    const loginUrl = `${WEBCLASS}/login.php`;
    const r1 = await fetch(loginUrl);
    parseCookies(r1, jar);
    const html = await r1.text();
    const tokenMatch  = html.match(/name=["']token["']\s+value=["']([^"']+)["']/);
    const token       = tokenMatch?.[1] ?? '';
    const actionMatch = html.match(/action=["']([^"']*login\.php[^"']*)["']/);
    const postUrl     = actionMatch ? new URL(actionMatch[1], WEBCLASS).href : loginUrl;
    const body = new URLSearchParams({ username: id, val: password, login: 'ログイン', useragent: '', language: 'JAPANESE', token });
    const r2 = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieStr(jar) },
        body,
        redirect: 'manual',
    });
    parseCookies(r2, jar);
    let location = r2.headers.get('location');
    while (location) {
        const url = new URL(location, WEBCLASS).href;
        const r = await fetch(url, { headers: { Cookie: cookieStr(jar) }, redirect: 'manual' });
        parseCookies(r, jar);
        location = r.headers.get('location');
    }
    return jar;
}

// コースページのHTMLから締め切り情報を抽出
function parseCourseHtml(html) {
    const toISO = s => s.replace(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/, '$1-$2-$3T$4:$5');
    const items = [];

    // cl-contentsList_content ブロックを抽出（シングル/ダブル両対応）
    const blocks = html.split(/(?=<div[^>]+class=['"][^'"]*cl-contentsList_content)/);
    for (const block of blocks) {
        if (!block.includes('cl-contentsList_content')) continue;

        // タイトル抽出
        const titleMatch = block.match(/<a[^>]+href[^>]*>([\s\S]*?)<\/a>/);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : null;
        if (!title) continue;

        // 日付抽出（利用可能期間）
        const dates = block.match(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/g);
        if (!dates || dates.length < 2) continue;

        items.push({
            title,
            startDate: new Date(toISO(dates[0])),
            endDate:   new Date(toISO(dates[1])),
        });
    }
    return items;
}

const [id, password] = process.argv.slice(2);
if (!id || !password) { console.error('使い方: node test-course.mjs <id> <password>'); process.exit(1); }

const jar = await login(id, password);
console.log('ログイン完了 Cookie:', cookieStr(jar).slice(0, 60), '...\n');

const courseUrl = `${WEBCLASS}/course.php/${TEST_COURSE_ID}/login`;
console.log('コースURL:', courseUrl);

async function fetchFollowingJsRedirects(url, jar, depth = 0) {
    if (depth > 5) throw new Error('too many JS redirects');
    const r = await fetch(url, { headers: { Cookie: cookieStr(jar) }, redirect: 'follow' });
    parseCookies(r, jar);
    const html = await r.text();
    const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
    if (jsRedirect) {
        const next = new URL(jsRedirect[1], WEBCLASS).href;
        console.log(`JS redirect (${depth+1}):`, next);
        return fetchFollowingJsRedirects(next, jar, depth + 1);
    }
    return html;
}

const html = await fetchFollowingJsRedirects(courseUrl, jar);
console.log('HTML長さ:', html.length);
// cl- または cm- で始まるクラス名を全部抽出
const classNames = [...new Set([...html.matchAll(/class="([^"]+)"/g)].map(m => m[1]).join(' ').split(/\s+/).filter(c => c.startsWith('cl-') || c.startsWith('cm-')))];
console.log('cl-/cm- クラス一覧:', classNames);
// 利用可能期間の前後を確認
const periodIdx = html.indexOf('利用可能期間');
if (periodIdx >= 0) console.log('利用可能期間周辺:', html.slice(periodIdx - 100, periodIdx + 200));
else console.log('「利用可能期間」なし');
console.log();

const items = parseCourseHtml(html);
console.log(`課題/資料 ${items.length}件:`);
const now = new Date();
items.forEach(item => {
    const daysLeft = Math.ceil((item.endDate - now) / 86400000);
    const status = item.endDate < now ? '期限切れ' : `あと${daysLeft}日`;
    console.log(`  [${status}] ${item.title}`);
    console.log(`     ${item.startDate.toLocaleString('ja-JP')} ～ ${item.endDate.toLocaleString('ja-JP')}`);
});
