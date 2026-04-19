// 締め切り計算テスト（全コース）
// 使い方: node test-deadlines.mjs

const WEBCLASS = 'https://gymnast15.med.kagawa-u.ac.jp/webclass';
const GAS_URL  = process.env.GAS_URL;
const GAS_KEY  = process.env.GAS_ADMIN_KEY;

const COURSES = [
    { id: '8d5215783015764ce951cc9024a8efa9', name: '分子生物学'      },
    { id: 'fdc0989de1e818adafa59ccf8f40c39a', name: '分子遺伝学'      },
    { id: '3c58a2eebd8d277e8a23660cba8607f2', name: '医学と研究'      },
    { id: '38a9d09f451ee1cb82f6c6770d88ca9d', name: '医学・医療と社会' },
    { id: '14f26982e6d4628008ca1272a3a3cfcd', name: '医用化学Ⅱ'      },
    { id: '1af3888f3b4f25f3c99c6d09ca8bdbf7', name: '医療倫理学'      },
    { id: '9b3e1287ccdd818baae60be6ec73c9c1', name: '患者との出会い'   },
    { id: '19e2e404088da5a87f17b10be54392ce', name: '早期医学実習Ⅱ'  },
    { id: '49f9ee1ac60effa5895a47682fb6198e', name: '生化学'          },
    { id: '235d2308e5452e1b8e1cbcd801b9d6e2', name: '生理学Ⅱ'       },
    { id: '6d5e784a3c6676d64fae08ec8417ae70', name: '生理学Ⅰ'       },
    { id: '06b305e2e2aefec207ec25f0bf93018e', name: '細胞生物学'      },
    { id: '28e51271a617bb1de7d40b2472c43118', name: '行動科学'        },
    { id: '6b114e2b135f7aac169bc428f00951aa', name: '解剖学Ⅱ'       },
    { id: 'aea2184cf7cd67f5ea205f70e8a9a8ab', name: '解剖学Ⅰ'       },
];
const DISPLAY_NAME = '大井　峻';
const NOTIFY_DAYS  = 30; // テスト用に広めに

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
        body, redirect: 'manual',
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

async function fetchPage(url, jar, depth = 0) {
    if (depth > 5) throw new Error('too many JS redirects');
    const r = await fetch(url, { headers: { Cookie: cookieStr(jar) }, redirect: 'follow' });
    parseCookies(r, jar);
    const html = await r.text();
    const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
    if (jsRedirect) return fetchPage(new URL(jsRedirect[1], WEBCLASS).href, jar, depth + 1);
    return html;
}

function parseCourseHtml(html) {
    const toISO = s => s.replace(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/, '$1-$2-$3T$4:$5');
    const items = [];
    const blocks = html.split(/(?=<div[^>]+class=['"][^'"]*cl-contentsList_content['"\s])/);
    for (const block of blocks) {
        if (!block.includes('cl-contentsList_content')) continue;
        if (/利用回数/.test(block)) continue;
        const titleMatch = block.match(/data-contents-name="([^"]+)"/);
        const title = titleMatch ? titleMatch[1].trim() : null;
        if (!title) continue;
        const dates = block.match(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/g);
        if (!dates || dates.length < 2) continue;
        const categoryMatch = block.match(/cl-contentsList_categoryLabel[^>]*>([^<]+)</);
        const category = categoryMatch ? categoryMatch[1].trim() : '';
        const TASK_CATS = new Set(['自習', '課題', 'レポート', 'Report', 'Quiz', 'クイズ', 'Question']);
        if (!TASK_CATS.has(category)) continue;
        items.push({ title, category, startDate: new Date(toISO(dates[0])), endDate: new Date(toISO(dates[1])) });
    }
    return items;
}

// ログイン
console.log('ログイン中...');
const jar = await login('25M009', 'aefa2op3ijr2nfoaih843');
console.log('ログイン完了\n');

// GASから設定取得
console.log('設定取得中...');
const settingsRes = await fetch(`${GAS_URL}?action=get_settings&key=${encodeURIComponent(GAS_KEY)}&user=${encodeURIComponent(DISPLAY_NAME)}`);
const { overrides, rules, hidden } = await settingsRes.json();
const hiddenSet = new Set(hidden);
console.log('overrides:', overrides);
console.log('rules:', rules);
console.log('hidden:', hidden, '\n');

const now = Date.now();
const threshold = NOTIFY_DAYS * 86400000;
const fmt = d => `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

for (const course of COURSES) {
    process.stdout.write(`コース取得中: ${course.name} ... `);
    let html;
    try {
        html = await fetchPage(`${WEBCLASS}/course.php/${course.id}/login`, jar);
    } catch (e) {
        console.log(`スキップ(${e.message})`);
        continue;
    }
    const items = parseCourseHtml(html);
    console.log(`${items.length}件`);

    for (const item of items) {
        const itemKey = `${course.id}:${item.title}`;
        const isHidden = hiddenSet.has(itemKey);

        let deadline, source;
        if (overrides[itemKey]) {
            deadline = new Date(overrides[itemKey]);
            source = '手動上書き';
        } else if (rules[course.id] != null) {
            deadline = new Date(item.startDate.getTime() + Number(rules[course.id]) * 86400000);
            source = `ルール(+${rules[course.id]}日)`;
        } else {
            deadline = item.endDate;
            source = 'システム';
        }

        const ms = deadline.getTime() - now;
        const daysLeft = Math.ceil(ms / 86400000);
        const withinThreshold = ms > 0 && ms <= threshold;
        const flag = isHidden ? '🙈' : withinThreshold ? '🔔' : ms <= 0 ? '期限切れ' : '─';
        if (withinThreshold || isHidden) {
            console.log(`  [${flag}] [${item.category || '不明'}] ${course.name} / ${item.title}`);
            console.log(`       締め切り: ${fmt(deadline)} (${source})  残り${daysLeft}日`);
        }
    }
}
