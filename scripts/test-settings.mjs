// GAS から設定を取得するテスト
// 使い方: node test-settings.mjs <display_name>
// 例: node test-settings.mjs "山田太郎"

const GAS_URL = process.env.GAS_URL;
const GAS_KEY = process.env.GAS_ADMIN_KEY;

if (!GAS_URL || !GAS_KEY) {
    console.error('環境変数 GAS_URL と GAS_ADMIN_KEY を設定してください');
    process.exit(1);
}

const displayName = process.argv[2];
if (!displayName) {
    console.error('使い方: node test-settings.mjs <WebClassの表示名>');
    process.exit(1);
}

const url = `${GAS_URL}?action=get_settings&key=${encodeURIComponent(GAS_KEY)}&user=${encodeURIComponent(displayName)}`;
console.log('URL:', url);

const res = await fetch(url);
console.log('Status:', res.status);
const text = await res.text();
console.log('Response:', text);
