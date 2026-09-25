const storageKey = "wxyy-2-thin-section-index";
const collectorKey = "wxyy-2-collector";
const EXPORT_FORMAT = "thin-section-ledger";
const EXPORT_VERSION = 2;
// 归并时按更新时间决胜的“观察字段”
const OBSERVATION_FIELDS = ["location", "magnification", "polarization", "minerals", "texture"];

const state = JSON.parse(localStorage.getItem(storageKey) || '{"samples":[],"compare":[]}');

const form = document.querySelector("#sampleForm");
const photoInput = document.querySelector("#photoInput");
const sampleGrid = document.querySelector("#sampleGrid");
const comparePane = document.querySelector("#comparePane");
const mineralFilter = document.querySelector("#mineralFilter");
const polarFilter = document.querySelector("#polarFilter");
const noticeBox = document.querySelector("#notice");
const importBtn = document.querySelector("#importBtn");
const importInput = document.querySelector("#importInput");

let pendingPhoto = "";
let openCommentCardId = "";
let noticeTimer = 0;

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function notify(message, type = "ok") {
  noticeBox.textContent = message;
  noticeBox.className = `notice show ${type}`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    noticeBox.className = "notice";
  }, 5000);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

function fmtTime(iso) {
  if (!iso) return "时间未知";
  const time = new Date(iso);
  return Number.isNaN(time.getTime())
    ? "时间未知"
    : time.toLocaleString("zh-CN", { hour12: false });
}

/* ---------- 数据迁移与规范化 ---------- */

function migrateSample(raw) {
  const now = new Date().toISOString();
  const collector = (raw.collector || raw.recorder || "未登记采集人").toString().trim();
  const stamp = raw.updatedAt || raw.updated_at || raw.createdAt || now;

  let photos = Array.isArray(raw.photos) ? raw.photos.filter((p) => p && p.src) : [];
  if (!photos.length && raw.photo) {
    photos = [{ id: uid(), src: raw.photo, source: collector, createdAt: raw.createdAt || stamp }];
  }
  photos = photos.map((p) => ({
    id: p.id || uid(),
    src: p.src,
    source: (p.source || collector || "未知来源").toString(),
    createdAt: p.createdAt || stamp
  }));

  let comments = Array.isArray(raw.comments) ? raw.comments.filter((c) => c && c.text) : [];
  if (!comments.length && raw.comment) {
    comments = [{ id: uid(), text: raw.comment, source: collector, createdAt: raw.createdAt || stamp }];
  }
  comments = comments.map((c) => ({
    id: c.id || uid(),
    text: c.text,
    source: (c.source || collector || "未知来源").toString(),
    createdAt: c.createdAt || stamp
  }));

  const collectors = Array.isArray(raw.collectors) && raw.collectors.length
    ? Array.from(new Set(raw.collectors.map((c) => String(c).trim()).filter(Boolean)))
    : [collector];

  return {
    id: raw.id || uid(),
    code: String(raw.code || "").trim(),
    collector,
    collectors,
    location: raw.location || "",
    magnification: raw.magnification || "",
    polarization: raw.polarization || "单偏光",
    minerals: raw.minerals || "",
    texture: raw.texture || "",
    photos,
    comments,
    reviewed: Boolean(raw.reviewed),
    reviewedAt: raw.reviewedAt || null,
    createdAt: raw.createdAt || now,
    updatedAt: stamp
  };
}

state.samples = (state.samples || []).map(migrateSample);
// 未复核样本一律不得停留在对比栏
state.compare = (state.compare || []).filter((id) =>
  state.samples.some((sample) => sample.id === id && sample.reviewed)
);
save();

/* ---------- 筛选与渲染 ---------- */

function filteredSamples() {
  const mineral = mineralFilter.value.trim();
  const polarization = polarFilter.value;
  return state.samples.filter((sample) => {
    const mineralMatch = !mineral || (sample.minerals || "").includes(mineral);
    const polarMatch = !polarization || sample.polarization === polarization;
    return mineralMatch && polarMatch;
  });
}

function photoGallery(sample) {
  if (!sample.photos.length) return "<div class=\"photo-placeholder\"></div>";
  return `<div class="photo-gallery">${sample.photos.map((photo) => `
    <figure>
      <img src="${esc(photo.src)}" alt="${esc(sample.code)}显微照片">
      <figcaption>照片来源：${esc(photo.source)}</figcaption>
    </figure>`).join("")}</div>`;
}

