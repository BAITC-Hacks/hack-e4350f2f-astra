"use strict";

const INITIAL_DISTRICTS = [
  {
    id: "esil",
    name: "Есиль",
    accent: "#67e8f9",
    indicators: { transport: 72, ecology: 61, schools: 78, utilities: 68 },
  },
  {
    id: "almaty",
    name: "Алматы",
    accent: "#a78bfa",
    indicators: { transport: 54, ecology: 66, schools: 71, utilities: 59 },
  },
  {
    id: "saryarka",
    name: "Сарыарка",
    accent: "#fbbf24",
    indicators: { transport: 48, ecology: 52, schools: 64, utilities: 73 },
  },
  {
    id: "baikonur",
    name: "Байконур",
    accent: "#fb7185",
    indicators: { transport: 63, ecology: 46, schools: 57, utilities: 49 },
  },
  {
    id: "nura",
    name: "Нура",
    accent: "#4ade80",
    indicators: { transport: 31, ecology: 27, schools: 58, utilities: 44 },
  },
];

const MEASURES = [
  { id: "M-01", name: "Умные светофоры на ключевых перекрёстках", category: "Транспорт", cost: 24, scope: "Город" },
  { id: "M-02", name: "Выделенные полосы для общественного транспорта", category: "Транспорт", cost: 18, scope: "Город" },
  { id: "M-03", name: "Ночная велосеть и безопасные парковки", category: "Транспорт", cost: 12, scope: "Район" },
  { id: "M-04", name: "Датчики качества воздуха", category: "Экология", cost: 16, scope: "Район" },
  { id: "M-05", name: "Зелёный каркас вдоль магистралей", category: "Экология", cost: 21, scope: "Город" },
  { id: "M-06", name: "Мобильные пункты сортировки отходов", category: "Экология", cost: 11, scope: "Район" },
  { id: "M-07", name: "Быстрый ремонт школьных спортзалов", category: "Соцсфера", cost: 19, scope: "Район" },
  { id: "M-08", name: "Гранты на кружки STEM", category: "Соцсфера", cost: 14, scope: "Город" },
  { id: "M-09", name: "Тревожные кнопки во дворах", category: "Безопасность", cost: 17, scope: "Район" },
  { id: "M-10", name: "Камеры на маршрутах школьников", category: "Безопасность", cost: 22, scope: "Район" },
  { id: "M-11", name: "Единая карта обращений жителей", category: "Сервисы", cost: 9, scope: "Город" },
  { id: "M-12", name: "Открытый дашборд коммунальных аварий", category: "Сервисы", cost: 8, scope: "Город" },
  { id: "M-13", name: "Муниципальный центр телемедицины", category: "Сервисы", cost: 26, scope: "Район" },
  { id: "M-14", name: "Микрогранты для дворовых инициатив", category: "Соцсфера", cost: 13, scope: "Район" },
];

const CATEGORIES = ["Все", "Транспорт", "Экология", "Соцсфера", "Безопасность", "Сервисы"];
const INDICATORS = [
  ["transport", "Транспорт"],
  ["ecology", "Экология"],
  ["schools", "Школы"],
  ["utilities", "ЖКХ"],
];

const EFFECTS = {
  "M-01": { transport: 5 }, "M-02": { transport: 4, ecology: 2 },
  "M-03": { transport: 9, ecology: 4 }, "M-04": { ecology: 7 },
  "M-05": { ecology: 5 }, "M-06": { ecology: 10, utilities: 3 },
  "M-07": { schools: 12 }, "M-08": { schools: 4 },
  "M-09": { utilities: 6 }, "M-10": { transport: 3, schools: 6 },
  "M-11": { utilities: 3 }, "M-12": { utilities: 4 },
  "M-13": { utilities: 9 }, "M-14": { schools: 4, utilities: 7 },
};
function simulateDistricts(selected) {
  return INITIAL_DISTRICTS.map((district) => {
    const indicators = { ...district.indicators };
    selected.forEach((measure) => {
      if (measure.scope === "Район" && measure.district !== district.id) return;
      Object.entries(EFFECTS[measure.id] || {}).forEach(([key, delta]) => {
        indicators[key] = Math.min(100, indicators[key] + delta);
      });
    });
    return { ...district, indicators };
  });
}

