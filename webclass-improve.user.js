// ==UserScript==
// @name         WebClass 改善
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  時間割グリッド表示・未提出課題一覧・PDFパスワード自動入力・ダウンロードファイル名自動設定
// @match        https://gymnast15.med.kagawa-u.ac.jp/webclass/*
// @connect      gist.githubusercontent.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ── 講義資料ダウンロード時のファイル名設定（localStorage版）────────
    const saveChapterTitle = title => {
        if (title && title.trim()) localStorage.setItem('wc-current-chapter', title.trim());
    };

    // PC版：章リストフレーム（クリックで章切り替え）
    if (location.pathname.includes('txtbk_show_chapter.php')) {
        const attachListeners = () => {
            document.querySelectorAll('h2').forEach(h2 => {
                h2.addEventListener('click', () => saveChapterTitle(h2.textContent));
            });
            const first = document.querySelector('h2');
            if (first) saveChapterTitle(first.textContent);
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attachListeners);
        } else {
            attachListeners();
        }
    }

    // 全ページ共通：h2.wcl_pageMainTitle が出たら保存（URL問わず）
    // → mbl.php/textbooks はもちろん、小さいウィンドウ時の別レイアウトにも対応
    {
        const syncTitle = () => {
            const h2 = document.querySelector('h2.wcl_pageMainTitle');
            if (h2 && h2.textContent.trim()) saveChapterTitle(h2.textContent);
        };
        syncTitle();
        new MutationObserver(syncTitle).observe(document.body, { childList: true, subtree: true });
    }

    // ── ダウンロードユーティリティ ────────────────────────────────────
    const wcDownload = async fileUrl => {
        const raw  = localStorage.getItem('wc-current-chapter')
                  || document.querySelector('h2.wcl_pageMainTitle, h2')?.textContent?.trim()
                  || 'document';
        const safe = raw.replace(/[/\\:*?"<>|]/g, '-').trim();
        const ext  = fileUrl.split('?')[0].split('.').pop().toLowerCase() || 'pdf';
        const resp = await fetch(fileUrl, { credentials: 'include' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = safe + '.' + ext;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    // ── モバイルレイアウト：loadit.php iframe からダウンロードボタンを注入 ──
    // iOS Userscripts は iframe 内でスクリプトが動かないため、
    // 親ページで iframe の src から PDF URL を取得してボタンを追加する
    const injectLoaditButton = () => {
        document.querySelectorAll('iframe[src*="loadit.php"]').forEach(iframe => {
            if (iframe.dataset.wcDlInjected) return;
            iframe.dataset.wcDlInjected = '1';

            let fileUrl;
            try {
                const params = new URL(iframe.src, location.href).searchParams;
                fileUrl = params.get('file'); // URL エンコードされたパス
                if (fileUrl) fileUrl = decodeURIComponent(fileUrl); // 例: /webclass/data/course/14/.../file.pdf
            } catch (_) { return; }
            if (!fileUrl) return;

            const btn = document.createElement('button');
            btn.textContent = '⬇ ダウンロード';
            btn.style.cssText = 'display:block;margin:6px 0;padding:6px 16px;background:#333;color:#fff;border:none;border-radius:4px;font-size:13px;cursor:pointer;';
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = '取得中…';
                try {
                    await wcDownload(fileUrl);
                } catch (err) {
                    alert('ダウンロード失敗: ' + err.message);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '⬇ ダウンロード';
                }
            });
            iframe.insertAdjacentElement('beforebegin', btn);
        });
    };

    injectLoaditButton();
    new MutationObserver(injectLoaditButton).observe(document.body, { childList: true, subtree: true });

    // ── PC レイアウト：PDF.js の #download ボタンを拾う（同一フレーム内） ──
    // @grant none のため PDFViewerApplication に直接アクセス可能
    document.addEventListener('click', async e => {
        const pdfBtn    = e.target.closest('#download');
        const directLink = e.target.closest('a[href]');

        let fileUrl = null;
        if (pdfBtn) {
            try { fileUrl = window.PDFViewerApplication?.url || window.PDFViewerApplication?.baseUrl; } catch (_) {}
        } else if (directLink) {
            const href = directLink.href || '';
            if (/\.(pdf|pptx?|docx?|xlsx?)(\?|$)/i.test(href) && href.includes('gymnast15.med.kagawa-u.ac.jp')) {
                fileUrl = href;
            }
        }
        if (!fileUrl) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        try {
            await wcDownload(fileUrl);
        } catch (_) {
            if (directLink) directLink.click();
        }
    }, true);

    // コースページから courseId を保存
    const coursePageMatch = location.pathname.match(/\/course\.php\/([a-f0-9]+)\//);
    if (coursePageMatch) {
        localStorage.setItem('wc-current-course', coursePageMatch[1]);
    }

    // ── PDFパスワード処理 ────────────────────────────────────────────
    ;(function () {
        const PDF_PASS_KEY = 'wc-pdf-passwords';
        const PDF_OVER_KEY = 'wc-pdf-overrides';
        const loadPdfPasswords = () => { try { return JSON.parse(localStorage.getItem(PDF_PASS_KEY) || '{}'); } catch { return {}; } };
        const loadPdfOverrides = () => { try { return JSON.parse(localStorage.getItem(PDF_OVER_KEY) || '{}'); } catch { return {}; } };

        const contentsId = (location.search.match(/[?&](?:set_)?contents_id=([a-f0-9]+)/) || [])[1] || null;
        const courseId   = localStorage.getItem('wc-current-course');

        let isPasswordProtected = false;
        let listenersAttached   = false;
        let autoFilled          = false;
        let lastEnteredPassword = null;

        const showSavePrompt = password => {
            if (!contentsId) return;
            const banner = document.createElement('div');
            banner.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#333;color:#fff;padding:10px 14px;border-radius:6px;font-size:12px;z-index:99999;display:flex;gap:8px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.3);';
            const msg = document.createElement('span');
            msg.textContent = 'このPDFのパスワードを保存しますか？';
            const saveBtn = document.createElement('button');
            saveBtn.textContent = '保存';
            saveBtn.style.cssText = 'padding:2px 8px;border:1px solid #fff;background:none;color:#fff;border-radius:3px;cursor:pointer;font-size:11px;';
            const skipBtn = document.createElement('button');
            skipBtn.textContent = 'いいえ';
            skipBtn.style.cssText = 'padding:2px 8px;border:none;background:none;color:#aaa;cursor:pointer;font-size:11px;';
            saveBtn.addEventListener('click', () => {
                const ov = loadPdfOverrides();
                ov[contentsId] = password;
                localStorage.setItem(PDF_OVER_KEY, JSON.stringify(ov));
                banner.remove();
            });
            skipBtn.addEventListener('click', () => banner.remove());
            banner.appendChild(msg);
            banner.appendChild(saveBtn);
            banner.appendChild(skipBtn);
            document.body.appendChild(banner);
            setTimeout(() => banner.remove(), 12000);
        };

        const isVisible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

        const checkPasswordDialog = () => {
            const input     = document.getElementById('password');
            const submitBtn = document.getElementById('passwordSubmit');
            const cancelBtn = document.getElementById('passwordCancel');
            if (!input || !submitBtn || !isVisible(input)) return;

            isPasswordProtected = true;

            if (!listenersAttached) {
                listenersAttached = true;
                let cancelled = false;
                cancelBtn?.addEventListener('click', () => { cancelled = true; });
                submitBtn.addEventListener('click', () => { lastEnteredPassword = input.value; cancelled = false; });

                new MutationObserver(() => {
                    if (!isVisible(input) && !cancelled && lastEnteredPassword) {
                        const autoPass = (contentsId && loadPdfOverrides()[contentsId]) || (courseId && loadPdfPasswords()[courseId]);
                        if (lastEnteredPassword !== autoPass) showSavePrompt(lastEnteredPassword);
                        cancelled = false;
                        lastEnteredPassword = null;
                    }
                }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
            }

            if (!autoFilled) {
                autoFilled = true;
                const autoPassword = (contentsId && loadPdfOverrides()[contentsId]) || (courseId && loadPdfPasswords()[courseId]);
                if (autoPassword) { input.value = autoPassword; submitBtn.click(); }
            }
        };

        new MutationObserver(checkPasswordDialog).observe(document.body, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'],
        });
        checkPasswordDialog();
    })();

    // ── 未提出課題一覧をサイドバーに表示 ────────────────────────────
    (async () => {
        const API = '/webclass/ip_mods.php/plugin/score_summary_table';
        const dashboardUrl = `${API}/dashboard`;
        const OVERRIDE_KEY = 'wc-deadline-overrides';
        const RULES_KEY    = 'wc-deadline-rules';

        const fmt = d => {
            const m = d.getMonth() + 1;
            const day = d.getDate();
            const h = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return `${m}/${day} ${h}:${min}`;
        };

        const toInputVal = d => {
            const p = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
        };

        const ANNOUNCE_URL  = 'https://gist.githubusercontent.com/SHUNOI7/b5b36b026e7e4bfa7a77c02819bfb237/raw/gistfile1.txt';
        const ANNOUNCE_KEY  = 'wc-announcement';

        const loadOverrides     = () => { try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY)       || '{}'); } catch { return {}; } };
        const loadRules         = () => { try { return JSON.parse(localStorage.getItem(RULES_KEY)          || '{}'); } catch { return {}; } };
        const loadAnnounceState = () => { try { return JSON.parse(localStorage.getItem(ANNOUNCE_KEY)       || '{}'); } catch { return {}; } };
        const loadPdfPasswords  = () => { try { return JSON.parse(localStorage.getItem('wc-pdf-passwords') || '{}'); } catch { return {}; } };

        const COURSE_CACHE_PFX  = 'wc-unread-course-';
        const UNREAD_CACHE_TTL  = 30 * 60 * 1000;
        const EXCLUDED_CATS     = new Set(['自習', 'テスト', '小テスト']);

        const COURSES_2Y = [
            { id: '8d5215783015764ce951cc9024a8efa9', name: '分子生物学'       },
            { id: 'fdc0989de1e818adafa59ccf8f40c39a', name: '分子遺伝学'       },
            { id: '3c58a2eebd8d277e8a23660cba8607f2', name: '医学と研究'       },
            { id: '38a9d09f451ee1cb82f6c6770d88ca9d', name: '医学・医療と社会'  },
            { id: '14f26982e6d4628008ca1272a3a3cfcd', name: '医用化学Ⅱ'       },
            { id: '1af3888f3b4f25f3c99c6d09ca8bdbf7', name: '医療倫理学'       },
            { id: '9b3e1287ccdd818baae60be6ec73c9c1', name: '患者との出会い'    },
            { id: '19e2e404088da5a87f17b10be54392ce', name: '早期医学実習Ⅱ'   },
            { id: '49f9ee1ac60effa5895a47682fb6198e', name: '生化学'           },
            { id: '235d2308e5452e1b8e1cbcd801b9d6e2', name: '生理学Ⅱ'        },
            { id: '6d5e784a3c6676d64fae08ec8417ae70', name: '生理学Ⅰ'        },
            { id: '06b305e2e2aefec207ec25f0bf93018e', name: '細胞生物学'       },
            { id: '28e51271a617bb1de7d40b2472c43118', name: '行動科学'         },
            { id: '6b114e2b135f7aac169bc428f00951aa', name: '解剖学Ⅱ'        },
            { id: 'aea2184cf7cd67f5ea205f70e8a9a8ab', name: '解剖学Ⅰ'        },
        ];

        let cachedResults      = null;
        let cachedAnnouncement = null;

        // ── 未読資料：コースページ訪問時にdocumentを直接パースしてキャッシュ ──
        const parseAndCacheCourse = (doc, courseId, courseName) => {
            const now = new Date();
            const items = [];
            const toISO = s => s.replace(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/, '$1-$2-$3T$4:$5');
            doc.querySelectorAll('div.cl-contentsList_content').forEach(el => {
                const category = el.querySelector('.cl-contentsList_categoryLabel')?.textContent?.trim() || '';
                if (EXCLUDED_CATS.has(category)) return;
                if ([...el.querySelectorAll('a')].some(a => /利用回数/.test(a.textContent))) return;
                const periodText = el.querySelector('.cm-contentsList_contentDetailListItemData')?.textContent?.trim() || '';
                const dates = periodText.match(/(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})/g);
                if (!dates || dates.length < 2) return;
                const startDate = new Date(toISO(dates[0]));
                const endDate   = new Date(toISO(dates[1]));
                if (now < startDate || now > endDate) return;
                const titleEl = el.querySelector('h4 a[href*="set_contents_id"]');
                if (!titleEl) return;
                items.push({
                    title:      titleEl.textContent.trim(),
                    href:       titleEl.getAttribute('href'),
                    category,
                    startDate:  startDate.toISOString(),
                    courseName,
                });
            });
            try { localStorage.setItem(COURSE_CACHE_PFX + courseId, JSON.stringify({ ts: Date.now(), items })); } catch (_) {}
        };

        // 現在コースページにいる場合はすぐパース
        const coursePathMatch = location.pathname.match(/\/course\.php\/([a-f0-9]+)\//);
        if (coursePathMatch) {
            const cid = coursePathMatch[1];
            const course = COURSES_2Y.find(c => c.id === cid);
            if (course) parseAndCacheCourse(document, cid, course.name);
        }

        // ダッシュボード表示用：全コースのキャッシュを集計
        const getUnreadMaterials = () => {
            const now = Date.now();
            return COURSES_2Y.flatMap(c => {
                try {
                    const cached = JSON.parse(localStorage.getItem(COURSE_CACHE_PFX + c.id) || 'null');
                    if (!cached || now - cached.ts > UNREAD_CACHE_TTL) return [];
                    return cached.items;
                } catch (_) { return []; }
            }).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
        };

        const renderUnreadMaterials = items => {
            if (!items) return;
            document.querySelectorAll('#View-0 .side-block-content.wc-assignment-sidebar').forEach(el => {
                const section = document.createElement('div');
                section.style.cssText = 'border-top:2px solid #e8e8e8;';

                let collapsed = false;
                const header = document.createElement('div');
                header.style.cssText = 'padding:4px 6px;font-size:11px;font-weight:bold;color:#555;background:#f5f5f5;display:flex;align-items:center;cursor:pointer;user-select:none;';
                const headerLabel = document.createElement('span');
                headerLabel.style.cssText = 'flex:1;';
                headerLabel.textContent = items.length > 0 ? `📌 未読の資料 (${items.length})` : '📌 未読の資料';
                const arrow = document.createElement('span');
                arrow.style.cssText = 'font-size:10px;color:#aaa;';
                arrow.textContent = '▲';
                header.appendChild(headerLabel);
                header.appendChild(arrow);

                const listEl = document.createElement('div');
                listEl.className = 'wc-assignment-list';
                header.addEventListener('click', () => {
                    collapsed = !collapsed;
                    listEl.style.display = collapsed ? 'none' : '';
                    arrow.textContent = collapsed ? '▼' : '▲';
                });

                const ul = document.createElement('ul');
                ul.style.cssText = 'list-style:none;margin:0;padding:0;';
                if (items.length === 0) {
                    const li = document.createElement('li');
                    li.style.cssText = 'padding:6px 8px;font-size:11px;color:#aaa;';
                    li.textContent = 'すべて閲覧済みです';
                    ul.appendChild(li);
                }
                items.forEach(item => {
                    const li = document.createElement('li');
                    li.style.cssText = 'padding:5px 6px;border-bottom:1px solid #f0f0f0;';

                    const courseDiv = document.createElement('div');
                    courseDiv.style.cssText = 'font-size:10px;color:#999;';
                    courseDiv.textContent = item.courseName;

                    const titleDiv = document.createElement('div');
                    titleDiv.style.cssText = 'font-size:12px;font-weight:bold;line-height:1.4;';
                    const link = document.createElement('a');
                    link.href = item.href;
                    link.textContent = item.title;
                    link.style.cssText = 'text-decoration:none;color:#333;';
                    titleDiv.appendChild(link);

                    const metaDiv = document.createElement('div');
                    metaDiv.style.cssText = 'font-size:10px;color:#888;display:flex;gap:4px;flex-wrap:wrap;margin-top:1px;';
                    if (item.category) {
                        const cat = document.createElement('span');
                        cat.textContent = item.category;
                        cat.style.cssText = 'background:#eee;padding:0 3px;border-radius:2px;';
                        metaDiv.appendChild(cat);
                    }
                    const d = new Date(item.startDate);
                    const dateEl = document.createElement('span');
                    dateEl.textContent = `公開 ${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    metaDiv.appendChild(dateEl);

                    li.appendChild(courseDiv);
                    li.appendChild(titleDiv);
                    li.appendChild(metaDiv);
                    ul.appendChild(li);
                });

                listEl.appendChild(ul);
                section.appendChild(header);
                section.appendChild(listEl);
                el.appendChild(section);
            });
        };

        const buildPending = (overrides, rules, now) => {
            const items = [];
            cachedResults.forEach((courseItems, i) => {
                if (!Array.isArray(courseItems)) return;
                courseItems.forEach(item => {
                    if (!item.end_date) return;
                    const systemDeadline = new Date(item.end_date);
                    const startDate = item.start_date ? new Date(item.start_date) : null;
                    const itemKey = `${COURSES_2Y[i].id}:${item.contents_name}`;
                    const overrideStr = overrides[itemKey];
                    const ruleDays = rules[COURSES_2Y[i].id];

                    let deadline, isOverridden = false, isRuled = false;
                    if (overrideStr) {
                        deadline = new Date(overrideStr);
                        isOverridden = true;
                    } else if (ruleDays != null && startDate) {
                        deadline = new Date(startDate.getTime() + ruleDays * 86400000);
                        isRuled = true;
                    } else {
                        deadline = systemDeadline;
                    }

                    if (deadline < now) return;
                    const submitted = item.scores && item.scores.some(s => s.answer_datetime !== null);
                    if (submitted) return;
                    items.push({
                        courseId: COURSES_2Y[i].id,
                        courseName: COURSES_2Y[i].name,
                        name: item.contents_name,
                        deadline,
                        systemDeadline,
                        itemKey,
                        isOverridden,
                        isRuled,
                    });
                });
            });
            return items.sort((a, b) => a.deadline - b.deadline);
        };

        const renderAnnouncement = () => {
            document.querySelectorAll('.wc-announcement').forEach(el => el.remove());
            if (!cachedAnnouncement || !cachedAnnouncement.message) return;

            const msg = cachedAnnouncement.message;
            const state = loadAnnounceState();
            if (state.seenMessage !== msg) {
                state.seenMessage = msg;
                state.minimized = false;
                localStorage.setItem(ANNOUNCE_KEY, JSON.stringify(state));
            }

            document.querySelectorAll('#View-0 .side-block-title').forEach(titleEl => {
                const block = document.createElement('div');
                block.className = 'wc-announcement';

                if (state.minimized) {
                    block.style.cssText = 'background:#f0f0f0;cursor:pointer;border-bottom:1px solid #ddd;margin-bottom:6px;border-radius:4px;';
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;padding:4px 8px;';
                    const lbl = document.createElement('span');
                    lbl.style.cssText = 'flex:1;font-size:11px;color:#666;';
                    lbl.textContent = '📢 お知らせ';
                    const arrow = document.createElement('span');
                    arrow.style.cssText = 'font-size:10px;color:#aaa;';
                    arrow.textContent = '▼';
                    row.appendChild(lbl);
                    row.appendChild(arrow);
                    block.appendChild(row);
                    block.addEventListener('click', () => {
                        state.minimized = false;
                        localStorage.setItem(ANNOUNCE_KEY, JSON.stringify(state));
                        renderAnnouncement();
                    });
                } else {
                    block.style.cssText = 'background:#333;border-radius:4px;margin-bottom:6px;';
                    const inner = document.createElement('div');
                    inner.style.cssText = 'padding:7px 28px 7px 10px;position:relative;font-size:12px;color:#fff;line-height:1.5;white-space:pre-wrap;word-break:break-all;';
                    inner.textContent = msg;
                    const minBtn = document.createElement('button');
                    minBtn.textContent = '▲';
                    minBtn.title = '最小化';
                    minBtn.style.cssText = 'position:absolute;top:5px;right:7px;background:none;border:none;color:#aaa;cursor:pointer;font-size:10px;padding:0;line-height:1;';
                    minBtn.addEventListener('click', () => {
                        state.minimized = true;
                        localStorage.setItem(ANNOUNCE_KEY, JSON.stringify(state));
                        renderAnnouncement();
                    });
                    inner.appendChild(minBtn);
                    block.appendChild(inner);
                }

                titleEl.parentNode.insertBefore(block, titleEl);
            });
        };

        const refresh = () => {
            const now = new Date();
            renderSidebar(buildPending(loadOverrides(), loadRules(), now), now);
        };

        const renderSidebar = (pending, now) => {
            document.querySelectorAll('#View-0 .side-block-content').forEach(el => {
                el.classList.add('wc-assignment-sidebar');
                el.innerHTML = '';

                // ── ヘッダー ──
                const header = document.createElement('div');
                header.style.cssText = 'padding:4px 6px;border-bottom:1px solid #eee;display:flex;align-items:center;';
                header.innerHTML = `<a href="${dashboardUrl}" class="showInIframeButton" style="font-size:12px;color:#555;flex:1;">&raquo; ダッシュボード</a>`;

                const settingsBtn = document.createElement('button');
                settingsBtn.textContent = '⚙';
                settingsBtn.title = '期限ルール設定';
                settingsBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:13px;padding:0 2px;opacity:0.4;line-height:1;';
                header.appendChild(settingsBtn);
                el.appendChild(header);

                // ── 設定パネル ──
                const settingsPanel = document.createElement('div');
                settingsPanel.style.cssText = 'display:none;border-bottom:1px solid #ddd;background:#f8f8f8;';

                const buildSettingsPanel = () => {
                    const rules = loadRules();
                    const passwords = loadPdfPasswords();
                    settingsPanel.innerHTML = '';

                    const hint = document.createElement('div');
                    hint.style.cssText = 'font-size:10px;color:#999;padding:4px 6px 2px;';
                    hint.textContent = '講義ルール: 授業日から何日以内（空欄 = end_date を使用）／ 🔑 PDFパスワード';
                    settingsPanel.appendChild(hint);

                    COURSES_2Y.forEach(c => {
                        const row = document.createElement('div');
                        row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 6px;';

                        const label = document.createElement('span');
                        label.style.cssText = 'flex:1;font-size:11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
                        label.textContent = c.name;

                        const input = document.createElement('input');
                        input.type = 'number';
                        input.min = '0';
                        input.max = '30';
                        input.placeholder = '—';
                        input.value = rules[c.id] != null ? rules[c.id] : '';
                        input.style.cssText = 'width:36px;font-size:11px;border:1px solid #ccc;border-radius:2px;padding:1px 3px;text-align:center;';
                        input.addEventListener('change', () => {
                            const r = loadRules();
                            if (input.value === '') delete r[c.id];
                            else r[c.id] = parseInt(input.value, 10);
                            localStorage.setItem(RULES_KEY, JSON.stringify(r));
                        });

                        const unit = document.createElement('span');
                        unit.style.cssText = 'font-size:11px;color:#666;';
                        unit.textContent = '日';

                        const pwIcon = document.createElement('span');
                        pwIcon.textContent = '🔑';
                        pwIcon.style.cssText = 'font-size:11px;margin-left:2px;';

                        const pwInput = document.createElement('input');
                        pwInput.type = 'password';
                        pwInput.placeholder = 'なし';
                        pwInput.value = passwords[c.id] || '';
                        pwInput.style.cssText = 'width:68px;font-size:11px;border:1px solid #ccc;border-radius:2px;padding:1px 3px;';
                        pwInput.addEventListener('change', () => {
                            const p = loadPdfPasswords();
                            if (pwInput.value === '') delete p[c.id];
                            else p[c.id] = pwInput.value;
                            localStorage.setItem('wc-pdf-passwords', JSON.stringify(p));
                        });

                        row.appendChild(label);
                        row.appendChild(input);
                        row.appendChild(unit);
                        row.appendChild(pwIcon);
                        row.appendChild(pwInput);
                        settingsPanel.appendChild(row);
                    });

                    const applyRow = document.createElement('div');
                    applyRow.style.cssText = 'padding:4px 6px 6px;';
                    const applyBtn = document.createElement('button');
                    applyBtn.textContent = '適用';
                    applyBtn.style.cssText = 'font-size:11px;padding:2px 10px;border:1px solid #333;border-radius:2px;background:#333;color:#fff;cursor:pointer;';
                    applyBtn.addEventListener('click', () => {
                        settingsPanel.style.display = 'none';
                        settingsBtn.style.opacity = '0.4';
                        refresh();
                    });
                    applyRow.appendChild(applyBtn);
                    settingsPanel.appendChild(applyRow);
                };

                settingsBtn.addEventListener('click', () => {
                    const open = settingsPanel.style.display !== 'none';
                    if (!open) buildSettingsPanel();
                    settingsPanel.style.display = open ? 'none' : 'block';
                    settingsBtn.style.opacity = open ? '0.4' : '1';
                });
                el.appendChild(settingsPanel);

                // ── 課題リスト ──
                if (pending.length === 0) {
                    const msg = document.createElement('p');
                    msg.style.cssText = 'padding:0.5em;font-size:12px;color:#888;margin:0;';
                    msg.textContent = '未提出の課題はありません';
                    el.appendChild(msg);
                    return;
                }

                const ul = document.createElement('ul');
                ul.style.cssText = 'list-style:none;margin:0;padding:0;';
                pending.forEach(item => {
                    const { courseId, courseName, name, itemKey } = item;
                    const li = document.createElement('li');
                    li.style.cssText = 'padding:5px 6px;border-bottom:1px solid #f0f0f0;';
                    const courseUrl = `/webclass/course.php/${courseId}/login${acs}`;

                    const courseDiv = document.createElement('div');
                    courseDiv.style.cssText = 'font-size:10px;';

                    const nameDiv = document.createElement('div');
                    nameDiv.style.cssText = 'font-size:12px;font-weight:bold;line-height:1.4;';
                    nameDiv.innerHTML = `<a href="${courseUrl}" target="_top" style="text-decoration:none;">${name}</a>`;

                    const deadlineDiv = document.createElement('div');
                    deadlineDiv.style.cssText = 'font-size:10px;display:flex;align-items:center;gap:3px;flex-wrap:wrap;';

                    const renderDeadlineRow = () => {
                        const diff = item.deadline - now;
                        const urgent = diff < 86400000;
                        const soon   = diff < 7 * 86400000;
                        const col    = urgent ? '#c00' : soon ? '#d97000' : '#888';
                        const nameCol = urgent ? '#c00' : soon ? '#d97000' : '#333';
                        courseDiv.style.color = urgent ? '#c00' : soon ? '#d97000' : '#999';
                        courseDiv.textContent = courseName;
                        nameDiv.querySelector('a').style.color = nameCol;
                        deadlineDiv.style.color = col;
                        deadlineDiv.innerHTML = '';

                        const txt = document.createElement('span');
                        txt.textContent = `〆 ${fmt(item.deadline)}`;
                        deadlineDiv.appendChild(txt);

                        if (item.isOverridden) {
                            const badge = document.createElement('span');
                            badge.textContent = '手動';
                            badge.title = `end_date: ${fmt(item.systemDeadline)}`;
                            badge.style.cssText = 'font-size:9px;background:#555;color:#fff;border-radius:2px;padding:0 3px;cursor:default;';
                            deadlineDiv.appendChild(badge);
                        } else if (item.isRuled) {
                            const badge = document.createElement('span');
                            badge.textContent = 'ルール';
                            badge.title = `end_date: ${fmt(item.systemDeadline)}`;
                            badge.style.cssText = 'font-size:9px;background:#888;color:#fff;border-radius:2px;padding:0 3px;cursor:default;';
                            deadlineDiv.appendChild(badge);
                        }

                        const editBtn = document.createElement('button');
                        editBtn.textContent = '✎';
                        editBtn.title = '期限を上書き';
                        editBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:10px;padding:0 2px;opacity:0.4;line-height:1;';
                        editBtn.addEventListener('click', e => {
                            e.preventDefault();
                            deadlineDiv.innerHTML = '';

                            const input = document.createElement('input');
                            input.type = 'datetime-local';
                            input.value = toInputVal(item.deadline);
                            input.style.cssText = 'font-size:10px;padding:1px;border:1px solid #ccc;border-radius:2px;';

                            const saveBtn = document.createElement('button');
                            saveBtn.textContent = '保存';
                            saveBtn.style.cssText = 'font-size:10px;padding:1px 5px;border:1px solid #333;border-radius:2px;background:#333;color:#fff;cursor:pointer;';

                            const cancelBtn = document.createElement('button');
                            cancelBtn.textContent = 'キャンセル';
                            cancelBtn.style.cssText = 'font-size:10px;padding:1px 5px;border:1px solid #ccc;border-radius:2px;cursor:pointer;';

                            deadlineDiv.appendChild(input);
                            deadlineDiv.appendChild(saveBtn);
                            deadlineDiv.appendChild(cancelBtn);

                            saveBtn.addEventListener('click', () => {
                                if (!input.value) return;
                                const ov = loadOverrides();
                                ov[itemKey] = new Date(input.value).toISOString();
                                localStorage.setItem(OVERRIDE_KEY, JSON.stringify(ov));
                                refresh();
                            });

                            cancelBtn.addEventListener('click', () => renderDeadlineRow());
                        });
                        deadlineDiv.appendChild(editBtn);

                        if (item.isOverridden) {
                            const resetBtn = document.createElement('button');
                            resetBtn.textContent = '↩';
                            resetBtn.title = '上書きを解除';
                            resetBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:10px;padding:0 2px;opacity:0.4;line-height:1;';
                            resetBtn.addEventListener('click', e => {
                                e.preventDefault();
                                const ov = loadOverrides();
                                delete ov[itemKey];
                                localStorage.setItem(OVERRIDE_KEY, JSON.stringify(ov));
                                refresh();
                            });
                            deadlineDiv.appendChild(resetBtn);
                        }
                    };

                    renderDeadlineRow();
                    li.appendChild(courseDiv);
                    li.appendChild(nameDiv);
                    li.appendChild(deadlineDiv);
                    ul.appendChild(li);
                });
                const listScroller = document.createElement('div');
                listScroller.className = 'wc-assignment-list';
                listScroller.appendChild(ul);
                el.appendChild(listScroller);
            });
        };

        document.querySelectorAll('#View-0 .side-block-content').forEach(el => {
            el.classList.add('wc-assignment-sidebar');
            el.innerHTML = '<p style="padding:0.3em;font-size:12px;color:#aaa;">読込中...</p>';
        });

        [cachedResults, cachedAnnouncement] = await Promise.all([
            Promise.all(COURSES_2Y.map(c =>
                fetch(`${API}/contents?group_id=${c.id}`).then(r => r.json()).catch(() => [])
            )),
            fetch(`${ANNOUNCE_URL}?_=${Date.now()}`).then(r => r.json()).catch(() => null),
        ]);

        refresh();
        renderAnnouncement();
        renderUnreadMaterials(getUnreadMaterials());
    })();

    // ── グリッド表示 ────────────────────────────────────────────────
    const container = document.getElementById('courses_list_left');
    if (!container) return;

    const acsMatch = document.querySelector('a[href*="acs_="]')?.href?.match(/acs_=([a-f0-9]+)/);
    const acs = acsMatch ? '?acs_=' + acsMatch[1] : '';

    const C = {
        anatomy2: { id: '6b114e2b135f7aac169bc428f00951aa', name: '解剖学Ⅱ',        cls: 'c-anatomy2' },
        anatomy1: { id: 'aea2184cf7cd67f5ea205f70e8a9a8ab', name: '解剖学Ⅰ',        cls: 'c-anatomy1' },
        biochem:  { id: '49f9ee1ac60effa5895a47682fb6198e', name: '生化学',          cls: 'c-biochem'  },
        physio1:  { id: '6d5e784a3c6676d64fae08ec8417ae70', name: '生理学Ⅰ',        cls: 'c-physio1'  },
        physio2:  { id: '235d2308e5452e1b8e1cbcd801b9d6e2', name: '生理学Ⅱ',        cls: 'c-physio2'  },
        molbio:   { id: '8d5215783015764ce951cc9024a8efa9', name: '分子生物学',       cls: 'c-molbio'   },
        molgen:   { id: 'fdc0989de1e818adafa59ccf8f40c39a', name: '分子遺伝学',       cls: 'c-molgen'   },
        cell:     { id: '06b305e2e2aefec207ec25f0bf93018e', name: '細胞生物学',       cls: 'c-cell'     },
        chemii:   { id: '14f26982e6d4628008ca1272a3a3cfcd', name: '医用化学Ⅱ',       cls: 'c-chemii'   },
        behavior: { id: '28e51271a617bb1de7d40b2472c43118', name: '行動科学',         cls: 'c-behavior' },
        early:    { id: '19e2e404088da5a87f17b10be54392ce', name: '早期医学実習Ⅱ',   cls: 'c-early'    },
        ethics:   { id: '1af3888f3b4f25f3c99c6d09ca8bdbf7', name: '医療倫理学',       cls: 'c-ethics'   },
        research: { id: '3c58a2eebd8d277e8a23660cba8607f2', name: '医学と研究',       cls: 'c-research' },
        patient:  { id: '9b3e1287ccdd818baae60be6ec73c9c1', name: '患者との出会い',   cls: 'c-patient'  },
        society:  { id: '38a9d09f451ee1cb82f6c6770d88ca9d', name: '医学・医療と社会', cls: 'c-society'  },
        english:  { id: null,                               name: '英語（全学共通）', cls: 'c-english'  },
    };

    const s = (key, span = 1, note = '') => ({ key, span, note });
    const e = (span = 1) => ({ key: null, span, note: '', empty: true });

    const today = new Date();
    const mm = today.getMonth() + 1;
    const dd = today.getDate();
    const isAfterApr27 = mm > 4 || (mm === 4 && dd >= 27);

    const PERIODS = [
        {
            label: '前期① 4/1〜5/29',
            days: [
                [s('molgen'), s('chemii'), s(isAfterApr27 ? 'physio1' : 'anatomy2', 3, '骨学〜4/20 / 生理学Ⅰ 4/27〜')],
                [s('molgen'), s('chemii'), s('anatomy2', 3, '骨学・組織学')],
                [s('molbio'), s('molbio'), s('behavior', 2), e()],
                [s('cell'), s('physio1'), s('anatomy2', 3)],
                [s('english'), s('cell'), s('early', 2), e()],
            ],
        },
        {
            label: '前期② 6/1〜7/24',
            days: [
                [s('biochem', 2), s('physio1', 2, '〜6/29'), e()],
                [s('molgen', 1, '補講'), s('anatomy1', 4)],
                [s('molbio'), s('molbio'), s('behavior', 2), e()],
                [s('molgen', 1, '補講'), s('anatomy2', 4, '組織学')],
                [s('english'), s('cell', 1, '/ 解剖学Ⅰ'), s('early', 2), e()],
            ],
        },
        {
            label: '後期① 9/30〜11/20',
            days: [
                [s('physio2', 2), s('biochem', 3)],
                [s('early', 1, '補講・試験'), s('anatomy2', 4)],
                [s('biochem'), s('anatomy1', 4)],
                [s('research'), s('physio2'), s('early', 3)],
                [s('ethics'), s('english'), s('biochem', 2), e()],
            ],
        },
        {
            label: '後期② 11/24〜2/5',
            days: [
                [s('physio2', 2), s('anatomy1', 2), e()],
                [s('early', 1, '補講 / 患者との出会い'), s('anatomy2', 4, '/ 総合診療入門')],
                [s('biochem'), s('anatomy1', 4)],
                [s('research'), s('physio2', 1, '/ 補講'), s('early', 3)],
                [s('ethics'), s('english'), s('biochem', 2, '/ 医学・医療と社会'), e()],
            ],
        },
    ];

    const DAYS         = ['月', '火', '水', '木', '金'];
    const PERIOD_HEADS = ['Ⅰ 8:50〜', 'Ⅱ 10:30〜', 'Ⅲ 13:00〜', 'Ⅳ 14:40〜', 'Ⅴ 16:20〜'];

    function currentPeriodIndex() {
        const now = new Date();
        const m = now.getMonth() + 1;
        const d = now.getDate();
        if (m >= 4 && m <= 5) return 0;
        if (m >= 6 && m <= 7) return 1;
        if ((m === 9 && d >= 30) || m === 10 || (m === 11 && d <= 23)) return 2;
        if ((m === 11 && d >= 24) || m === 12 || m === 1 || (m === 2 && d <= 5)) return 3;
        return 0;
    }

    const style = document.createElement('style');
    style.textContent = `
        #View-0 .side-block-content.wc-assignment-sidebar { padding:0; }
        .wc-assignment-list {
            max-height:min(52vh, 420px);
            overflow-y:auto;
            overscroll-behavior:contain;
            scrollbar-gutter:stable;
        }
        #wc-grid { margin-bottom: 1em; }
        #wc-grid-tabs { display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap; }
        .wc-tab { padding:5px 12px; border:1px solid #ccc; border-radius:4px; cursor:pointer;
                  font-size:12px; background:#fff; }
        .wc-tab.active { background:#333; color:#fff; border-color:#333; }
        #wc-grid table { border-collapse:collapse; width:100%; table-layout:fixed; }
        #wc-grid th, #wc-grid td { border:1px solid #e0e0e0; padding:0;
                                    text-align:center; vertical-align:middle; }
        #wc-grid th { background:#f0f0f0; font-size:11px; color:#555;
                      padding:6px 2px; font-weight:normal; }
        #wc-grid td { height:64px; font-size:11px; }
        #wc-grid td.wc-day { width:4%; font-weight:bold; background:#f0f0f0;
                             color:#333; font-size:13px; }
        #wc-grid th:not(:first-child), #wc-grid td:not(.wc-day) { width:19.2%; }
        #wc-grid td.wc-empty { background:#fafafa; }
        .wc-cell { display:flex; flex-direction:column; align-items:center;
                   justify-content:center; height:100%; padding:4px;
                   font-size:11px; font-weight:bold; line-height:1.4; text-decoration:none; }
        a.wc-cell:hover { filter:brightness(.9); }
        .wc-note { font-size:10px; font-weight:normal; margin-top:2px; opacity:.8; }
        .c-anatomy2 { background:#2a2a2a; color:#fff; }
        .c-anatomy1 { background:#444;    color:#fff; }
        .c-biochem  { background:#555;    color:#fff; }
        .c-physio1  { background:#6e6e6e; color:#fff; }
        .c-physio2  { background:#7a7a7a; color:#fff; }
        .c-molbio   { background:#888;    color:#fff; }
        .c-molgen   { background:#949494; color:#fff; }
        .c-cell     { background:#a8a8a8; color:#fff; }
        .c-chemii   { background:#b4b4b4; color:#222; }
        .c-behavior { background:#bdbdbd; color:#222; }
        .c-ethics   { background:#c8c8c8; color:#222; }
        .c-research { background:#d0d0d0; color:#222; }
        .c-patient  { background:#d8d8d8; color:#222; }
        .c-society  { background:#e0e0e0; color:#222; }
        .c-early    { background:#e8e8e8; color:#444; }
        .c-english  { background:#f0f0f0; color:#666; }
        @media (max-width: 767px) {
            .wc-assignment-list { max-height:min(36vh, 280px); }
        }
    `;
    document.head.appendChild(style);

    function buildGrid(periodIdx) {
        const period = PERIODS[periodIdx];
        const table  = document.createElement('table');

        const thead = document.createElement('thead');
        const hrow  = document.createElement('tr');
        thead.appendChild(hrow);
        table.appendChild(thead);
        hrow.appendChild(document.createElement('th'));
        PERIOD_HEADS.forEach(lbl => {
            const th = document.createElement('th');
            th.textContent = lbl;
            hrow.appendChild(th);
        });

        const tbody = document.createElement('tbody');
        table.appendChild(tbody);

        period.days.forEach((row, di) => {
            const tr = document.createElement('tr');
            tbody.appendChild(tr);

            const dayTd = document.createElement('td');
            dayTd.className = 'wc-day';
            dayTd.textContent = DAYS[di];
            tr.appendChild(dayTd);

            row.forEach(cellData => {
                const td = document.createElement('td');
                if (cellData.span > 1) td.colSpan = cellData.span;

                if (cellData.empty || !cellData.key) {
                    td.className = 'wc-empty';
                    tr.appendChild(td);
                    return;
                }

                const course = C[cellData.key];
                const inner  = document.createElement(course.id ? 'a' : 'div');
                inner.className = `wc-cell ${course.cls}`;

                if (course.id) {
                    inner.href   = `/webclass/course.php/${course.id}/login${acs}`;
                    inner.target = '_top';
                }

                const nameSpan = document.createElement('span');
                nameSpan.textContent = course.name;
                inner.appendChild(nameSpan);

                if (cellData.note) {
                    const noteSpan = document.createElement('span');
                    noteSpan.className = 'wc-note';
                    noteSpan.textContent = cellData.note;
                    inner.appendChild(noteSpan);
                }

                td.appendChild(inner);
                tr.appendChild(td);
            });
        });

        return table;
    }

    const saved        = sessionStorage.getItem('wc-period');
    const activePeriod = saved !== null ? parseInt(saved) : currentPeriodIndex();
    const tabsDiv      = document.createElement('div');
    tabsDiv.id = 'wc-grid-tabs';
    const tableWrapper = document.createElement('div');
    tableWrapper.appendChild(buildGrid(activePeriod));

    PERIODS.forEach((p, i) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'wc-tab' + (i === activePeriod ? ' active' : '');
        tab.textContent = p.label;
        tab.addEventListener('click', () => {
            tabsDiv.querySelectorAll('.wc-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            sessionStorage.setItem('wc-period', i);
            tableWrapper.innerHTML = '';
            tableWrapper.appendChild(buildGrid(i));
        });
        tabsDiv.appendChild(tab);
    });

    const linkBar = document.createElement('div');
    linkBar.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    [
        { label: 'カダサポ',   url: 'https://kyoumusyst.kagawa-u.ac.jp/campusweb/top.do' },
        { label: 'CLEVAS',    url: 'https://cvas.med.kagawa-u.ac.jp/clevas/' },
        { label: 'i-Compass', url: 'https://attendsyst.kagawa-u.ac.jp/mobile/g/' },
    ].forEach(({ label, url }) => {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.textContent = label;
        a.style.cssText = 'padding:4px 10px;border:1px solid #ccc;border-radius:4px;font-size:12px;color:#333;text-decoration:none;background:#fff;';
        linkBar.appendChild(a);
    });

    const gridDiv = document.createElement('div');
    gridDiv.id = 'wc-grid';
    gridDiv.appendChild(linkBar);
    gridDiv.appendChild(tabsDiv);
    gridDiv.appendChild(tableWrapper);

    // グリッドをページ最上部（お知らせの上）に挿入
    const userTopInfo = document.getElementById('UserTopInfo');
    const insertTarget = userTopInfo || container;
    insertTarget.parentNode.insertBefore(gridDiv, insertTarget);

})();
