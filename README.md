# 家教行事曆網頁版

這是部署到 GitHub Pages 的安全版網頁殼。

網頁版現在讀取新版課程小幫手完整資料庫，載入後只顯示目前月份前後三個月的課程與收入。
`data/CourseAssistantDatabase.json` 只放空資料殼，避免把真實資料明文部署出去。

真實資料會用密碼加密後放在：

- `data/encrypted-data.json`

網站輸入密碼後，會在瀏覽器裡解密顯示真內容。若需要手動更新，也可以在手機 Safari 打開網站後，到「設定」匯入：

- `CourseAssistantDatabase.json`

手動匯入後資料會存在該裝置的瀏覽器快取，不會上傳到 GitHub。

## 展示入口密碼

真實資料用 `app.js` 內的密碼解密 `data/encrypted-data.json`。這適合給少數人展示，不等於正式後端登入系統；知道密碼的人就能看到真內容。
