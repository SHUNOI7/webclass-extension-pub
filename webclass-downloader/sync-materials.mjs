/**
 * WebClass 講義資料一括ダウンロードスクリプト
 *
 * 使い方:
 *   node sync-materials.mjs
 *
 * 環境変数（.env または export）:
 *   WEBCLASS_ID       WebClass ログインID
 *   WEBCLASS_PASSWORD WebClass パスワード
 *   CLASSES_DIR       保存先ルート（デフォルト: ~/study/classes）
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { homedir } from 'os';
import path from 'path';

const WEBCLASS = 'https://gymnast15.med.kagawa-u.ac.jp/webclass';
const API      = `${WEBCLASS}/ip_mods.php/plugin/score_summary_table`;

const WEBCLASS_ID       = process.env.WEBCLASS_ID;
const WEBCLASS_PASSWORD = process.env.WEBCLASS_PASSWORD;
const CLASSES_DIR       = process.env.CLASSES_DIR
    ?? path.join(homedir(), 'study', 'classes');

// コースID → ローカルフォルダ名
const COURSES = [
    { id: '8d5215783015764ce951cc9024a8efa9', name: '分子生物学',      folder: 'molecular-biology'    },
    { id: 'fdc0989de1e818adafa59ccf8f40c39a', name: '分子遺伝学',      folder: 'molecular-genetics'   },
    { id: '3c58a2eebd8d277e8a23660cba8607f2', name: '医学と研究',      folder: null                   },
    { id: '38a9d09f451ee1cb82f6c6770d88ca9d', name: '医学・医療と社会', folder: null                   },
    { id: '14f26982e6d4628008ca1272a3a3cfcd', name: '医用化学Ⅱ',      folder: 'medical-chemistry-2'  },
    { id: '1af3888f3b4f25f3c99c6d09ca8bdbf7', name: '医療倫理学',      folder: null                   },
    { id: '9b3e1287ccdd818baae60be6ec73c9c1', name: '患者との出会い',   folder: null                   },
    { id: '19e2e404088da5a87f17b10be54392ce', name: '早期医学実習Ⅱ',  folder: null                   },
    { id: '49f9ee1ac60effa5895a47682fb6198e', name: '生化学',          folder: 'biochemistry'         },
    { id: '235d2308e5452e1b8e1cbcd801b9d6e2', name: '生理学Ⅱ',       folder: null                   },
    { id: '6d5e784a3c6676d64fae08ec8417ae70', name: '生理学Ⅰ',       folder: 'physiology-1'         },
    { id: '06b305e2e2aefec207ec25f0bf93018e', name: '細胞生物学',      folder: 'cell-biology'         },
    { id: '28e51271a617bb1de7d40b2472c43118', name: '行動科学',        folder: 'behavioral-science'   },
    { id: '6b114e2b135f7aac169bc428f00951aa', name: '解剖学Ⅱ',       folder: 'anatomy-2'            },
    { id: 'aea2184cf7cd67f5ea205f70e8a9a8ab', name: '解剖学Ⅰ',       folder: 'anatomy-1'            },
];

// ── cookie ユーティリティ ─────────────────────────────────────────────
function parseCookies(res, jar = new Map()) {
    (res.headers.getSetCookie?.() ?? []).forEach(c => {
        const [nameVal] = c.split(';');
        const eq = nameVal.indexOf('=');
        if (eq > 0) jar.set(nameVal.slice(0, eq).trim(), nameVal.slice(eq + 1).trim());
    });
    return jar;
}
const cookieStr = jar => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

// ── WebClass ログイン ─────────────────────────────────────────────────
async function login(id, password) {
    const jar = new Map();
    const loginUrl = `${WEBCLASS}/login.php`;
    const r1 = await fetch(loginUrl);
    parseCookies(r1, jar);
    const html = await r1.text();
    const token     = html.match(/name=["']token["']\s+value=["']([^"']+)["']/)?.[1] ?? '';
    const postUrl   = html.match(/action=["']([^"']*login\.php[^"']*)["']/)?.[1]
        ? new URL(html.match(/action=["']([^"']*login\.php[^"']*)["']/)[1], WEBCLASS).href
        : loginUrl;
    const r2 = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieStr(jar) },
        body: new URLSearchParams({ username: id, val: password, login: 'ログイン', useragent: '', language: 'JAPANESE', token }),
        redirect: 'manual',
    });
    parseCookies(r2, jar);
    let loc = r2.headers.get('location');
    while (loc) {
        const r = await fetch(new URL(loc, WEBCLASS).href, { headers: { Cookie: cookieStr(jar) }, redirect: 'manual' });
        parseCookies(r, jar);
        loc = r.headers.get('location');
    }
    return jar;
}

// ── JSリダイレクトを追跡しながらページ取得 ───────────────────────────
async function fetchPage(url, jar, depth = 0) {
    if (depth > 5) throw new Error('too many redirects');
    const r = await fetch(url, { headers: { Cookie: cookieStr(jar) }, redirect: 'follow' });
    parseCookies(r, jar);
    const html = await r.text();
    const m = html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
    if (m) return fetchPage(new URL(m[1], WEBCLASS).href, jar, depth + 1);
    return { html, finalUrl: r.url };
}

// ── コースAPIから資料一覧を取得 ──────────────────────────────────────
async function fetchApiItems(courseId, jar) {
    try {
        const r = await fetch(`${API}/contents?group_id=${courseId}`, {
            headers: { Cookie: cookieStr(jar) },
        });
        if (!r.ok) return [];
        return await r.json();
    } catch { return []; }
}

// ── コースHTMLから do_contents リンクを抽出 ──────────────────────────
function parseContentLinks(html) {
    const results = [];
    const re = /data-contents-name="([^"]+)"[^]*?href="([^"]*do_contents\.php\?[^"]*set_contents_id=([^"&]+)[^"]*)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        results.push({ name: m[1], href: m[2], contentsId: m[3] });
    }
    return results;
}

// ── ファイルをダウンロードして保存 ───────────────────────────────────
async function downloadFile(url, destPath, jar) {
    const r = await fetch(url, { headers: { Cookie: cookieStr(jar) }, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const contentType = r.headers.get('content-type') ?? '';
    // HTML が返ってきた場合はファイルではない（ログインページへリダイレクトなど）
    if (contentType.includes('text/html')) throw new Error('got HTML, not a file');
    await pipeline(r.body, createWriteStream(destPath));
    return r.headers.get('content-disposition') ?? '';
}

// ── Content-Disposition からファイル名を取得 ─────────────────────────
function extractFilename(disposition, fallback) {
    const m = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i);
    if (m) return decodeURIComponent(m[1].trim());
    return fallback;
}

// ── メイン処理 ───────────────────────────────────────────────────────
async function main() {
    if (!WEBCLASS_ID || !WEBCLASS_PASSWORD) {
        console.error('WEBCLASS_ID と WEBCLASS_PASSWORD を設定してください');
        process.exit(1);
    }

    console.log('ログイン中...');
    const jar = await login(WEBCLASS_ID, WEBCLASS_PASSWORD);
    console.log('ログイン完了');

    for (const course of COURSES) {
        if (!course.folder) {
            console.log(`[${course.name}] フォルダ未設定 → スキップ`);
            continue;
        }

        const destDir = path.join(CLASSES_DIR, course.folder);
        if (!existsSync(destDir)) {
            console.log(`[${course.name}] 保存先フォルダがありません: ${destDir} → スキップ`);
            continue;
        }

        console.log(`\n[${course.name}] 処理中...`);

        // コースページを取得してセッションを確立
        let html;
        try {
            ({ html } = await fetchPage(`${WEBCLASS}/course.php/${course.id}/login`, jar));
        } catch (e) {
            console.warn(`  コースページ取得失敗: ${e.message}`);
            continue;
        }

        // APIで Material 種別のアイテム名を取得
        const apiItems = await fetchApiItems(course.id, jar);
        const materialNames = new Set(
            apiItems
                .filter(i => i.contents_kind === 'Material')
                .map(i => i.contents_name)
        );
        console.log(`  API Material件数: ${materialNames.size}`);

        // HTMLからダウンロードリンクを抽出
        const links = parseContentLinks(html);
        console.log(`  HTMLリンク件数: ${links.length}`);

        for (const link of links) {
            if (!materialNames.has(link.name)) continue;

            // do_contents.php を叩いて実際のファイルURLを取得
            const contentsUrl = new URL(link.href, WEBCLASS).href;
            let finalUrl, finalHtml;
            try {
                ({ html: finalHtml, finalUrl } = await fetchPage(contentsUrl, jar));
            } catch (e) {
                console.warn(`  [${link.name}] リダイレクト失敗: ${e.message}`);
                continue;
            }

            // TODO: finalUrl が PDF ならダウンロード、HTML ならページ内リンクを探す
            console.log(`  [${link.name}] → ${finalUrl}`);

            // data/course パスが最終URLに含まれていればダウンロード
            if (finalUrl.includes('/data/course/') || finalUrl.match(/\.(pdf|docx?|xlsx?|pptx?)(\?|$)/i)) {
                const ext       = finalUrl.split('?')[0].split('.').pop();
                const safeName  = link.name.replace(/[/\\:*?"<>|]/g, '_');
                const destPath  = path.join(destDir, `${safeName}.${ext}`);
                if (existsSync(destPath)) {
                    console.log(`  [${link.name}] 既存ファイルあり → スキップ`);
                    continue;
                }
                try {
                    await downloadFile(finalUrl, destPath, jar);
                    console.log(`  [${link.name}] 保存: ${destPath}`);
                } catch (e) {
                    console.warn(`  [${link.name}] ダウンロード失敗: ${e.message}`);
                }
            } else {
                // HTML ページが返ってきた場合（iframe / viewer 経由など）
                // 埋め込みPDFリンクやiframeのsrcを探す
                const embedMatch = finalHtml.match(/(?:src|href)="([^"]*\/data\/course\/[^"]+\.pdf[^"]*)"/);
                if (embedMatch) {
                    const pdfUrl   = new URL(embedMatch[1], WEBCLASS).href;
                    const safeName = link.name.replace(/[/\\:*?"<>|]/g, '_');
                    const destPath = path.join(destDir, `${safeName}.pdf`);
                    if (existsSync(destPath)) {
                        console.log(`  [${link.name}] 既存ファイルあり → スキップ`);
                        continue;
                    }
                    try {
                        await downloadFile(pdfUrl, destPath, jar);
                        console.log(`  [${link.name}] 保存(embed): ${destPath}`);
                    } catch (e) {
                        console.warn(`  [${link.name}] ダウンロード失敗: ${e.message}`);
                    }
                } else {
                    console.warn(`  [${link.name}] ファイルURL不明 → 要調査`);
                }
            }
        }
    }

    console.log('\n完了');
}

main().catch(e => { console.error(e); process.exit(1); });
