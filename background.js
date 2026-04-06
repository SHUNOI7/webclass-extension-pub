chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (!item.url.includes('gymnast15.med.kagawa-u.ac.jp')) {
        suggest();
        return;
    }

    const ext = item.filename.split('.').pop().toLowerCase();
    if (!['pdf', 'pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls'].includes(ext)) {
        suggest();
        return;
    }

    chrome.storage.local.get('wc-current-chapter', data => {
        const title = data['wc-current-chapter'];
        if (!title) {
            suggest();
            return;
        }
        const safe = title.replace(/[/\\:*?"<>|]/g, '-').trim();
        suggest({ filename: safe + '.' + ext });
    });

    return true;
});
