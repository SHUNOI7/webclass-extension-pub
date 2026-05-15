/**
 * WebClass 講義資料一括ダウンロードスクリプト
 *
 * 使い方:
 *   node sync-materials.mjs
 *
 * 環境変数:
 *   WEBCLASS_ID       WebClass ログインID
 *   WEBCLASS_PASSWORD WebClass パスワード
 *   CLASSES_DIR       保存先ルート（デフォルト: ~/study/classes）
 */

import { createWriteStream, existsSync } from 'fs';
import { pipeline } from 'stream/promises';
import { homedir } from 'os';
import path from 'path';

const WEBCLASS = 'https://gymnast15.med.kagawa-u.ac.jp/webclass';

const WEBCLASS_ID       = process.env.WEBCLASS_ID;
const WEBCLASS_PASSWORD = process.env.WEBCLASS_PASSWORD;
const CLASSES_DIR       = process.env.CLASSES_DIR ?? path.join(homedir(), 'study', 'classes');

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
        const [nv] = c.split(';');
        const eq = nv.indexOf('=');
        if (eq > 0) jar.set(nv.slice(0, eq).trim(), nv.slice(eq + 1).trim());
    });
    return jar;
}
const cookieStr = jar => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

// ── WebClass ログイン ─────────────────────────────────────────────────
async function login(id, password) {
    const jar = new Map();
    const r1 = await fetch(`${WEBCLASS}/login.php`);
    parseCookies(r1, jar);
    const html  = await r1.text();
    const token = html.match(/name=["']token["']\s+value=["']([^"']+)["']/)?.[1] ?? '';
    const postUrl = html.match(/action=["']([^"']*login\.php[^"']*)["']/)?.[1]
        ? new URL(html.match(/action=["']([^"']*login\.php[^"']*)["']/)[1], WEBCLASS).href
        : `${WEBCLASS}/login.php`;
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

// ── JS リダイレクト追跡付きページ取得 ───────────────────────────────
async function fetchPage(url, jar, depth = 0) {
    if (depth > 8) throw new Error('too many redirects');
    const r = await fetch(url, { headers: { Cookie: cookieStr(jar) }, redirect: 'follow' });
    parseCookies(r, jar);
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return { html: null, finalUrl: r.url };
    const html = await r.text();
    const m = html.match(/window(?:\.top)?\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
    if (m) {
        const next = m[1].replace(/&amp;/g, '&');
        if (!next.includes('logout'))
            return fetchPage(new URL(next, r.url).href, jar, depth + 1);
    }
    return { html, finalUrl: r.url };
}

// ── コースHTMLから「資料」カテゴリの contentsId を抽出 ───────────────
function parseMaterialLinks(html) {
    const results = [];
    const blocks = html.split(/(?=<div[^>]+class=['"][^'"]*cl-contentsList_content['"\s])/);
    for (const block of blocks) {
        if (!block.includes('cl-contentsList_content')) continue;
        const catMatch = block.match(/cl-contentsList_categoryLabel[^>]*>([^<]+)</);
        if (!catMatch || catMatch[1].trim() !== '資料') continue;
        const nameMatch = block.match(/data-contents-name="([^"]+)"/);
        if (!nameMatch) continue;
        const idMatch = block.match(/set_contents_id=([a-f0-9]+)/);
        if (!idMatch) continue;
        results.push({ name: nameMatch[1], contentsId: idMatch[1] });
    }
    return results;
}

// ── txtbk_show_chapter.php から全ページのPDFパスを取得 ───────────────
async function getTextbookFiles(contentsId, courseId, jar) {
    const r = await fetch(
        `${WEBCLASS}/txtbk_show_chapter.php?set_contents_id=${contentsId}&language=JAPANESE`,
        { headers: { Cookie: cookieStr(jar) }, redirect: 'follow' }
    );
    parseCookies(r, jar);
    const html = await r.text();
    const m = html.match(/<script[^>]*id="json-data"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    let cfg;
    try { cfg = JSON.parse(m[1]); } catch { return []; }
    if (!cfg.text_urls) return [];

    const ch2 = courseId.slice(0, 2);
    const files = [];
    for (const [, pageUrl] of Object.entries(cfg.text_urls)) {
        const fileParam = new URL(`https://x${pageUrl}`).searchParams.get('file');
        if (!fileParam) continue;
        const filePath = decodeURIComponent(fileParam);
        if (!filePath.match(/\.(pdf|pptx?|docx?)$/i)) continue;
        const url = `${WEBCLASS}/data/course/${ch2}/${courseId}/${filePath}`;
        files.push(url);
    }
    return files;
}

// ── ファイルダウンロード ─────────────────────────────────────────────
async function downloadFile(url, destPath, jar) {
    const r = await fetch(url, { headers: { Cookie: cookieStr(jar) }, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) throw new Error('got HTML (not a file)');
    await pipeline(r.body, createWriteStream(destPath));
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
        if (!course.folder) continue;

        const destDir = path.join(CLASSES_DIR, course.folder);
        if (!existsSync(destDir)) {
            console.log(`[${course.name}] 保存先なし → スキップ`);
            continue;
        }

        console.log(`\n[${course.name}]`);
        let courseHtml;
        try {
            ({ html: courseHtml } = await fetchPage(`${WEBCLASS}/course.php/${course.id}/login`, jar));
        } catch (e) {
            console.warn(`  コース取得失敗: ${e.message}`);
            continue;
        }

        const materials = parseMaterialLinks(courseHtml);
        console.log(`  資料: ${materials.length}件`);

        for (const mat of materials) {
            // do_contents を叩いてセッション状態を確立（リダイレクトは無視）
            await fetch(`${WEBCLASS}/do_contents.php?reset_status=1&set_contents_id=${mat.contentsId}`, {
                headers: { Cookie: cookieStr(jar) }, redirect: 'follow',
            }).then(r => { parseCookies(r, jar); return r.text(); }).catch(() => {});

            let files;
            try {
                files = await getTextbookFiles(mat.contentsId, course.id, jar);
            } catch (e) {
                console.warn(`  [${mat.name}] file取得失敗: ${e.message}`);
                continue;
            }

            if (!files.length) {
                console.warn(`  [${mat.name}] PDFなし（動画・HTML型か）`);
                continue;
            }

            for (const fileUrl of files) {
                const filename   = decodeURIComponent(fileUrl.split('/').pop());
                const ext        = filename.split('.').pop();
                const safeName   = mat.name.replace(/[/\\:*?"<>|]/g, '_');
                const pagesSuffix = files.length > 1 ? `_p${files.indexOf(fileUrl) + 1}` : '';
                const destPath   = path.join(destDir, `${safeName}${pagesSuffix}.${ext}`);

                if (existsSync(destPath)) {
                    console.log(`  [${mat.name}] スキップ（既存）`);
                    continue;
                }
                try {
                    await downloadFile(fileUrl, destPath, jar);
                    console.log(`  [${mat.name}] 保存 → ${path.basename(destPath)}`);
                } catch (e) {
                    console.warn(`  [${mat.name}] ダウンロード失敗: ${e.message}`);
                }
            }
        }
    }

    console.log('\n完了');
}

main().catch(e => { console.error(e); process.exit(1); });
