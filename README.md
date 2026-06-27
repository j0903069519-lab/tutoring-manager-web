# 課伴網頁版

這是部署到 GitHub Pages 的安全版網頁殼。

為了避免公開真實學生與收入資料，`data/*.json` 預設是空陣列。

真實資料會用密碼加密後放在：

- `data/encrypted-data.json`

網站輸入密碼後，會在瀏覽器裡解密顯示真內容。若需要手動更新，也可以在手機 Safari 打開網站後，到「設定」匯入：

- `Lessons.json`
- `StudentDefaults.json`
- `ExternalIncome.json`

手動匯入後資料會存在該裝置的瀏覽器快取，不會上傳到 GitHub。

## 展示入口密碼

密碼檢查在 `app.js` 的 `ACCESS_PASSWORD_HASH`，真實資料則用同一組密碼加密在 `data/encrypted-data.json`。這適合給少數人展示，不等於正式後端登入系統；知道密碼的人就能看到真內容。
