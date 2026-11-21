const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const script = fs.readFileSync(path.join(__dirname, "../cbg-export/export.js"), "utf8");

// Run the actual injected script and its Start button with a simulated list,
// detail service and output directory. No accounts or login state are needed.
function fixture(pages, details = {}) {
  const files = new Map(), pageCalls = [], detailCalls = [], controls = new Map();
  const ui = id => {
    if (!controls.has(id)) controls.set(id, { removeAttribute() {} });
    return controls.get(id);
  };
  const host = { style: {}, attachShadow: () => ({ getElementById: ui }) };
  const directory = {
    async *values() {
      for (const [name, data] of files) {
        yield { kind: "file", name, getFile: async () => ({ size: data.length }) };
      }
    },
    async getFileHandle(name) {
      let pending;
      return { createWritable: async () => ({
        write: async data => { pending = data; },
        close: async () => files.set(name, pending),
        abort: async () => {}
      }) };
    }
  };
  const page = {
    $route: { name: "productList" }, $refs: { roleList: {} }, $el: { isConnected: true },
    $router: { resolve: ({ params }) => ({ href: "/cgi/mweb/equip/" + params.serverId + "/" + params.ordersn }) },
    getSearchParams: number => ({ search_type: "role", full_ssr: 1, page: number }),
    handleAjax: async (params, number) => {
      pageCalls.push(number);
      const items = pages[number - 1];
      assert.ok(items, "requested a page past the end");
      return { status: 1, result: items.map(order => ({ serverid: 9, game_ordersn: order })),
        paging: { is_last_page: number === pages.length, total_pages: pages.length } };
    }
  };
  const ctx = {
    URL, URLSearchParams, AbortController, AbortSignal, location: new URL("https://yys.cbg.163.com/cgi/mweb/pl"),
    document: { getElementById: () => null, querySelectorAll: () => [{ __vue__: page }],
      createElement: () => host, body: { append() {} } },
    window: { showDirectoryPicker: async () => directory },
    navigator: { locks: { request: async (_name, _opts, cb) => cb({}) } },
    fetch: async (url, options) => {
      const order = options.body.get("ordersn");
      assert.equal(url, "/cgi/api/get_equip_detail?client_type=h5");
      assert.equal(options.referrer, "https://yys.cbg.163.com/cgi/mweb/equip/9/" + order);
      detailCalls.push(order);
      const item = details[order] ?? { status: 1, equip: { game_ordersn: order, equip_desc: { roleid: order } } };
      return { ok: true, text: async () => typeof item === "string" ? item : JSON.stringify(item) };
    }
  };
  vm.runInNewContext(script, ctx);
  const start = async n => {
    ui("count").valueAsNumber = n;
    await ui("start").onclick();
    return ui("state").textContent;
  };
  return { files, pageCalls, detailCalls, page, start };
}

test("pages in order, keeps original response and stops immediately at the target", async () => {
  const f = fixture([["11", "11"], ["11", "22", "33"], ["44"]]);
  assert.match(await f.start(2), /已达到目标数量。新增 2\/2/);
  assert.deepEqual(f.pageCalls, [1, 2]);
  assert.deepEqual(f.detailCalls, ["11", "22"]);
  assert.equal(JSON.parse(f.files.get("cbg~9~22~role~22.json")).equip.game_ordersn, "22");
  assert.match(await f.start(5), /已到筛选末页。新增 2\/5/);
  assert.deepEqual(f.detailCalls, ["11", "22", "33", "44"]);
});

test("recognizes a relisted role, skips a removed listing and exhausts the results", async () => {
  const f = fixture([["100", "101"], ["102", "103"]], {
    "101": { status: 1, equip: { equip_desc: '{"role_id":"100"}' } },
    "102": { status: 0, msg: "商品已下架" }
  });
  assert.match(await f.start(9), /新增 2\/9，跳过重复 1、失效商品 1/);
  assert.equal(f.files.size, 2);
});

test("invalid details do not count, and a retry only downloads the missing account", async () => {
  const details = { "2": "<html>登录</html>" };
  const f = fixture([["1", "2"]], details);
  assert.match(await f.start(2), /已停止。本次已新增 1\/2/);
  delete details["2"];
  assert.match(await f.start(1), /已达到目标数量/);
  assert.deepEqual(f.detailCalls, ["1", "2", "2"]);
});

test("rejects service errors, missing data and a detail that belongs to another listing", async () => {
  for (const detail of [{ status: 2, msg: "请登录" }, { status: 1, equip: {} },
    { status: 1, equip: { game_ordersn: "other", equip_desc: { roleid: "12" } } }]) {
    const f = fixture([["1"]], { "1": detail });
    assert.match(await f.start(1), /已停止。本次已新增 0\/1/);
    assert.equal(f.files.size, 0);
  }
});

test("stops if the user changes the filter while a page is in flight", async () => {
  const f = fixture([["1"]]);
  const load = f.page.handleAjax;
  f.page.handleAjax = (...args) => {
    f.page.getSearchParams = () => ({ search_type: "role", full_ssr: 0 });
    return load(...args);
  };
  assert.match(await f.start(1), /筛选、排序或页面已改变/);
  assert.equal(f.detailCalls.length, 0);
});
