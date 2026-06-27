# 課伴網頁版

這是部署到 GitHub Pages 的安全版網頁殼。

為了避免公開真實學生與收入資料，`data/*.json` 預設是空陣列。請在手機 Safari 打開網站後，到「設定」匯入：

- `Lessons.json`
- `StudentDefaults.json`
- `ExternalIncome.json`

匯入後資料會存在該裝置的瀏覽器快取，不會上傳到 GitHub。

## 展示入口密碼

目前預設密碼是：

```text
keban2026
```

密碼檢查在 `app.js` 的 `ACCESS_PASSWORD_HASH`。這只能擋一般訪客，不能取代後端登入系統，所以真實資料仍然不要放進公開 repo。
