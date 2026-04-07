# Tampermonkey版の入れ方

Tampermonkeyには何かを手入力するのではなく、下のURLをChromeで開いてください。

```text
https://raw.githubusercontent.com/SHUNOI7/webclass-extension/main/webclass-improve.user.js
```

Tampermonkeyのインストール画面が開いたら、「インストール」または「再インストール」を押します。

一度この方法で入れると、`webclass-improve.user.js` 内の `@updateURL` / `@downloadURL` により、次回以降はTampermonkeyの更新チェックで最新版を取得できます。

既に古い版を入れていて自動更新されない場合は、Tampermonkeyの管理画面で古い `WebClass 改善` を削除してから、上のURLを開いて入れ直してください。
