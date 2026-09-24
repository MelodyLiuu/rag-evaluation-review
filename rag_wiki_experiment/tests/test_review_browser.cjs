// npm install --prefix /tmp/rag-review-browser playwright
// PLAYWRIGHT_BROWSERS_PATH=/tmp/rag-review-browser/browsers /tmp/rag-review-browser/node_modules/.bin/playwright install chromium
// PLAYWRIGHT_MODULE=/tmp/rag-review-browser/node_modules/playwright PLAYWRIGHT_BROWSERS_PATH=/tmp/rag-review-browser/browsers node --test rag_wiki_experiment/tests/test_review_browser.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const file = process.env.REVIEW_HTML || path.resolve(__dirname, '../review/rag_evaluation_review_100.html');
const original = fs.readFileSync(file, 'utf8');
const datasetRE = /(<script id="dataset" type="application\/json">)([\s\S]*?)(<\/script>)/;
const data = JSON.parse(original.match(datasetRE)[2]);
const key = 'clinical-rag-rubric-v2-main';
let browser, server, url, served = original;
before(async () => {
  browser = await chromium.launch({ headless: true });
  server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(served); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/review.html`;
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup(t, seed) {
  served = original;
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught browser errors'));
  await page.goto(url);
  if (seed) {
    await page.evaluate(entries => { localStorage.clear(); for (const [k,v] of entries) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, Object.entries(seed));
    await page.reload();
  }
  return { page, context };
}
const saved = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
async function pill(page, field, score) { await page.locator(`.pill-btn[data-field="${field}"][data-value="${score}"]`).click(); }
async function select(page, id) { await page.locator(`.question-item[data-id="${id}"]`).click(); }
async function importJSON(page, payload, accept = true) {
  const messages = [];
  const handler = async dialog => { messages.push(dialog.message()); if (dialog.type() === 'confirm' && !accept) await dialog.dismiss(); else await dialog.accept(); };
  page.on('dialog', handler);
  await page.locator('#importFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
  await page.waitForFunction(() => document.getElementById('importFile').value === '');
  page.off('dialog', handler);
  return messages;
}
function version(items) { served = original.replace(datasetRE, (_,a,b,c) => a + JSON.stringify(items) + c).replace(/const fingerprint = '[^']+';/, "const fingerprint = 'updated-version';"); }

test('scores, zero, critical error, reviewer and notes save immediately and survive reload/close', async t => {
  const { page, context } = await setup(t);
  await page.locator('#reviewer').fill('測試醫師');
  for (const [field, value] of Object.entries({ correctness: '0', faithfulness: '1', relevance: '2', completeness: '2', critical_error: 'yes' })) await pill(page, field, value);
  await page.locator('#notesInput').fill('第一行\n中文輸入 <標記>');
  assert.equal(await page.locator('#notesInput').evaluate(e => e === document.activeElement), true);
  const expected = await saved(page);
  assert.equal(expected.reviews[1].correctness, '0');
  assert.equal(expected.reviews[1].notes, '第一行\n中文輸入 <標記>');
  assert.equal(await page.locator('#progText').textContent(), '1 / 100');
  await page.reload();
  assert.deepEqual(await saved(page), expected);
  assert.equal(await page.locator('#notesInput').inputValue(), expected.reviews[1].notes);
  await page.close();
  const reopened = await context.newPage(); await reopened.goto(url);
  assert.equal(await reopened.locator('#reviewer').inputValue(), '測試醫師');
  assert.equal(await reopened.locator('#notesInput').inputValue(), expected.reviews[1].notes);
});

test('refusal scores and notes survive navigation and reload', async t => {
  const { page } = await setup(t);
  await select(page, 86);
  for (const field of ['abstention', 'faithfulness', 'relevance']) await pill(page, field, '2');
  await page.locator('#notesInput').fill('拒答題備註');
  await page.locator('#btnNext').click();
  await page.locator('#btnPrev').click();
  assert.equal(await page.locator('#notesInput').inputValue(), '拒答題備註');
  await page.reload(); await select(page, 86);
  assert.match(await page.locator('.score-summary-badge').textContent(), /6 \/ 6/);
});

test('updated text/evidence, reordered IDs and new questions preserve existing answers', async t => {
  const { page } = await setup(t);
  await pill(page, 'correctness', '2'); await page.locator('#notesInput').fill('保留舊作答');
  const expected = (await saved(page)).reviews[1];
  version([...data.slice(1), {...data[0], question: '更新後題目', evidence: [{source:'新文件',location:'第1頁',text:'更新證據'}]}, {...data[0], id:101,question:'新增題目'}]);
  await page.reload(); await select(page, 1);
  assert.equal(await page.locator('#notesInput').inputValue(), '保留舊作答');
  assert.match(await page.locator('#detailPanel').textContent(), /更新後題目/);
  assert.match(await page.locator('#detailPanel').textContent(), /更新證據/);
  assert.deepEqual((await saved(page)).reviews[1], expected);
  await select(page,101); assert.equal(await page.locator('#notesInput').inputValue(), '');
  assert.equal(await page.locator('#progressBar').getAttribute('max'), '101');
  assert.equal((await saved(page)).reviews[101], undefined);
});

test('temporarily removed question retains review, including edits while absent', async t => {
  const { page } = await setup(t);
  await page.locator('#notesInput').fill('不可遺失');
  version(data.filter(q => q.id !== 1)); await page.reload();
  await page.locator('#notesInput').fill('另一題作答');
  assert.equal((await saved(page)).reviews[1].notes, '不可遺失');
  served = original; await page.reload();
  assert.equal(await page.locator('#notesInput').inputValue(), '不可遺失');
});

test('imports merge, retain newer/current conflicting records and reject invalid data', async t => {
  const { page } = await setup(t);
  await page.locator('#reviewer').fill('目前醫師'); await page.locator('#notesInput').fill('目前紀錄');
  let before = await saved(page);
  const messages = await importJSON(page,{reviewer:'備份醫師',dataset_fingerprint:'old',reviews:{1:{notes:'舊備份',updated_at:'2000-01-01'},2:{notes:'匯入紀錄',correctness:0}}});
  assert.match(messages.at(-1), /匯入成功/);
  let actual = await saved(page);
  assert.deepEqual(actual.reviews[1],before.reviews[1]);
  assert.equal(actual.reviews[2].notes,'匯入紀錄'); assert.equal(actual.reviewer,'目前醫師');
  await importJSON(page,{reviews:{1:{notes:'新版備份',updated_at:'2099-01-01'}}});
  assert.equal((await saved(page)).reviews[1].notes,'新版備份');
  before = await saved(page);
  await importJSON(page,{reviews:{1:{notes:'同時間',updated_at:'2099-01-01'}}});
  assert.deepEqual(await saved(page),before);
  for (const invalid of [{},[],{reviews:[]},{reviews:{1:null}},{reviews:{1:{correctness:9}}}]) {
    assert.match((await importJSON(page,invalid)).at(-1),/匯入失敗/);
    assert.deepEqual(await saved(page),before);
  }
  await importJSON(page,{reviews:{3:{notes:'取消匯入'}}},false);
  assert.deepEqual(await saved(page),before);
  await page.reload(); assert.deepEqual(await saved(page),before);
});

test('all legacy versions merge by latest timestamp, v1 suggestions remain recoverable', async t => {
  const { page } = await setup(t, {
    'clinical-rag-rubric-v2-a':{reviewer:'醫師',reviews:{1:{notes:'舊',updated_at:'2020-01-01'}}},
    'clinical-rag-rubric-v2-b':{reviews:{1:{notes:'新',updated_at:'2021-01-01'},2:{correctness:0}}},
    'clinical-review-v1-c':{reviews:{3:{status:'approved',suggested_question:'修訂問題',suggested_answer:'修訂答案',answer_accuracy:'yes'}}}
  });
  const actual = await saved(page);
  assert.equal(actual.reviews[1].notes,'新'); assert.equal(actual.reviews[2].correctness,'0');
  assert.equal(actual.reviews[3].suggested_answer,'修訂答案'); assert.equal(actual.reviews[3].correctness,'');
  await page.reload(); assert.deepEqual(await saved(page),actual);
});

test('valid main state (even empty) wins over stale legacy backups', async t => {
  const { page } = await setup(t,{[key]:{reviewer:'目前',reviews:{}},'clinical-rag-rubric-v2-old':{reviewer:'過去',reviews:{1:{notes:'不要復活'}}}});
  assert.equal(await page.locator('#reviewer').inputValue(),'目前');
  assert.equal(await page.locator('#notesInput').inputValue(),'');
});

test('storage failures display warnings and do not claim import was saved', async t => {
  const { page } = await setup(t);
  await page.evaluate(() => { Storage.prototype.setItem = () => {throw new DOMException('full','QuotaExceededError');}; });
  await page.locator('#notesInput').fill('仍可匯出');
  assert.match(await page.locator('#saveStatus').textContent(),/暫存失敗/);
  const messages = await importJSON(page,{reviews:{2:{notes:'未寫入磁碟'}}});
  assert.match(messages.at(-1),/暫存失敗/); assert.doesNotMatch(messages.at(-1),/匯入成功/);
  await page.addInitScript(() => { Storage.prototype.getItem = () => {throw new DOMException('blocked','SecurityError');}; });
  await page.reload();
  assert.match(await page.locator('#saveStatus').textContent(),/無法讀取/);
});

test('corrupt saved data is reported and not overwritten on load', async t => {
  const { page } = await setup(t,{[key]:'{broken'});
  assert.match(await page.locator('#saveStatus').textContent(),/損壞/);
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),'{broken');
});

test('JSON export and cross-context import round trip all records', async t => {
  const { page } = await setup(t);
  await page.locator('#reviewer').fill('備份測試'); await pill(page,'correctness','0');
  await page.locator('#notesInput').fill('測試\n"備註"');
  const expected = await saved(page);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#btnJson').click();
  const download = await downloadPromise;
  const exported = JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.deepEqual(exported.reviews,expected.reviews); assert.equal(exported.items.length,100);
  const other = await browser.newContext(); t.after(()=>other.close());
  const target = await other.newPage(); await target.goto(url); await importJSON(target,exported);
  assert.deepEqual(await saved(target),expected);
});

test('standalone file URL autosave survives reload', async t => {
  const context = await browser.newContext(); t.after(()=>context.close());
  const page = await context.newPage(); await page.goto(pathToFileURL(file).href);
  await page.locator('#notesInput').fill('直接開啟 HTML'); await pill(page,'correctness','1');
  await page.reload();
  assert.equal(await page.locator('#notesInput').inputValue(),'直接開啟 HTML');
  assert.equal((await saved(page)).reviews[1].correctness,'1');
});

test('answers survive full browser restart using the same on-disk profile', async t => {
  served = original;
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'rag-review-profile-'));
  let context;
  t.after(async () => { await context?.close(); fs.rmSync(profile, {recursive:true,force:true}); });
  context = await chromium.launchPersistentContext(profile,{headless:true});
  let page = await context.newPage(); await page.goto(url);
  await page.locator('#reviewer').fill('關閉後續評');
  await page.locator('#notesInput').fill('瀏覽器重啟仍保留');
  await pill(page,'correctness','0');
  const expected = await saved(page);
  await context.close();
  context = await chromium.launchPersistentContext(profile,{headless:true});
  page = await context.newPage(); await page.goto(url);
  assert.deepEqual(await saved(page),expected);
  assert.equal(await page.locator('#notesInput').inputValue(),'瀏覽器重啟仍保留');
  assert.equal(await page.locator('#reviewer').inputValue(),'關閉後續評');
});
