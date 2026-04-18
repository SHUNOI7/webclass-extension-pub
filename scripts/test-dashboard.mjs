// ダッシュボード取得テスト
// 使い方: node test-dashboard.mjs <id> <password>

const WEBCLASS = 'https://gymnast15.med.kagawa-u.ac.jp/webclass';

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
    return cookieStr(jar);
}

const [id, password] = process.argv.slice(2);
if (!id || !password) { console.error('使い方: node test-dashboard.mjs <id> <password>'); process.exit(1); }

const cookie = await login(id, password);
console.log('Cookie:', cookie, '\n');

const res = await fetch(`${WEBCLASS}/ip_mods.php/plugin/score_summary_table/dashboard`, {
    headers: { Cookie: cookie, Accept: 'application/json' },
});
console.log('Dashboard status:', res.status);
const text = await res.text();
console.log('Response (先頭200文字):', text.slice(0, 200));
