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

  if (action === 'save_settings') {
    const user      = e.parameter.user || '';
    const overrides = e.parameter.overrides || '{}';
    const rules     = e.parameter.rules     || '{}';
    const hidden    = e.parameter.hidden    || '[]';
    if (user) {
      const props = PropertiesService.getScriptProperties();
      props.setProperty('settings_overrides_' + user, overrides);
      props.setProperty('settings_rules_'     + user, rules);
      props.setProperty('settings_hidden_'    + user, hidden);
    }
    return ContentService.createTextOutput('ok');
  }

  if (action === 'get_settings') {
    const props = PropertiesService.getScriptProperties();
    let display_name;
    if (e.parameter.key === props.getProperty('ADMIN_KEY')) {
      display_name = e.parameter.user || '';
    } else if (e.parameter.user) {
      display_name = e.parameter.user;
    } else {
      return ContentService.createTextOutput('unauthorized').setMimeType(ContentService.MimeType.TEXT);
    }
    const result = {
      overrides: JSON.parse(props.getProperty('settings_overrides_' + display_name) || '{}'),
      rules:     JSON.parse(props.getProperty('settings_rules_'     + display_name) || '{}'),
      hidden:    JSON.parse(props.getProperty('settings_hidden_'    + display_name) || '[]'),
    };
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'get_users') {
    if (e.parameter.key !== PropertiesService.getScriptProperties().getProperty('ADMIN_KEY')) {
      return ContentService.createTextOutput('unauthorized').setMimeType(ContentService.MimeType.TEXT);
    }
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Users');
    if (!sheet || sheet.getLastRow() <= 1) {
      return ContentService.createTextOutput('[]').setMimeType(ContentService.MimeType.JSON);
    }
    const data  = sheet.getDataRange().getValues().slice(1); // ヘッダー行をスキップ
    const users = data
      .filter(row => row[0] && row[1] && row[2])
      .map(([email, webclass_id, webclass_password, notify_days, display_name]) => ({
        email, webclass_id, webclass_password,
        notify_days: Number(notify_days) || 3,
        display_name: String(display_name || ''),
      }));
    return ContentService.createTextOutput(JSON.stringify(users))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 既存のトラッキング処理
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.appendRow([
    new Date(),
    e.parameter.user || '不明',
  ]);
  return ContentService.createTextOutput('ok');
}

function getDisplayNameByKey(user_key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  if (!sheet || sheet.getLastRow() <= 1) return null;
  const data = sheet.getDataRange().getValues().slice(1);
  for (const row of data) {
    if (String(row[5]) === user_key) return String(row[4] || '');
  }
  return null;
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