const categoryClasses = {
  Транспорт: "transport", Экология: "ecology", Соцсфера: "social",
  Безопасность: "safety", Сервисы: "services",
};
const state = { category: "Все", selected: new Set(), targets: {}, simulated: false };
const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function getSelected() {
  return MEASURES.filter((measure) => state.selected.has(measure.id)).map((measure) => ({
    ...measure, district: measure.scope === "Район" ? state.targets[measure.id] || "nura" : null,
  }));
}

function renderFilters() {
  $("filters").innerHTML = CATEGORIES.map((category) => `<button type="button" class="filter ${state.category === category ? "active" : ""}" data-category="${escapeHTML(category)}" aria-pressed="${state.category === category}">${escapeHTML(category)}</button>`).join("");
}

function renderMeasures() {
  const visible = MEASURES.filter((measure) => state.category === "Все" || measure.category === state.category);
  $("measure-count").textContent = `${visible.length} / ${MEASURES.length}`;
  $("measures").innerHTML = visible.map((measure) => {
    const chosen = state.selected.has(measure.id);
    const target = state.targets[measure.id] || "nura";
    return `<article class="measure ${chosen ? "chosen" : ""}">
      <button class="toggle" type="button" data-toggle="${measure.id}" aria-label="${chosen ? "Убрать" : "Добавить"}: ${escapeHTML(measure.name)}" aria-pressed="${chosen}" ${!chosen && state.selected.size >= 5 ? "disabled" : ""}><span aria-hidden="true">${chosen ? "✓" : "+"}</span></button>
      <div class="measure-content"><div class="measure-meta"><span class="mono">${measure.id}</span><span class="category-${categoryClasses[measure.category]}">${escapeHTML(measure.category)}</span><span class="badge">${measure.scope}</span></div>
      <h3>${escapeHTML(measure.name)}</h3><div class="measure-bottom">
      ${measure.scope === "Район" ? `<label>Район <select data-district="${measure.id}" aria-label="Район для меры: ${escapeHTML(measure.name)}">${INITIAL_DISTRICTS.map((district) => `<option value="${district.id}" ${target === district.id ? "selected" : ""}>${district.name}</option>`).join("")}</select></label>` : "<span>Во всех 5 районах</span>"}
      <span class="cost">${measure.cost} <small>у.е.</small></span></div></div></article>`;
  }).join("");
}