function annotationList(sample) {
  if (!sample.comments.length) return "<p class=\"no-note\">未填写批注</p>";
  return `<ul class="annotations">${sample.comments.map((note) => `
    <li>
      <p>${esc(note.text)}</p>
      <span class="source-tag">批注来源：${esc(note.source)} · ${fmtTime(note.createdAt)}</span>
    </li>`).join("")}</ul>`;
}

function render() {
  const rows = filteredSamples();
  sampleGrid.innerHTML = rows.length ? rows.map((sample) => `
    <article class="sample-card ${sample.reviewed ? "is-reviewed" : "is-pending"}">
      <span class="status-badge ${sample.reviewed ? "ok" : "pending"}">
        ${sample.reviewed ? "已复核" : "未复核"}
      </span>
      ${photoGallery(sample)}
      <div class="sample-body">
        <h3>${esc(sample.code)}</h3>
        <p class="meta">采集人：${esc(sample.collectors.join("、"))} ｜ 观察更新：${fmtTime(sample.updatedAt)}</p>
        <p>${esc(sample.location || "未记录地点")} · ${esc(sample.magnification || "未记录倍数")} · ${esc(sample.polarization)}</p>
        <p>矿物：${esc(sample.minerals || "未记录")}</p>
        <p>结构：${esc(sample.texture || "未记录")}</p>
        ${annotationList(sample)}
        ${openCommentCardId === sample.id ? `
          <form class="inline-note" data-comment-form="${sample.id}">
            <textarea name="note" rows="2" required placeholder="追加一条老师批注"></textarea>
            <button type="submit">追加批注</button>
          </form>` : ""}
        <div class="card-actions">
          <label class="${sample.reviewed ? "" : "is-disabled"}" title="${sample.reviewed ? "" : "未复核样本复核通过后才能参与对比"}">
            <input type="checkbox" data-compare="${sample.id}"
              ${state.compare.includes(sample.id) ? "checked" : ""}
              ${sample.reviewed ? "" : "disabled"}>对比
          </label>
          <span class="action-group">
            <button type="button" class="btn-ghost" data-toggle-comment="${sample.id}">加批注</button>
            ${sample.reviewed
              ? `<button type="button" class="btn-ghost" data-unreview="${sample.id}">撤销复核</button>`
              : `<button type="button" class="btn-ok" data-review="${sample.id}">复核通过</button>`}
            <button type="button" class="btn-ghost" data-delete="${sample.id}">删除</button>
          </span>
        </div>
      </div>
    </article>
  `).join("") : "<p>还没有样本，先从左侧录入一张薄片照片。</p>";

  const compareSamples = state.compare
    .map((id) => state.samples.find((sample) => sample.id === id))
    .filter((sample) => sample && sample.reviewed)
    .slice(0, 2);

  comparePane.innerHTML = compareSamples.length ? compareSamples.map((sample) => `
    <article class="compare-item">
      ${sample.photos[0] ? `<img src="${esc(sample.photos[0].src)}" alt="${esc(sample.code)}对比图">` : ""}
      <h3>${esc(sample.code)}</h3>
      <p class="meta">${esc(sample.polarization)} · ${esc(sample.minerals || "未记录矿物")}</p>
      <p>${esc(sample.texture || "未记录结构")}</p>
    </article>
  `).join("") : "<p>勾选两张「已复核」样本卡片后可并排对比。</p>";
}

/* ---------- 录入 ---------- */

const collectorInput = form.elements.collector;
collectorInput.value = localStorage.getItem(collectorKey) || "";

photoInput.addEventListener("change", async () => {
  pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const collector = data.get("collector").trim();
  if (!pendingPhoto && photoInput.files[0]) {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  }
  const now = new Date().toISOString();
  const comment = data.get("comment").trim();
  state.samples.unshift(migrateSample({
    photo: pendingPhoto,
    code: data.get("code").trim(),
    location: data.get("location").trim(),
    magnification: data.get("magnification").trim(),
    polarization: data.get("polarization"),
    minerals: data.get("minerals").trim(),
    texture: data.get("texture").trim(),
    collector,
    comment,
    reviewed: false,
    createdAt: now,
    updatedAt: now
  }));
  localStorage.setItem(collectorKey, collector);
  pendingPhoto = "";
  photoInput.value = "";
  form.reset();
  collectorInput.value = collector;
  save();
  render();
  notify(`样本已保存为「未复核」，请老师复核后再参与对比或导出。`);
});

