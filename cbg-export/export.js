(() => {
  "use strict";

  const panelId = "cbg-filter-json-export";
  const existing = document.getElementById(panelId);
  if (existing) {
    existing.scrollIntoView({ block: "nearest" });
    return;
  }

  function findListPage() {
    // Vue 2 keeps a reference to the mounted component on its root element.
    for (const element of document.querySelectorAll("body *")) {
      let vm = element.__vue__;
      while (vm && !vm._inactive) {
        if (vm.$route?.name === "productList" && vm.$refs?.roleList &&
            typeof vm.getSearchParams === "function" && typeof vm.handleAjax === "function") {
          return vm;
        }
        vm = vm.$parent;
      }
    }
    throw new Error("未找到角色列表。请确认商品已显示；如页面已改版，需要更新扩展。");
  }

  function detailLink(page, item) {
    const server = String(item.serverid ?? item.server_id ?? "");
    const order = String(item.game_ordersn || item.ordersn || item.equip_sn || "");
    if (!/^\d+$/.test(server) || !/^[\w-]+$/.test(order)) {
      throw new Error("列表项缺少有效的服务器 ID 或商品编号，无法确认详情链接。");
    }
    const route = page.$router.resolve({ name: "productDetail", params: { serverId: server, ordersn: order } });
    const url = new URL(route.href, location.href);
    if (url.origin !== location.origin || url.pathname !== `/cgi/mweb/equip/${server}/${order}`) {
      throw new Error("详情链接与商品编号不匹配，请检查网站路由是否有变化。");
    }
    return { server, order, url: url.href, key: server + "~" + order };
  }

  function readPage(page, number, signal) {
    // handleAjax merges the page's current getSearchParams(number) and selects
    // the same search API as the site's scroll handler, without moving the UI.
    signal.throwIfAborted();
    const request = page.handleAjax({}, number);
    return new Promise((resolve, reject) => {
      function cancel() {
        reject(signal.reason);
        request.abort?.();
      }
      signal.addEventListener("abort", cancel, { once: true });
      Promise.resolve(request).then(resolve, () => reject(new Error("列表请求失败，请检查登录状态或稍后重试。")))
        .finally(() => signal.removeEventListener("abort", cancel));
    });
  }

  function assertResponse(data, label) {
    if (!data || typeof data !== "object" || (data.status != null && Number(data.status) !== 1)) {
      const reason = data?.msg || data?.errmsg || data?.error_msg;
      throw new Error(label + "未成功" + (typeof reason === "string" ? "：" + reason.slice(0, 160) : "，请查看藏宝阁页面。"));
    }
  }

  async function readDetail(link, signal) {
    const response = await fetch("/cgi/api/get_equip_detail?client_type=h5", {
      method: "POST",
      credentials: "same-origin",
      referrer: link.url,
      body: new URLSearchParams({ serverid: link.server, ordersn: link.order }),
      signal
    });
    if (!response.ok) throw new Error("详情请求返回 HTTP " + response.status);
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error("详情没有返回 JSON，请检查登录或验证提示。"); }
    if (Number(data?.status) !== 1 && /(?:商品|物品|角色|装备).{0,8}(?:已下架|已售出|不存在)/.test(data?.msg ?? "")) {
      return null;
    }
    assertResponse(data, "详情请求");
    const equip = data.equip ?? data.equip_data;
    const desc = equip?.equip_desc;
    if (!desc || (typeof desc !== "object" && typeof desc !== "string") ||
        (typeof desc === "string" ? !desc.trim() : !Object.keys(desc).length)) {
      throw new Error("详情缺少账号描述 equip_desc，未保存。");
    }
    const returnedOrder = equip.game_ordersn || equip.equip_sn;
    if ((returnedOrder && String(returnedOrder) !== link.order) ||
        (equip.serverid != null && String(equip.serverid) !== link.server)) {
      throw new Error("详情返回的账号与列表不一致，未保存。");
    }
    let role = desc;
    if (typeof desc === "string") {
      try { role = JSON.parse(desc); } catch { role = null; }
    }
    // Never use seller/user IDs, nicknames or rounded numeric IDs as role keys.
    const roleId = [role?.roleid, role?.role_id, equip.roleid, equip.role_id]
      .find(id => (typeof id === "string" || Number.isSafeInteger(id)) && /^[1-9]\d*$/.test(String(id)));
    return { raw, roleId: roleId == null ? null : String(roleId) };
  }

  async function savedKeys(directory, signal) {
    const listings = new Set(), roles = new Set();
    for await (const handle of directory.values()) {
      signal.throwIfAborted();
      const match = /^cbg~(\d+)~([\w-]+)(?:~role~(\d+))?\.json$/.exec(handle.name);
      if (!match || handle.kind !== "file" || !(await handle.getFile()).size) continue;
      listings.add(match[1] + "~" + match[2]);
      if (match[3]) roles.add(match[1] + "~" + match[3]);
    }
    return { listings, roles };
  }

  async function save(directory, link, detail, signal) {
    const suffix = detail.roleId ? "~role~" + detail.roleId : "";
    const handle = await directory.getFileHandle("cbg~" + link.key + suffix + ".json", { create: true });
    const writer = await handle.createWritable();
    try {
      signal.throwIfAborted();
      await writer.write(detail.raw);
      signal.throwIfAborted();
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
  }

  async function run(page, directory, target, signal, progress) {
    const context = () => JSON.stringify([location.href, page.getSearchParams(1)]);
    const start = context();
    function check() {
      signal.throwIfAborted();
      if (page._inactive || !page.$el.isConnected || context() !== start) {
        throw new Error("筛选、排序或页面已改变，请从当前筛选重新开始。");
      }
    }
    const seen = await savedKeys(directory, signal);
    const pages = new Set();
    let count = 0, duplicates = 0, unavailable = 0;
    for (let number = 1; ; number++) {
      check();
      progress({ number, count, duplicates, message: "正在读取筛选结果…" });
      const timed = () => AbortSignal.any([signal, AbortSignal.timeout(45000)]);
      const data = await readPage(page, number, timed());
      check();
      assertResponse(data, "列表请求");
      const items = data.result ?? data.equip_list;
      if (!Array.isArray(items)) throw new Error("列表响应中没有商品数组，请检查登录状态或页面版本。");
      const links = items.map(item => detailLink(page, item));
      const flag = data.paging?.is_last_page ?? data.is_last_page;
      const total = Number(data.paging?.total_pages ?? data.pager?.total_pages);
      const last = [true, 1, "1"].includes(flag) || (total > 0 && number >= total);
      if (!links.length) {
        if ([false, 0, "0"].includes(flag) && total > number) throw new Error("这一页为空，但网易仍标有后续页，请稍后重试。");
        return { count, duplicates, unavailable, end: true };
      }
      const signature = JSON.stringify(links.map(link => link.key));
      if (!last && !(total >= number) && pages.has(signature)) throw new Error("网易重复返回同一页，已停止，尚未确认到达末页。");
      pages.add(signature);
      for (const link of links) {
        check();
        if (seen.listings.has(link.key)) { duplicates++; continue; }
        progress({ number, count, duplicates, link, message: "正在读取商品详情…" });
        const detail = await readDetail(link, timed());
        check();
        if (!detail) {
          seen.listings.add(link.key);
          unavailable++;
          continue;
        }
        const role = detail.roleId && link.server + "~" + detail.roleId;
        if (role && seen.roles.has(role)) {
          seen.listings.add(link.key);
          duplicates++;
          continue;
        }
        await save(directory, link, detail, signal);
        seen.listings.add(link.key);
        if (role) seen.roles.add(role);
        count++;
        progress({ number, count, duplicates, link, message: "已写入 JSON" });
        if (count === target) return { count, duplicates, unavailable, end: false };
      }
      if (last) return { count, duplicates, unavailable, end: true };
    }
  }

  const host = document.createElement("div");
  host.id = panelId;
  host.style.cssText = "position:fixed;bottom:20px;right:16px;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    section{box-sizing:border-box;width:min(330px,92vw);padding:16px;background:#fff;color:#20252a;border:1px solid #aebbc6;border-radius:10px;box-shadow:0 4px 20px #0002;font:14px/1.5 system-ui,sans-serif}
    header,footer,label{display:flex;align-items:center;gap:8px} header{justify-content:space-between;font-size:16px}
    label{margin:12px 0}input{width:85px;padding:3px}button{cursor:pointer;padding:4px 10px}button:disabled{cursor:default}
    p{margin:8px 0 0;overflow-wrap:anywhere} a{display:block;color:#075f92;overflow-wrap:anywhere}
  </style><section><header><strong>导出筛选结果</strong><button id="close">关闭</button></header>
    <label>本次新增账号数 <input id="count" type="number" min="1" step="1" value="10"></label>
    <footer><button id="start">选择目录并开始</button><button id="stop" disabled>停止</button></footer>
    <p id="state" role="status"></p><a id="link" target="_blank" rel="noopener noreferrer"></a></section>`;
  document.body.append(host);
  const ui = id => root.getElementById(id);
  let controller;
  ui("close").onclick = () => host.remove();
  ui("stop").onclick = () => controller?.abort();
  ui("start").onclick = async () => {
    const target = ui("count").valueAsNumber;
    if (!Number.isSafeInteger(target) || target < 1) { ui("state").textContent = "请输入正整数。"; return; }
    controller = new AbortController();
    const signal = controller.signal;
    ui("start").disabled = ui("count").disabled = ui("close").disabled = true;
    ui("stop").disabled = false;
    let count = 0;
    ui("link").removeAttribute("href");
    ui("link").textContent = "";
    try {
      const page = findListPage();
      const type = page.getSearchParams(1).search_type;
      if (type && type !== "role") throw new Error("请先打开角色筛选结果。");
      const directory = await window.showDirectoryPicker({ mode: "readwrite", id: "cbg-role-exports" });
      await navigator.locks.request("cbg-filter-json-export", { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("另一个藏宝阁标签正在导出。");
        const result = await run(page, directory, target, signal, status => {
          count = status.count;
          ui("state").textContent = `第 ${status.number} 页 · 已新增 ${count}/${target} · 重复 ${status.duplicates}。 ${status.message}`;
          if (status.link) {
            ui("link").href = status.link.url;
            ui("link").textContent = status.link.url;
          }
        });
        ui("state").textContent = (result.end ? "已到筛选末页" : "已达到目标数量") +
          `。新增 ${result.count}/${target}，跳过重复 ${result.duplicates}、失效商品 ${result.unavailable}。`;
      });
    } catch (error) {
      const reason = error.name === "AbortError" ? "已取消" : error.message || String(error);
      ui("state").textContent = `已停止。本次已新增 ${count}/${target}。 ${reason}`;
    } finally {
      controller = null;
      ui("start").disabled = ui("count").disabled = ui("close").disabled = false;
      ui("stop").disabled = true;
    }
  };
})();
