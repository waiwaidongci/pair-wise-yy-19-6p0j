const storageKey = "wxyy-2-thin-section-index";
const collectorKey = "wxyy-2-thin-section-collector";
const state = JSON.parse(localStorage.getItem(storageKey) || '{"samples":[],"compare":[]}');

const form = document.querySelector("#sampleForm");
const photoInput = document.querySelector("#photoInput");
const sampleGrid = document.querySelector("#sampleGrid");
const comparePane = document.querySelector("#comparePane");
const mineralFilter = document.querySelector("#mineralFilter");
const polarFilter = document.querySelector("#polarFilter");
const importInput = document.querySelector("#importInput");
const ioStatus = document.querySelector("#ioStatus");
const exportBtn = document.querySelector("#exportBtn");

let pendingPhoto = "";

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function setStatus(message) {
  ioStatus.textContent = message;
}

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN", { hour12: false });
}

// 兼容旧数据：单张照片/单条批注升级为带来源的列表，并补齐复核与更新时间字段
function normalizeSample(sample) {
  const collector = sample.collector || "";
  const photos = Array.isArray(sample.photos)
    ? sample.photos
    : (sample.photo ? [{ src: sample.photo, source: collector || "本机" }] : []);
  const comments = Array.isArray(sample.comments)
    ? sample.comments
    : (sample.comment ? [{ text: sample.comment, source: collector || "本机" }] : []);
  return {
    ...sample,
    collector,
    reviewed: Boolean(sample.reviewed),
    photos,
    comments,
    updatedAt: sample.updatedAt || sample.createdAt || new Date().toISOString()
  };
}

state.samples = state.samples.map(normalizeSample);
state.compare = state.compare.filter((id) => {
  const sample = state.samples.find((item) => item.id === id);
  return sample && sample.reviewed;
});
save();

function dedupePhotos(photos) {
  const seen = new Set();
  return photos.filter((photo) => {
    if (!photo.src || seen.has(photo.src)) return false;
    seen.add(photo.src);
    return true;
  });
}