function renderDistricts(districts) {
  $("district-state").textContent = state.simulated ? "После симуляции" : "Исходные данные";
  $("districts").innerHTML = districts.map((district, index) => {
    const critical = Object.values(district.indicators).some((value) => value < 40);
    return `<article class="district ${critical ? "critical" : ""}"><div class="district-heading"><h3><span class="district-dot" style="--accent:${district.accent}" aria-hidden="true"></span>${district.name}</h3><span class="zone">${critical ? "ВНИМАНИЕ" : `ZONE 0${index + 1}`}</span></div><div class="indicators">${INDICATORS.map(([key, label]) => {
      const value = district.indicators[key];
      const delta = value - INITIAL_DISTRICTS[index].indicators[key];
      return `<div class="metric ${value < 40 ? "critical" : ""}"><div class="metric-heading"><span>${label}</span><span class="metric-value">${delta > 0 ? `<span class="gain">+${delta}</span>` : ""}${value}<small>/100</small></span></div><div class="metric-track" role="progressbar" aria-label="${district.name}: ${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><div class="metric-fill" style="--value:${value}%"></div></div>${value < 40 ? '<span class="critical-badge">Критический провал!</span>' : ""}</div>`;
    }).join("")}</div></article>`;
  }).join("");
}

function renderSummary() {
  const selected = getSelected();
  const budget = selected.reduce((sum, measure) => sum + measure.cost, 0);
  const districts = state.simulated ? simulateDistricts(selected) : INITIAL_DISTRICTS;
  $("budget-panel").classList.toggle("over-budget", budget > 100);
  $("budget-value").textContent = `${budget} / 100 у.е.`;
  $("budget-fill").style.width = `${Math.min(budget, 100)}%`;
  $("budget-bar").setAttribute("aria-valuenow", Math.min(budget, 100));
  $("budget-bar").setAttribute("aria-valuetext", `${budget} из 100 у.е.${budget > 100 ? ", бюджет превышен" : ""}`);
  $("budget-note").textContent = budget > 100 ? `Превышение бюджета на ${budget - 100} у.е.` : `Доступно ещё ${100 - budget} у.е.`;
  $("decision-count").textContent = selected.length;
  $("decision-slots").innerHTML = Array.from({ length: 5 }, (_, index) => `<span class="${index < selected.length ? "filled" : ""}"></span>`).join("");
  $("selection-note").textContent = selected.length === 5 ? "Лимит достигнут. Уберите меру, чтобы выбрать другую." : "Выберите до 5 мер для своего города";
  $("selection-note").classList.toggle("limit", selected.length === 5);
  $("reset").hidden = selected.length === 0;
  $("simulate").disabled = selected.length === 0;
  $("score").textContent = state.simulated ? "56.50" : "52.56";
  $("score-delta").hidden = !state.simulated;
  $("score-note").textContent = state.simulated ? "Демонстрационный результат" : "Исходный индекс качества города";
  $("protocol-status").classList.toggle("complete", state.simulated);
  renderDistricts(districts);
  if (!state.simulated) {
    $("verdict").innerHTML = '<div class="empty-state"><p>Ожидание запуска<span class="cursor" aria-hidden="true">_</span></p><p>Выберите мероприятия и запустите симуляцию для оценки стратегии.</p></div>';
    return;
  }
  const criticalDistricts = districts.filter((district) => Object.values(district.indicators).some((value) => value < 40));
  const improvements = INDICATORS.map(([key, label]) => ({ label,
    delta: districts.reduce((sum, district, index) => sum + district.indicators[key] - INITIAL_DISTRICTS[index].indicators[key], 0),
  })).filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta);
  $("verdict").innerHTML = `<div class="verdict-grid">
    <section><h3>Оценка стратегии</h3><p>В пакете ${selected.length} из 5 решений на ${budget} у.е. ${budget > 100 ? "Бюджет превышен — пересмотрите состав пакета." : `Бюджет соблюдён, резерв — ${100 - budget} у.е.`} Демо-Score: <strong>56.50 (+3.94)</strong>.</p></section>
    <section class="wins"><h3>Главные победы</h3><p>Прогноз улучшений по выбранным мерам:</p><ul>${improvements.map((item) => `<li>${item.label}: <span class="green mono">+${item.delta}</span> п. суммарно по районам.</li>`).join("")}</ul></section>
    <section class="risks"><h3>Риски</h3><p>${criticalDistricts.length ? `Критические показатели остаются в районах: ${criticalDistricts.map((district) => district.name).join(", ")}. Нужны адресные меры для показателей ниже 40.` : "Показателей ниже 40 нет. Следите за балансом развития районов."} ${budget > 100 ? `Для реализации необходимо сократить расходы на ${budget - 100} у.е.` : ""}</p></section>
  </div>`;
}

$("filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  renderFilters();
  renderMeasures();
  $("filters").querySelector(`[data-category="${state.category}"]`).focus({ preventScroll: true });
});

$("measures").addEventListener("click", (event) => {
  const button = event.target.closest("[data-toggle]");
  if (!button || button.disabled) return;
  const id = button.dataset.toggle;
  if (state.selected.has(id)) state.selected.delete(id);
  else if (state.selected.size < 5) state.selected.add(id);
  else return;
  state.simulated = false;
  renderMeasures();
  renderSummary();
  $("measures").querySelector(`[data-toggle="${id}"]`).focus({ preventScroll: true });
});

$("measures").addEventListener("change", (event) => {
  const select = event.target.closest("[data-district]");
  if (!select) return;
  state.targets[select.dataset.district] = select.value;
  if (state.selected.has(select.dataset.district)) {
    state.simulated = false;
    renderSummary();
  }
});

$("reset").addEventListener("click", () => {
  state.selected.clear();
  state.simulated = false;
  renderMeasures();
  renderSummary();
  $("filters").querySelector(".active").focus({ preventScroll: true });
});

$("simulate").addEventListener("click", () => {
  if (!state.selected.size) return;
  state.simulated = true;
  renderSummary();
});

renderFilters();
renderMeasures();
renderSummary();
