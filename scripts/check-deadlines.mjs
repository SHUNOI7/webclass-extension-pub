import { createTransport } from 'nodemailer';

const WEBCLASS   = 'https://gymnast15.med.kagawa-u.ac.jp/webclass';
const API        = `${WEBCLASS}/ip_mods.php/plugin/score_summary_table`;
const GAS_URL    = process.env.GAS_URL;
const GAS_KEY    = process.env.GAS_ADMIN_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

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

// 拡張機能と同じカテゴリフィルタ（APIの contents_kind 値）
const TASK_KINDS = new Set(['Report', 'Quiz', 'Question']);

// ── cookie ユーティリティ ────────────────────────────────────────────
function parseCookies(res, jar = new Map()) {
    (res.headers.getSetCookie?.() ?? []).forEach(c => {
        const [nameVal] = c.split(';');
        const eq = nameVal.indexOf('=');
        if (eq > 0) jar.set(nameVal.slice(0, eq).trim(), nameVal.slice(eq + 1).trim());
    });
    return jar;
}
const cookieStr = jar => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

// ── WebClass ログイン ────────────────────────────────────────────────
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

// ── JSリダイレクトを追跡しながらページ取得（コースセッション確立用）──
async function fetchPage(url, jar, depth = 0) {
    if (depth > 5) throw new Error('too many JS redirects');
    const r = await fetch(url, { headers: { Cookie: cookieStr(jar) }, redirect: 'follow' });
    parseCookies(r, jar);
    const html = await r.text();
    const jsRedirect = html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
    if (jsRedirect) return fetchPage(new URL(jsRedirect[1], WEBCLASS).href, jar, depth + 1);
    return html;
}

// ── APIの日付文字列をJSTとして解析 ──────────────────────────────────
const parseJST = s => {
    if (!s) return null;
    if (/[Z+\-]\d{2}:?\d{2}$/.test(s) || s.endsWith('Z')) return new Date(s);
    return new Date(s + '+09:00');
};

// ── コースAPIから課題一覧を取得 ─────────────────────────────────────
async function fetchCourseItems(courseId, jar) {
    const res = await fetch(`${API}/contents?group_id=${courseId}`, {
        headers: { Cookie: cookieStr(jar) },
    });
    if (!res.ok) return [];
    try { return await res.json(); } catch { return []; }
}

// ── ユーザー一覧取得（GAS） ──────────────────────────────────────────
async function getUsers() {
    const res = await fetch(`${GAS_URL}?action=get_users&key=${encodeURIComponent(GAS_KEY)}`);
    if (!res.ok) throw new Error(`get_users ${res.status}`);
    return await res.json();
}

// ── ユーザー設定取得（GAS） ──────────────────────────────────────────
async function getUserSettings(displayName) {
    if (!displayName) return { overrides: {}, rules: {}, hidden: [] };
    const res = await fetch(`${GAS_URL}?action=get_settings&key=${encodeURIComponent(GAS_KEY)}&user=${encodeURIComponent(displayName)}`);
    if (!res.ok) return { overrides: {}, rules: {}, hidden: [] };
    return await res.json();
}

// ── メール送信 ───────────────────────────────────────────────────────
const transporter = createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

async function sendMail(to, subject, html) {
    await transporter.sendMail({ from: `WebClass通知 <${GMAIL_USER}>`, to, subject, html });
}

// ── メール本文生成 ───────────────────────────────────────────────────
function buildEmail(upcoming) {
    const fmt = d => `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const rows = upcoming.map(({ course, title, deadline }) => {
        const ms = deadline - Date.now();
        const h  = Math.round(ms / 3600000);
        const label = h < 24 ? `<b style="color:#c00">あと${h}時間</b>` : `あと${Math.ceil(h/24)}日`;
        return `<tr><td>${course}</td><td>${title}</td><td>${fmt(deadline)}</td><td>${label}</td></tr>`;
    }).join('');
    return `
        <p>締め切りが近い課題があります。</p>
        <table border="1" cellpadding="8" cellspacing="0"
               style="border-collapse:collapse;font-size:14px;font-family:sans-serif">
            <tr style="background:#eee"><th>授業</th><th>課題</th><th>締め切り</th><th>残り</th></tr>
            ${rows}
        </table>
        <p style="font-size:12px;color:#999;margin-top:16px">
            このメールは自動送信です。WebClass拡張機能から配信。
        </p>`;
}

// ── ユーザー1人分の処理 ──────────────────────────────────────────────
async function processUser({ email, webclass_id, webclass_password, notify_days = 3, display_name = '' }) {
    console.log(`[${email}] start`);
    try {
        const jar      = await login(webclass_id, webclass_password);
        const settings = await getUserSettings(display_name);
        const { overrides, rules, hidden, restored } = settings;
        const hiddenSet   = new Set(Array.isArray(hidden)   ? hidden   : []);
        const restoredSet = new Set(Array.isArray(restored) ? restored : []);

        const threshold = Number(notify_days) * 86400000;
        const now       = Date.now();
        const upcoming  = [];

        for (const course of COURSES) {
            // コースセッションを確立してからAPIを呼ぶ
            try {
                await fetchPage(`${WEBCLASS}/course.php/${course.id}/login`, jar);
            } catch (e) {
                console.warn(`[${email}] skip ${course.name}: ${e.message}`);
                continue;
            }

            const apiItems = await fetchCourseItems(course.id, jar);
            for (const item of apiItems) {
                if (!TASK_KINDS.has(item.contents_kind)) continue;
                if (!item.start_date || !item.end_date) continue;

                const itemKey  = `${course.id}:${item.contents_name}`;
                if (hiddenSet.has(itemKey)) continue;

                const submitted  = Array.isArray(item.scores) && item.scores.some(s => s.answer_datetime !== null);
                const isRestored = restoredSet.has(itemKey);
                if (submitted && !isRestored) continue;

                let deadline;
                if (overrides[itemKey]) {
                    deadline = new Date(overrides[itemKey]);
                } else if (rules[course.id] != null) {
                    deadline = new Date(parseJST(item.start_date).getTime() + Number(rules[course.id]) * 86400000);
                } else {
                    deadline = parseJST(item.end_date);
                }

                const ms = deadline.getTime() - now;
                if (ms <= 0 || ms > threshold) continue;
                upcoming.push({ course: course.name, title: item.contents_name, deadline });
            }
        }

        if (!upcoming.length) { console.log(`[${email}] no upcoming deadlines`); return; }
        upcoming.sort((a, b) => a.deadline - b.deadline);

        const subject = `【WebClass】締め切り${notify_days}日以内の課題 ${upcoming.length}件`;
        await sendMail(email, subject, buildEmail(upcoming));
        console.log(`[${email}] sent ${upcoming.length} items`);
    } catch (err) {
        console.error(`[${email}] error:`, err.message);
    }
}

// ── エントリーポイント ───────────────────────────────────────────────
const users = await getUsers();
console.log(`Found ${users.length} users`);
for (const user of users) {
    await processUser(user);
}