/* ---------- 卡片操作：复核 / 批注 / 删除 / 对比 ---------- */

sampleGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const { delete: deleteId, review: reviewId, unreview: unreviewId, toggleComment: toggleId } = button.dataset;

  if (deleteId) {
    state.samples = state.samples.filter((sample) => sample.id !== deleteId);
    state.compare = state.compare.filter((id) => id !== deleteId);
    save();
    render();
    return;
  }

  if (reviewId) {
    const sample = state.samples.find((item) => item.id === reviewId);
    if (!sample || sample.reviewed) return;
    sample.reviewed = true;
    sample.reviewedAt = new Date().toISOString();
    save();
    render();
    notify(`「${sample.code}」复核通过，已放行，可参与对比和导出。`);
    return;
  }

  if (unreviewId) {
    const sample = state.samples.find((item) => item.id === unreviewId);
    if (!sample) return;
    sample.reviewed = false;
    sample.reviewedAt = null;
    state.compare = state.compare.filter((id) => id !== sample.id);
    save();
    render();
    notify(`「${sample.code}」已改回未复核，对比与导出已重新拦截。`, "warn");
    return;
  }

  if (toggleId) {
    openCommentCardId = openCommentCardId === toggleId ? "" : toggleId;
    render();
  }
});

sampleGrid.addEventListener("submit", (event) => {
  const formEl = event.target.closest("[data-comment-form]");
  if (!formEl) return;
  event.preventDefault();
  const id = formEl.dataset.commentForm;
  const sample = state.samples.find((item) => item.id === id);
  if (!sample) return;
  const text = formEl.elements.note.value.trim();
  if (!text) return;
  const source = (localStorage.getItem(collectorKey) || "本机老师").trim();
  sample.comments.push({ id: uid(), text, source, createdAt: new Date().toISOString() });
  if (!sample.collectors.includes(source)) sample.collectors.push(source);
  openCommentCardId = "";
  save();
  render();
});

sampleGrid.addEventListener("change", (event) => {
  const id = event.target.dataset.compare;
  if (!id) return;
  const sample = state.samples.find((item) => item.id === id);
  if (!sample || !sample.reviewed) {
    event.target.checked = false;
    return;
  }
  if (event.target.checked) {
    state.compare = [id, ...state.compare.filter((item) => item !== id)].slice(0, 2);
  } else {
    state.compare = state.compare.filter((item) => item !== id);
  }
  save();
  render();
});

[mineralFilter, polarFilter].forEach((field) => field.addEventListener("input", render));

/* ---------- 导出：只导出已复核，携带采集人/复核状态/更新时间 ---------- */

