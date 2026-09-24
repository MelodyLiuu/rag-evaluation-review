# RAG Evaluation Review

100 題癲癇 RAG 題庫人工評分頁面，支援 0–2 分 Rubric、即時本機保存、題庫更新保留作答與 JSON／CSV 匯出。

## 開啟與使用

下載儲存庫後，使用瀏覽器開啟 [評分頁面](rag_wiki_experiment/review/rag_evaluation_review_100.html)。頁面可離線使用。

詳細操作、保存範圍、匯入合併規則及瀏覽器測試方法，請見 [操作說明](rag_wiki_experiment/review/README.md)。

評分紀錄保存在使用者瀏覽器，不會上傳到 GitHub。換瀏覽器或裝置前請匯出 JSON 備份。題庫更新時請維持既有題目的 ID。

## 更新題庫與重建

修改 `rag_wiki_experiment/config/rag_evaluation_dataset_100.json` 或 `rag_wiki_experiment/review/review_template.html` 後，在儲存庫根目錄執行：

```sh
python3 rag_wiki_experiment/review/build_review.py
```

## 測試

[瀏覽器回歸測試](rag_wiki_experiment/tests/test_review_browser.cjs) 涵蓋即時保存、重新載入、瀏覽器重啟、跨版本題庫更新、刪題還原、匯入／匯出與儲存失敗提示。