function dedupeComments(comments) {
  const seen = new Set();
  return comments.filter((comment) => {
    const key = `${comment.source}::${comment.text}`;
    if (!comment.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 观察字段、采集人、复核状态以更新时间较晚的一份为准；双方照片和批注全部保留
function mergeSamples(existing, incoming) {
  const [newer, older] = incoming.updatedAt > existing.updatedAt
    ? [incoming, existing]
    : [existing, incoming];
  return {
    ...newer,
    id: existing.id,
    photos: dedupePhotos([...older.photos, ...newer.photos]),
    comments: dedupeComments([...older.comments, ...newer.comments]),
    createdAt: older.createdAt < newer.createdAt ? older.createdAt : newer.createdAt
  };
}

function upsertSample(incoming) {
  const index = state.samples.findIndex((sample) => sample.code === incoming.code);
  if (index === -1) {
    state.samples.unshift(incoming);
    return "added";
  }
  state.samples[index] = mergeSamples(state.samples[index], incoming);
  return "merged";
}

// 兼容两种文件：新版台账（中文键、含照片/批注列表）和旧版观察清单
function normalizeImported(record) {
  const collector = record.collector || record["采集人"] || "";
  const updatedAt = record.updatedAt || record["更新时间"] || new Date().toISOString();
  const reviewed = typeof record.reviewed === "boolean" ? record.reviewed : record["复核状态"] === "已复核";

  const rawPhotos = Array.isArray(record.photos) ? record.photos
    : Array.isArray(record["照片"]) ? record["照片"].map((item) => ({ src: item["数据"] || item.src || "", source: item["来源"] || item.source || "" }))
    : record.photo ? [{ src: record.photo, source: "" }]
    : [];
  const photos = rawPhotos
    .map((photo) => ({ src: photo.src, source: photo.source || collector || "导入文件" }))
    .filter((photo) => photo.src);

  const legacyComment = record.comment || record["老师批注"] || "";
  const rawComments = Array.isArray(record.comments) ? record.comments
    : Array.isArray(record["批注"]) ? record["批注"].map((item) => ({ text: item["内容"] || item.text || "", source: item["来源"] || item.source || "" }))
    : legacyComment ? [{ text: legacyComment, source: "" }]
    : [];
  const comments = rawComments
    .map((comment) => ({ text: comment.text, source: comment.source || collector || "导入文件" }))
    .filter((comment) => comment.text);

  return {
    id: crypto.randomUUID(),
    code: String(record.code || record["样本编号"] || "").trim(),
    location: record.location ?? record["采样地点"] ?? "",
    magnification: record.magnification ?? record["放大倍数"] ?? "",
    polarization: record.polarization || record["偏光类型"] || "单偏光",
    minerals: record.minerals ?? record["主要矿物"] ?? "",
    texture: record.texture ?? record["颗粒结构"] ?? "",
    collector,
    reviewed,
    photos,
    comments,
    createdAt: record.createdAt || updatedAt,
    updatedAt
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

function filteredSamples() {
  const mineral = mineralFilter.value.trim();
  const polarization = polarFilter.value;
  return state.samples.filter((sample) => {
    const mineralMatch = !mineral || sample.minerals.includes(mineral);
    const polarMatch = !polarization || sample.polarization === polarization;
    return mineralMatch && polarMatch;
  });
}

function render() {
  const rows = filteredSamples();
  sampleGrid.innerHTML = rows.length ? rows.map((sample) => {
    const photoSources = [...new Set(sample.photos.map((photo) => photo.source))];
    return `
    <article class="sample-card ${sample.reviewed ? "" : "is-pending"}">
      ${sample.photos.length ? `<img src="${sample.photos[0].src}" alt="${sample.code}显微照片">` : "<div class=\"photo-placeholder\"></div>"}
      <div class="sample-body">
        <div class="card-head">
          <h3>${sample.code}</h3>
          <span class="review-badge ${sample.reviewed ? "is-reviewed" : ""}">${sample.reviewed ? "已复核" : "未复核"}</span>
        </div>
        <p>${sample.location || "未记录地点"} · ${sample.magnification || "未记录倍数"} · ${sample.polarization}</p>
        <p>矿物：${sample.minerals || "未记录"}</p>
        <p>结构：${sample.texture || "未记录"}</p>
        <p>采集人：${sample.collector || "未记录"} · 更新：${formatTime(sample.updatedAt)}</p>
        ${sample.photos.length ? `<p>照片 ${sample.photos.length} 张（来源：${photoSources.join("、")}）</p>` : ""}
        ${sample.comments.length
          ? sample.comments.map((comment) => `<p class="comment"><span class="comment-source">${comment.source}：</span>${comment.text}</p>`).join("")
          : "<p>未填写批注</p>"}
        <div class="card-actions">
          <label title="${sample.reviewed ? "" : "未复核样本不能参与并排对比"}"><input type="checkbox" data-compare="${sample.id}" ${sample.reviewed ? "" : "disabled"} ${state.compare.includes(sample.id) ? "checked" : ""}>对比</label>
          <button type="button" data-review="${sample.id}">${sample.reviewed ? "取消复核" : "标记复核"}</button>
          <button type="button" data-delete="${sample.id}">删除</button>
        </div>
      </div>
    </article>`;
  }).join("") : "<p>还没有样本，先从左侧录入一张薄片照片。</p>";

  const compareSamples = state.compare
    .map((id) => state.samples.find((sample) => sample.id === id))
    .filter((sample) => sample && sample.reviewed)
    .slice(0, 2);

  comparePane.innerHTML = compareSamples.length ? compareSamples.map((sample) => `
    <article class="compare-item">
      ${sample.photos.length ? `<img src="${sample.photos[0].src}" alt="${sample.code}对比图">` : ""}
      <h3>${sample.code}</h3>
      <p>${sample.polarization} · ${sample.minerals || "未记录矿物"}</p>
      <p>${sample.texture || "未记录结构"}</p>
      <p>采集人：${sample.collector || "未记录"}</p>
    </article>
  `).join("") : "<p>勾选两张已复核样本卡片后可并排对比。</p>";
}

photoInput.addEventListener("change", async () => {
  pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  if (!pendingPhoto && photoInput.files[0]) {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  }
  const collector = data.get("collector").trim();
  const comment = data.get("comment").trim();
  const now = new Date().toISOString();
  const incoming = {
    id: crypto.randomUUID(),
    code: data.get("code").trim(),
    location: data.get("location").trim(),
    magnification: data.get("magnification").trim(),
    polarization: data.get("polarization"),
    minerals: data.get("minerals").trim(),
    texture: data.get("texture").trim(),
    collector,
    reviewed: false,
    photos: pendingPhoto ? [{ src: pendingPhoto, source: collector || "本机" }] : [],
    comments: comment ? [{ text: comment, source: collector || "本机" }] : [],
    createdAt: now,
    updatedAt: now
  };
  const result = upsertSample(incoming);
  localStorage.setItem(collectorKey, collector);
  pendingPhoto = "";
  photoInput.value = "";
  form.reset();
  form.elements.collector.value = collector;
  save();
  render();
  setStatus(result === "merged"
    ? `样本编号 ${incoming.code} 已存在，已按更新时间归并，待复核。`
    : `已保存样本 ${incoming.code}，待复核。`);
});

sampleGrid.addEventListener("click", (event) => {
  const deleteId = event.target.dataset.delete;
  if (deleteId) {
    state.samples = state.samples.filter((sample) => sample.id !== deleteId);
    state.compare = state.compare.filter((id) => id !== deleteId);
    save();
    render();
    return;
  }
  const reviewId = event.target.dataset.review;
  if (reviewId) {
    const sample = state.samples.find((item) => item.id === reviewId);
    if (!sample) return;
    sample.reviewed = !sample.reviewed;
    if (!sample.reviewed) {
      state.compare = state.compare.filter((id) => id !== reviewId);
    }
    save();
    render();
    setStatus(sample.reviewed
      ? `样本 ${sample.code} 已复核，可参与并排对比与导出。`
      : `样本 ${sample.code} 已标记为未复核，暂停对比与导出。`);
  }
});

sampleGrid.addEventListener("change", (event) => {
  const id = event.target.dataset.compare;
  if (!id) return;
  const sample = state.samples.find((item) => item.id === id);
  if (event.target.checked && (!sample || !sample.reviewed)) {
    event.target.checked = false;
    setStatus("未复核样本不能参与并排对比，请先复核。");
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

importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  importInput.value = "";
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    setStatus("导入失败：文件不是有效的 JSON。");
    return;
  }
  const records = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed["样本"]) ? parsed["样本"]
    : Array.isArray(parsed.samples) ? parsed.samples
    : null;
  if (!records) {
    setStatus("导入失败：文件中没有可识别的样本列表。");
    return;
  }
  let added = 0;
  let merged = 0;
  let skipped = 0;
  records.forEach((record) => {
    const incoming = normalizeImported(record);
    if (!incoming.code) {
      skipped += 1;
      return;
    }
    if (upsertSample(incoming) === "added") added += 1;
    else merged += 1;
  });
  save();
  render();
  setStatus(`导入完成：新增 ${added} 条，按样本编号归并 ${merged} 条${skipped ? `，跳过 ${skipped} 条无编号记录` : ""}。`);
});

exportBtn.addEventListener("click", () => {
  const reviewedSamples = state.samples.filter((sample) => sample.reviewed);
  const pendingCount = state.samples.length - reviewedSamples.length;
  if (!reviewedSamples.length) {
    setStatus("没有已复核样本可导出，请先完成复核。");
    return;
  }
  const payload = {
    台账格式: "thin-section-ledger/v1",
    导出时间: new Date().toISOString(),
    样本: reviewedSamples.map((sample) => ({
      样本编号: sample.code,
      采样地点: sample.location,
      放大倍数: sample.magnification,
      偏光类型: sample.polarization,
      主要矿物: sample.minerals,
      颗粒结构: sample.texture,
      采集人: sample.collector,
      复核状态: sample.reviewed ? "已复核" : "未复核",
      更新时间: sample.updatedAt,
      照片: sample.photos.map((photo) => ({ 数据: photo.src, 来源: photo.source })),
      批注: sample.comments.map((comment) => ({ 内容: comment.text, 来源: comment.source }))
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `thin-section-ledger-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  setStatus(`已导出 ${reviewedSamples.length} 条已复核样本${pendingCount ? `，${pendingCount} 条未复核样本未导出` : ""}。`);
});

form.elements.collector.value = localStorage.getItem(collectorKey) || "";
render();
