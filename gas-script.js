function doGet(e) {
  const action = e.parameter.action || 'track';

  if (action === 'bbs_get') {
    return getBbsPosts();
  }

  if (action === 'bbs_post') {
    const user = e.parameter.user || '不明';
    const msg  = (e.parameter.msg || '').trim();
    if (msg) {
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName('BBS') || ss.insertSheet('BBS');
      if (sheet.getLastRow() === 0) sheet.appendRow(['タイムスタンプ', '投稿者', 'メッセージ', 'いいね']);
      sheet.appendRow([new Date(), user, msg, 0]);
    }
    return ContentService.createTextOutput('ok');
  }

  if (action === 'bbs_like') {
    const ts    = e.parameter.ts;
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('BBS');
    if (sheet && ts) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const rowTs = data[i][0] instanceof Date ? data[i][0].toISOString() : String(data[i][0]);
        if (rowTs === ts) {
          sheet.getRange(i + 1, 4).setValue((Number(data[i][3]) || 0) + 1);
          break;
        }
      }
    }
    return ContentService.createTextOutput('ok');
  }

  // 既存のトラッキング処理
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.appendRow([
    new Date(),
    e.parameter.user || '不明',
  ]);
  return ContentService.createTextOutput('ok');
}

function getBbsPosts() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('BBS');
  if (!sheet || sheet.getLastRow() <= 1) {
    return ContentService.createTextOutput('[]').setMimeType(ContentService.MimeType.JSON);
  }
  const data  = sheet.getDataRange().getValues();
  const start = Math.max(1, data.length - 50);
  const posts = [];
  for (let i = start; i < data.length; i++) {
    const [ts, , msg, likes] = data[i];
    if (!msg) continue;
    posts.push({
      ts:    ts instanceof Date ? ts.toISOString() : String(ts),
      msg:   String(msg),
      likes: Number(likes) || 0,
    });
  }
  posts.reverse();
  return ContentService.createTextOutput(JSON.stringify(posts))
    .setMimeType(ContentService.MimeType.JSON);
}