document.querySelector("#exportBtn").addEventListener("click", () => {
  const reviewed = state.samples.filter((sample) => sample.reviewed);
  const pendingCount = state.samples.length - reviewed.length;
  if (!reviewed.length) {
    notify("没有可导出的「已复核」样本；未复核样本需复核通过后才能导出。", "warn");
    return;
  }
  const payload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    exporter: (localStorage.getItem(collectorKey) || "").trim(),
    samples: reviewed.map((sample) => ({
      id: sample.id,
      code: sample.code,
      collector: sample.collector,
      collectors: sample.collectors,
      location: sample.location,
      magnification: sample.magnification,
      polarization: sample.polarization,
      minerals: sample.minerals,
      texture: sample.texture,
      photos: sample.photos,
      comments: sample.comments,
      reviewed: sample.reviewed,
      reviewedAt: sample.reviewedAt,
      createdAt: sample.createdAt,
      updatedAt: sample.updatedAt
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.download = `thin-section-ledger-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  notify(`已导出 ${reviewed.length} 条已复核样本${pendingCount ? `，${pendingCount} 条未复核已自动跳过` : ""}。`);
});

/* ---------- 导入：按样本编号归并 ---------- */

function fromLegacyRow(row) {
  const reviewedText = String(row["复核状态"] ?? "").trim();
  const stamp = row["更新时间"] ? new Date(row["更新时间"]).toISOString() : null;
  return migrateSample({
    code: row["样本编号"],
    location: row["采样地点"],
    magnification: row["放大倍数"],
    polarization: row["偏光类型"],
    minerals: row["主要矿物"],
    texture: row["颗粒结构"],
    comment: row["老师批注"],
    collector: row["采集人"] || "外来清单",
    reviewed: ["已复核", "是", "true", "1"].includes(reviewedText),
    updatedAt: Number.isNaN(Date.parse(stamp)) ? null : stamp
  });
}

function normalizeImported(raw) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && Array.isArray(raw.samples)) {
    list = raw.samples;
  } else {
    throw new Error("文件里没有台账数据");
  }
  return list.map((row) => {
    if (!row || typeof row !== "object") return null;
    if ("样本编号" in row) return fromLegacyRow(row);
    const sample = migrateSample(row);
    return sample.code ? sample : null;
  });
}

function mergeEntries(a = [], b = [], sameKey) {
  const seen = new Map();
  const merged = [];
  for (const item of [...a, ...b]) {
    if (!item) continue;
    const key = sameKey(item);
    if (key && seen.has(key)) continue;
    seen.set(key, true);
    merged.push(item);
  }
  return merged;
}

function mergeSample(existing, incoming) {
  if (!existing) return incoming;

  const incomingNewer =
    new Date(incoming.updatedAt || 0).getTime() >= new Date(existing.updatedAt || 0).getTime();
  const winner = incomingNewer ? incoming : existing;
  const older = incomingNewer ? existing : incoming;

  const merged = { ...existing };
  OBSERVATION_FIELDS.forEach((field) => {
    // 更新时间较晚的一份为准；其字段留空时回退到另一份，避免丢数据
    merged[field] = winner[field] || older[field] || "";
  });
  merged.updatedAt = winner.updatedAt;
  // 观察内容以最新一份为准，复核状态跟随最新一份：新改动到达需重新复核
  merged.reviewed = winner.reviewed;
  merged.reviewedAt = winner.reviewedAt || null;
  merged.createdAt =
    new Date(existing.createdAt || 0) <= new Date(incoming.createdAt || 0)
      ? existing.createdAt
      : incoming.createdAt;
  merged.collectors = Array.from(
    new Set([...(existing.collectors || []), ...(incoming.collectors || [])].filter(Boolean))
  );
  merged.photos = mergeEntries(existing.photos, incoming.photos, (photo) => photo.id || photo.src)
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  merged.comments = mergeEntries(existing.comments, incoming.comments, (note) =>
    note.id || `${note.source} ${note.text}`
  ).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  return merged;
}

async function handleImport(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    notify("导入失败：文件不是有效的 JSON 台账文件。", "error");
    return;
  }

  let incoming;
  try {
    incoming = normalizeImported(parsed).filter(Boolean);
  } catch (error) {
    notify(`导入失败：${error.message}。`, "error");
    return;
  }
  if (!incoming.length) {
    notify("导入失败：文件中没有可识别的样本记录。", "error");
    return;
  }

  let added = 0;
  let mergedCount = 0;
  for (const item of incoming) {
    const index = state.samples.findIndex(
      (sample) => sample.code.trim() === item.code.trim()
    );
    if (index === -1) {
      state.samples.unshift(item);
      added += 1;
    } else {
      const beforeReviewed = state.samples[index].reviewed;
      state.samples[index] = mergeSample(state.samples[index], item);
      if (beforeReviewed && !state.samples[index].reviewed) {
        state.compare = state.compare.filter((id) => id !== state.samples[index].id);
      }
      mergedCount += 1;
    }
  }
  save();
  render();
  const pendingNow = state.samples.filter((sample) => !sample.reviewed).length;
  notify(
    `导入完成：新增 ${added} 条、按样本编号归并 ${mergedCount} 条；` +
      `照片与双方批注已合并并标明来源。当前共 ${pendingNow} 条未复核，需复核后才能对比或导出。`
  );
}

importBtn.addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  if (file) await handleImport(file);
  importInput.value = "";
});

render();
