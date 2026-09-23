"use strict";
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const fmt = (n) => Number(n).toFixed(2);
const signed = (n) => `${n >= 0 ? "+" : ""}${fmt(n)}`;
const state = { data:null, selected:new Set(), targets:{}, category:"Все", result:null,
  busy:false, analysis:"", error:"", analysisError:"", scenarios:{ A:null, B:null }, improvement:null };

const DRAFT_KEY = "akim-selection-v1";
let activeView="decisions";
let activeDistrict="Нура";
const VIEW_HINTS={
  decisions:["01 / Соберите пакет решений","Сначала посмотрите рейтинги и показатели районов во вкладке «Районы и результат»: они помогут выбрать категории, где улучшения нужнее всего. Затем добавьте пять инициатив кнопкой «+» и назначьте районы. Бюджет — до 100 у.е.","results","Посмотреть районы →"],
  results:["02 / Изучите изменения","Нажмите на название района. Сравните показатели до и после расчёта; значения ниже 40 требуют внимания.","advisor","К объяснению AI →"],
  advisor:["03 / Разберитесь в компромиссах","Здесь появятся объяснение стратегии и рекомендации. Если AI недоступен, повторите запрос. Отчёт можно сохранить в PDF.","compare","Сравнить варианты →"],
  compare:["04 / Найдите лучший сценарий","Сохраните расчёт как A. Вернитесь к решениям, измените пакет, рассчитайте снова и сохраните как B. Оба сценария сохранятся в браузере.","decisions","Изменить решения →"],
  help:["Короткий маршрут","Решения → расчёт → районы → AI-советник → сравнение. Категории только фильтруют список; сам расчёт запускается кнопкой внизу.","decisions","Начать выбор →"]
};
function renderHint() {
  const [title,text,,label]=VIEW_HINTS[activeView];
  $("hint-title").textContent=title;
  $("hint-text").textContent=activeView==="results" && !state.result ? "Сейчас показано исходное состояние города. Переключайте районы, изучайте их индексы и слабые показатели — особенно значения ниже 40. Это поможет определить приоритетные категории. Затем вернитесь во вкладку «Решения»." : text;
  $("hint-next").textContent=label;
}
$("hint-next").addEventListener("click",()=>showView(VIEW_HINTS[activeView][2],true));
function showView(view, focus=false) {
  activeView=view;
  document.querySelectorAll("[data-panel]").forEach(p=>{p.hidden=p.dataset.panel!==view;});
  document.querySelectorAll("[data-view]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.view===view)));
  renderHint();
  if (focus) {
    const panel=document.querySelector(`[data-panel="${view}"]`);
    panel.setAttribute("tabindex","-1"); panel.focus({preventScroll:true});
    document.querySelector(".view-nav").scrollIntoView({block:"start",behavior:"instant"});
  }
}
document.querySelector(".view-nav").addEventListener("click",e=>{
  const button=e.target.closest("[data-view]"); if (button) showView(button.dataset.view,true);
});
document.querySelector(".view-nav").addEventListener("keydown",e=>{
  if (!["ArrowLeft","ArrowRight","Home","End"].includes(e.key)) return;
  const buttons=[...document.querySelectorAll("[data-view]")], index=buttons.indexOf(document.activeElement);
  if (index<0) return;
  e.preventDefault();
  const next=e.key==="Home" ? 0 : e.key==="End" ? buttons.length-1 : (index+(e.key==="ArrowRight" ? 1 : -1)+buttons.length)%buttons.length;
  buttons[next].focus(); showView(buttons[next].dataset.view);
});
// Меняйте версию при изменении формулы/формата результатов.
const STORAGE_VERSION = 2;
function datasetStamp() { return JSON.stringify(state.data); }
function storageNotice(text) { $("storage-status").textContent=text; }
function saveSelection() {
  if (!state.data) return;
  try {
    const targets={...state.targets};
    getSelected().forEach(m=>{ if (m.district) targets[m.id]=m.district; });
    localStorage.setItem(DRAFT_KEY, JSON.stringify({version:STORAGE_VERSION, dataset:datasetStamp(),
      selected:[...state.selected], targets, category:state.category,
      result:state.result, analysis:state.analysis, scenarios:state.scenarios}));
  } catch (_) { storageNotice("Браузер не разрешил сохранение или место закончилось. Скачайте сценарии в JSON перед закрытием страницы."); }
}
function validSavedResult(r) {
  if (!r || r.status!=="ok" || !Array.isArray(r.selected_measures) ||
      r.selected_measures.length!==5 || new Set(r.selected_measures.map(m=>m?.id)).size!==5) return false;
  for (const m of r.selected_measures) {
    const spec=state.data.measures.find(x=>x.id===m?.id);
    if (!spec || (spec.scope==="Район" ? !Object.hasOwn(state.data.districts,m.district) : m.district!=null)) return false;
  }
  if (validationErrors(r.selected_measures).length) return false;
  if (![r.score_before,r.score_after,r.score_delta,r.budget?.spent,r.budget?.limit,r.budget?.remaining].every(Number.isFinite)) return false;
  for (const summary of [r.summary_before,r.summary_after])
    if (![summary?.score,summary?.d_avg,summary?.d_min,summary?.n_crit].every(Number.isFinite)) return false;
  if (!r.districts || Object.keys(r.districts).length!==5 || !Array.isArray(r.synergies)) return false;
  for (const name of Object.keys(state.data.districts)) {
    const d=r.districts[name];
    if (![d?.d_before,d?.d_after,d?.d_delta,d?.population_share].every(Number.isFinite)) return false;
    for (const field of ["before","after","deltas"]) {
      if (!d[field] || Object.keys(d[field]).length!==10 ||
          !Object.keys(state.data.weights).every(k=>Number.isFinite(d[field][k]))) return false;
    }
  }
  return r.synergies.every(s=>Array.isArray(s?.measures) && s.measures.every(m=>typeof m==="string") &&
    Object.hasOwn(state.data.districts,s.district) && s.effects && Object.values(s.effects).every(Number.isFinite));
}
function selectionSignature(measures) {
  return JSON.stringify(measures.map(m=>[m.id,m.district || null]).sort((a,b)=>a[0].localeCompare(b[0])));
}
function restoreSelection() {
  try {
    const saved=JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (!saved || ![1,STORAGE_VERSION].includes(saved.version) || !Array.isArray(saved.selected)) return;
    const categories=["Все",...state.data.measures.map(m=>m.direction)];
    state.category=categories.includes(saved.category) ? saved.category : "Все";
    const targets=saved.targets && typeof saved.targets === "object" ? saved.targets : {};
    const districts=Object.keys(state.data.districts);
    state.targets={}; state.selected.clear();
    for (const measure of state.data.measures) {
      if (measure.scope === "Район" && districts.includes(targets[measure.id]))
        state.targets[measure.id]=targets[measure.id];
    }
    const restored=[];
    for (const id of new Set(saved.selected)) {
      const measure=state.data.measures.find(m=>m.id===id);
      if (!measure || (measure.scope === "Район" && !state.targets[id])) continue;
      const candidate={id,...(measure.scope === "Район" ? {district:state.targets[id]} : {})};
      if (validationErrors([...restored,candidate],false).length) continue;
      restored.push(candidate); state.selected.add(id);
    }
    if (state.selected.size!==saved.selected.length)
      state.error="Часть сохранённых мер больше не соответствует правилам и была убрана. Проверьте выбор.";
    if (saved.version===STORAGE_VERSION && saved.dataset===datasetStamp()) {
      if (validSavedResult(saved.result) && selectionSignature(saved.result.selected_measures)===selectionSignature(getSelected())) {
        state.result=saved.result;
        state.analysis=typeof saved.analysis==="string" ? saved.analysis : "";
        if (!state.analysis) state.analysisError="Расчёт восстановлен. AI-анализ ещё не получен — можно повторить запрос.";
      }
      for (const slot of ["A","B"]) {
        const snapshot=saved.scenarios?.[slot];
        if (validSavedResult(snapshot?.result)) state.scenarios[slot]={result:snapshot.result,
          analysis:typeof snapshot.analysis==="string" ? snapshot.analysis : null};
      }
    } else if (saved.version===STORAGE_VERSION) storageNotice("Данные модели изменились: выбор проверен, старые расчёты и анализы сброшены. Рассчитайте сценарии заново.");
  } catch (_) { storageNotice("Не удалось восстановить сохранение. Можно продолжить работу и рассчитать сценарий заново."); }
}

async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(path, {signal:controller.signal, ...(body === undefined ? {} : {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)})});
    const data = await response.json();
    if (!response.ok || data.status !== "ok") throw new Error(data.error || "Ошибка сервера.");
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Сервер не ответил вовремя. Повторите запрос.");
    if (e instanceof TypeError) throw new Error("Нет связи с сервером. Проверьте запуск приложения.");
    throw e;
  } finally { clearTimeout(timer); }
}
function getSelected() {
  return state.data.measures.filter((m) => state.selected.has(m.id)).map((m) => ({id:m.id,
    ...(m.scope === "Район" ? {district:state.targets[m.id] || "Нура"} : {})}));
}
// Интерфейс предупреждает заранее; сервер всегда проверяет решения повторно.
function validationErrors(selected, requireFive = true) {
  const r = state.data.rules, errors = [], counts = {};
  if ((requireFive && selected.length !== r.required_measures) || selected.length > r.required_measures)
    errors.push("Нужно ровно 5 решений.");
  const measures = selected.map((s) => state.data.measures.find((m) => m.id === s.id));
  const cost = measures.reduce((sum,m) => sum + m.cost, 0);
  if (cost > r.budget_limit) errors.push(`Бюджет превышен на ${cost-r.budget_limit} у.е.`);
  measures.forEach((m) => { counts[m.direction] = (counts[m.direction] || 0)+1; });
  Object.entries(counts).forEach(([d,n]) => { if (n > r.max_measures_per_direction) errors.push(`${d}: не более двух мер.`); });
  for (const rule of r.incompatibilities) {
    const [a,b] = rule.measures.map((id) => selected.find((s) => s.id === id));
    if (a && b && (!rule.same_district_only || a.district === b.district))
      errors.push(`${a.id} и ${b.id} несовместимы${rule.same_district_only ? " в одном районе" : ""}.`);
  }
  return errors;
}
function invalidate() { state.result=null; state.analysis=""; state.error=""; state.analysisError=""; state.improvement=null; }
function renderFilters() {
  $("filters").innerHTML = ["Все",...new Set(state.data.measures.map((m) => m.direction))].map((c) =>
    `<button type="button" class="filter ${c===state.category ? "active":""}" data-category="${esc(c)}" aria-pressed="${c===state.category}">${esc(c)}</button>`).join("");
}
function renderMeasures() {
  const visible = state.data.measures.filter((m) => state.category === "Все" || m.direction === state.category);
  $("measure-count").textContent = `${visible.length} / ${state.data.measures.length}`;
  $("measures").innerHTML = visible.map((m) => {
    const chosen=state.selected.has(m.id), target=state.targets[m.id] || "Нура";
    const candidate={id:m.id,...(m.scope === "Район" ? {district:target} : {})};
    const reasons=chosen ? [] : validationErrors([...getSelected(),candidate],false);
    const effects=Object.entries(m.effects).map(([k,v]) => `${k} ${signed(v)}`).join(" · ");
    return `<article class="measure ${chosen ? "chosen":""}">
      <button type="button" class="toggle" data-toggle="${m.id}" aria-label="${chosen ? "Убрать":"Добавить"} ${m.id}: ${esc(m.name)}" aria-pressed="${chosen}" ${state.busy || reasons.length ? "disabled":""}>${chosen ? "✓":"+"}</button>
      <div class="measure-content"><div class="measure-meta"><span class="mono">${m.id}</span><span>${esc(m.direction)}</span><span class="badge">${m.scope}</span></div>
      <h3>${esc(m.name)}</h3><p class="fine-print">Полный эффект: ${esc(effects)}</p><p class="fine-print">Задержка ${m.lag} кв. · Реализуется ${(8-m.lag)/8*100}% эффекта</p>
      <div class="measure-bottom">${m.scope === "Район" ? `<label>Район <select data-district="${m.id}" aria-label="Район для ${m.id}: ${esc(m.name)}" ${state.busy ? "disabled":""}>${Object.keys(state.data.districts).map((d) => `<option ${d===target ? "selected":""}>${esc(d)}</option>`).join("")}</select></label>` : "<span>Во всех 5 районах</span>"}<span class="cost">${m.cost} <small>у.е.</small></span></div>
      ${reasons.length ? `<p class="fine-print">${esc(reasons.join(" "))}</p>`:""}</div></article>`;
  }).join("");
}
function renderDistricts() {
  renderInsights();
  $("district-picker").innerHTML=Object.keys(state.data.districts).map(name=>`<button class="filter ${name===activeDistrict ? "active":""}" type="button" data-pick-district="${esc(name)}" aria-pressed="${name===activeDistrict}">${esc(name)}</button>`).join("");
  $("district-state").textContent=state.result ? "После 8 кварталов":"Исходные данные";
  $("districts").innerHTML=Object.entries(state.data.districts).map(([name,d]) => {
    const result=state.result?.districts[name], values=result?.after || d.indicators;
    const critical=Object.values(values).some((v) => v<40);
    return `<article ${name!==activeDistrict ? "hidden":""} class="district ${critical ? "critical":""}"><div class="district-heading"><h3>${esc(name)}</h3><span class="zone">${critical ? "ВНИМАНИЕ":"НОРМА"}</span></div>
      <p class="fine-print">Население: ${Math.round(d.population_share*100)}% · Индекс: ${fmt(state.data.baseline.districts[name])}${result ? ` → ${fmt(result.d_after)}`:""}</p>
      <div class="indicators">${Object.entries(values).map(([k,v]) => {
        const info=state.data.indicator_info[k], delta=result?.deltas[k] || 0;
        return `<div class="metric ${v<40 ? "critical":""}"><div class="metric-heading"><span title="${esc(info.description)}">${k} · ${esc(info.label)}</span><span class="metric-value">${result ? `${fmt(d.indicators[k])} → `:""}${fmt(v)}</span></div>
        <div class="metric-track" role="progressbar" aria-label="${esc(name)}: ${k} — ${esc(info.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"><div class="metric-fill" style="--value:${v}%"></div></div>
        ${result ? `<span class="${delta<0 ? "loss":"gain"}">${signed(delta)}</span>`:""}${v<40 ? '<span class="critical-badge">Ниже 40</span>':""}</div>`;
      }).join("")}</div></article>`;
  }).join("");
}
function renderAnalysis(text) {
  const fragment=document.createDocumentFragment();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const element=document.createElement(line.startsWith("### ") ? "h3":"p");
    element.textContent=line.replace(/^### /,""); // Текст AI не исполняется как HTML.
    fragment.append(element);
  }
  $("verdict").replaceChildren(fragment);
}

function renderInsights() {
  const ranking=Object.keys(state.data.districts).map(name=>({name,
    score:state.result?.districts[name].d_after ?? state.data.baseline.districts[name],
    critical:Object.values(state.result?.districts[name].after || state.data.districts[name].indicators).filter(v=>v<40).length
  })).sort((a,b)=>a.score-b.score || a.name.localeCompare(b.name));
  $("district-ranking").innerHTML=ranking.map(d=>`<button type="button" class="ranking-card ${d.name===activeDistrict ? "active":""}" data-rank-district="${esc(d.name)}" aria-pressed="${d.name===activeDistrict}"><span>${esc(d.name)}</span><strong>${fmt(d.score)}</strong><small>${d.critical ? `Критических: ${d.critical}`:"Нет критических"}</small></button>`).join("");
  const r=state.result;
  $("score-breakdown").hidden=!r;
  if (r) {
    const b=r.score_breakdown || {average:.7*(r.summary_after.d_avg-r.summary_before.d_avg),weakest:.3*(r.summary_after.d_min-r.summary_before.d_min),critical:r.summary_before.n_crit-r.summary_after.n_crit};
    $("score-breakdown").innerHTML=`<h3>Из чего складывается ${signed(r.score_delta)} к Score</h3><div class="breakdown-grid">${[["Средний индекс × 0,7",b.average],["Слабейший район × 0,3",b.weakest],["Изменение штрафа за критические показатели",b.critical]].map(([label,v])=>`<div><strong>${signed(v)}</strong><span>${label}</span></div>`).join("")}</div><p class="fine-print">Вклад каждого компонента относительно исходного города. Округление в отображении может дать разницу 0,01.</p>`;
  }
  $("find-improvement").disabled=state.busy || !r;
  const suggestion=state.improvement;
  if (!suggestion) { $("improvement").textContent=r ? "Поиск выполняется по формулам симулятора и не требует AI-ключа." : "Сначала рассчитайте свой пакет из пяти решений."; return; }
  if (!suggestion.improved) { $("improvement").textContent=`Проверено ${suggestion.checked} допустимых замен. Ни одна не повысила Score. Изменение нескольких решений одновременно может дать другой результат.`; return; }
  const label=m=>`${state.data.measures.find(x=>x.id===m.id).name} (${m.district || "весь город"})`;
  $("improvement").innerHTML=`<p><strong>${esc(label(suggestion.removed))}</strong> → <strong>${esc(label(suggestion.added))}</strong></p><p>Score: ${fmt(suggestion.current_score)} → ${fmt(suggestion.candidate.score_after)} (${signed(suggestion.score_gain)}). Бюджет: ${suggestion.candidate.budget.spent} / 100 (${signed(suggestion.budget_delta)} у.е. к текущему плану).</p><ul>${Object.entries(suggestion.district_deltas).filter(([,v])=>Math.abs(v)>1e-9).map(([d,v])=>`<li>${esc(d)}: ${signed(v)} к индексу района</li>`).join("")}</ul><p class="fine-print">Проверено ${suggestion.checked} допустимых замен. Текущий план останется прежним, пока вы не примените вариант. Сохраните его как A для сравнения.</p><button type="button" class="filter" id="apply-improvement" ${state.busy ? "disabled":""}>Применить вариант</button>`;
}

function renderComparison() {
  const {A, B}=state.scenarios;
  for (const slot of ["A", "B"]) {
    $("save-"+slot).disabled=state.busy || !state.result;
    $("save-"+slot).textContent=state.scenarios[slot] ? `Заменить сценарий ${slot}` : `Сохранить как ${slot}`;
  }
  $("export-scenarios").disabled=!A && !B;
  $("clear-scenarios").disabled=state.busy || (!A && !B);
  $("import-scenarios").disabled=state.busy;
  const cells=(label, get, format=fmt) => `<tr><th scope="row">${esc(label)}</th>${[A,B].map((s) => `<td>${s ? esc(format(get(s.result))) : "—"}</td>`).join("")}</tr>`;
  const weakest=(r) => Object.entries(r.districts).filter(([,d]) => Math.abs(d.d_after-r.summary_after.d_min)<1e-9).map(([name]) => name).join(", ");
  $("comparison-table").innerHTML=`<thead><tr><th scope="col">Показатель</th><th scope="col">Сценарий A</th><th scope="col">Сценарий B</th></tr></thead><tbody>`+
    cells("Потрачено, у.е.",r=>r.budget.spent)+cells("Score",r=>r.score_after)+
    cells("Прирост Score",r=>r.score_delta,signed)+cells("Критических показателей ↓",r=>r.summary_after.n_crit,String)+
    cells("Индекс слабейшего района ↑",r=>r.summary_after.d_min)+cells("Слабейший район",weakest,String)+
    Object.keys(state.data.districts).map((d)=>cells(`Индекс: ${d}`,r=>r.districts[d].d_after)).join("")+"</tbody>";
  $("comparison-measures").innerHTML=["A","B"].map((slot)=> {
    const s=state.scenarios[slot];
    return `<section><h3>Решения ${slot}</h3>${s ? `<ul>${s.result.selected_measures.map((m)=>`<li>${esc(m.id)} · ${esc(m.name || state.data.measures.find(x=>x.id===m.id).name)} — ${esc(m.district || "весь город")}</li>`).join("")}</ul>` : "<p>Сценарий ещё не сохранён.</p>"}</section>`;
  }).join("");
  for (const [index,slot] of ["A","B"].entries()) {
    const snapshot=state.scenarios[slot];
    if (!snapshot?.analysis) continue;
    const details=document.createElement("details"), title=document.createElement("summary"), text=document.createElement("p");
    title.textContent=`Сохранённый AI-анализ ${slot}`;
    text.textContent=snapshot.analysis; text.style.whiteSpace="pre-wrap";
    details.append(title,text); $("comparison-measures").children[index].append(details);
  }
  if (A && B) {
    const delta=B.result.score_after-A.result.score_after;
    const higher=Math.abs(delta)<1e-9 ? "Score сценариев одинаков." : `По Score выше сценарий ${delta>0 ? "B":"A"} на ${fmt(Math.abs(delta))} п.`;
    const worse=Object.keys(state.data.districts).filter(d=>B.result.districts[d].d_after<A.result.districts[d].d_after-1e-9);
    $("comparison-note").textContent=higher+" "+(worse.length ? `В B индекс ниже, чем в A, в районах: ${worse.join(", ")}.` : "В B нет районов с индексом ниже, чем в A.");
  } else $("comparison-note").textContent="Рассчитайте сценарий, сохраните как A, измените решения и сохраните новый результат как B. Сценарии сохраняются в этом браузере, в том числе после обновления страницы.";
}

function render() {
  if (!state.data) return;
  renderHint();
  saveSelection();
  renderFilters(); renderMeasures(); renderDistricts(); renderComparison();
  $("export-report").disabled=state.busy || !state.result;
  $("report-status").textContent="";
  $("print-report").replaceChildren();
  const selected=getSelected(), errors=validationErrors(selected), limit=state.data.rules.budget_limit;
  const budget=selected.reduce((sum,s) => sum+state.data.measures.find((m) => m.id===s.id).cost,0);
  $("selected-preview").innerHTML=selected.length ? selected.map(s=>`<button type="button" data-remove="${s.id}" ${state.busy ? "disabled":""} title="Убрать ${esc(s.id)}" aria-label="Убрать ${esc(state.data.measures.find(m=>m.id===s.id).name)}">${esc(s.id)} · ${esc(s.district || "Весь город")} <span aria-hidden="true">×</span></button>`).join("") : "<span>Ваш пакет пока пуст. Начните с категории или загрузите пример.</span>";
  $("dock-summary").textContent=`${selected.length} из 5 решений · ${budget} / ${limit} у.е.`;
  $("dock-note").textContent=state.busy ? "Расчёт и AI-анализ выполняются…" : errors.join(" ") || (state.result ? "Результат готов. Откройте районы, AI-советника или сравнение." : "Всё готово. Посмотрите, как изменится город.");
  $("budget-value").textContent=`${budget} / ${limit} у.е.`;
  $("budget-fill").style.width=`${budget/limit*100}%`;
  $("budget-bar").setAttribute("aria-valuenow",budget);
  $("budget-note").textContent=`Доступно ещё ${limit-budget} у.е.`;
  $("decision-count").textContent=selected.length;
  $("decision-slots").innerHTML=Array.from({length:5},(_,i) => `<span class="${i<selected.length ? "filled":""}"></span>`).join("");
  $("selection-note").textContent=errors.join(" ") || "Пять решений готовы к расчёту.";
  $("reset").hidden=!selected.length; $("reset").disabled=state.busy;
  $("reference").disabled=state.busy;
  $("delete-saved").disabled=state.busy;
  $("simulate").disabled=state.busy || errors.length>0;
  $("simulate").textContent=state.busy ? "Выполняется запрос…":"Рассчитать и получить AI-анализ";
  $("score").textContent=fmt(state.result?.score_after ?? state.data.baseline.summary.score);
  $("score-delta").hidden=!state.result;
  $("score-delta").textContent=state.result ? `(${signed(state.result.score_delta)})`:"";
  $("score-note").textContent=state.result ? `До: ${fmt(state.result.score_before)} · После 8 кварталов`:"Исходный индекс качества города";
  $("error").textContent=state.error; $("error").hidden=!state.error;
  $("retry-analysis").hidden=!state.analysisError || !state.result;
  $("retry-analysis").disabled=state.busy;
  $("protocol-status").textContent=state.busy ? "● Ожидание ответа":state.analysis ? "● Анализ готов":"● Советник AI";
  $("verdict").setAttribute("aria-busy",String(state.busy));
  if (state.analysis) renderAnalysis(state.analysis);
  else $("verdict").textContent=state.analysisError || (state.busy ? "Получаем результат. Расчёт появится до ответа AI.":"Выберите пять мер и запустите симуляцию.");
  const summary=state.result?.summary_after || state.data.baseline.summary;
  $("score-explanation").textContent=`Score = 0,7 × средний индекс (${fmt(summary.d_avg)}) + 0,3 × индекс слабейшего района (${fmt(summary.d_min)}) − число критических показателей (${summary.n_crit}).`;
  $("synergies").textContent=state.result ? (state.result.synergies.length ? "Синергии: "+state.result.synergies.map((s) => `${s.measures.join(" + ")} → ${s.district}: ${Object.entries(s.effects).map(([k,v]) => `${k} +${v}`).join(", ")}`).join("; "):"В этом сценарии синергий нет."):"";
}
// В отчёт попадает только текущий серверный результат, а не изменяемый выбор.
function buildReport(result, analysis, indicatorInfo) {
  const row=(label,before,after) => `<tr><th scope="row">${esc(label)}</th><td>${fmt(before)}</td><td>${fmt(after)}</td><td>${signed(after-before)}</td></tr>`;
  const tableHead="<thead><tr><th scope=\"col\">Показатель</th><th scope=\"col\">До</th><th scope=\"col\">После</th><th scope=\"col\">Изменение</th></tr></thead>";
  const analysisHTML=analysis ? analysis.split("\n").filter(line=>line.trim()).map(line=>line.startsWith("### ")
    ? `<h3>${esc(line.slice(4))}</h3>` : `<p>${esc(line)}</p>`).join("")
    : "<p>AI-анализ не получен. В отчёте приведены только результаты математической модели.</p>";
  return `<header><p class="report-kicker">Астана · Городской симулятор</p><h1>QalaAI: Цифровой советник акима</h1><p>Отчёт по текущему сценарию · Горизонт: 8 кварталов</p></header>
    <h2>Результат стратегии</h2>
    <p><strong>Бюджет:</strong> ${esc(result.budget.spent)} / ${esc(result.budget.limit)} у.е. · <strong>Остаток:</strong> ${esc(result.budget.remaining)} у.е.</p>
    <table>${tableHead}<tbody>${row("Astana Quality of Life Score",result.score_before,result.score_after)}
      ${row("Средний индекс города",result.summary_before.d_avg,result.summary_after.d_avg)}
      ${row("Индекс слабейшего района",result.summary_before.d_min,result.summary_after.d_min)}
      ${row("Критических показателей (ниже 40)",result.summary_before.n_crit,result.summary_after.n_crit)}</tbody></table>
    <p class="report-note">Score = 0,7 × средний индекс + 0,3 × индекс слабейшего района − число критических показателей. Отображаемые значения округлены до двух знаков.</p>
    <h2>Выбранные решения</h2><table><thead><tr><th scope="col">Мера</th><th scope="col">Район</th><th scope="col">Стоимость, у.е.</th><th scope="col">Задержка, кв.</th></tr></thead><tbody>
    ${result.selected_measures.map(m=>`<tr><th scope="row">${esc(m.id)} · ${esc(m.name)}</th><td>${esc(m.district || "Весь город")}</td><td>${esc(m.cost)}</td><td>${esc(m.lag)}</td></tr>`).join("")}</tbody></table>
    <h2>Синергии</h2>${result.synergies.length ? `<ul>${result.synergies.map(s=>`<li>${esc(s.measures.join(" + "))} — ${esc(s.district)}: ${Object.entries(s.effects).map(([k,v])=>`${esc(k)} ${signed(v)}`).join(", ")}</li>`).join("")}</ul>` : "<p>В этом сценарии синергий нет.</p>"}
    <section class="report-analysis"><h2>Вердикт AI</h2>${analysisHTML}</section>
    <h2>Индексы районов</h2><table>${tableHead}<tbody>${Object.entries(result.districts).map(([name,d])=>row(name,d.d_before,d.d_after)).join("")}</tbody></table>
    <h2>Показатели районов</h2>${Object.entries(result.districts).map(([name,d])=>`<section class="report-district"><h3>${esc(name)} · доля населения ${Math.round(d.population_share*100)}%</h3><table>${tableHead}<tbody>${Object.entries(d.after).map(([k,v])=>row(`${k} · ${indicatorInfo[k]?.label || k}${v<40 ? " — КРИТИЧЕСКИЙ" : ""}`,d.before[k],v)).join("")}</tbody></table></section>`).join("")}
    <footer>Синтетические данные учебного симулятора. Результаты условной модели не являются прогнозом реального города.</footer>`;
}
function prepareReport() {
  $("print-report").innerHTML=state.result && !state.busy
    ? buildReport(state.result,state.analysis,state.result.indicator_info || state.data.indicator_info)
    : "<h1>Отчёт пока недоступен</h1><p>Дождитесь завершения расчёта текущего сценария, затем повторите экспорт.</p>";
}
window.addEventListener("beforeprint",prepareReport);
$("export-report").addEventListener("click",()=> {
  if (state.busy || !state.result) return;
  prepareReport();
  try {
    window.print();
    $("report-status").textContent="Для сохранения файла выберите «Сохранить как PDF» в окне печати.";
  } catch (_) {
    $("report-status").textContent="Не удалось открыть окно печати. Используйте меню браузера «Печать» (Cmd+P на Mac или Ctrl+P).";
  }
});

async function analyze() {
  state.analysisError="";
  try { state.analysis=(await api("/api/analyze",{selected_measures:getSelected()})).analysis; }
  catch(e) { state.analysisError=`Расчёт сохранён. AI-анализ недоступен: ${e.message}`; }
}
$("filters").addEventListener("click",(e) => {
  const b=e.target.closest("[data-category]"); if (!b) return;
  state.category=b.dataset.category; saveSelection(); renderFilters(); renderMeasures();
});
$("measures").addEventListener("click",(e) => {
  const b=e.target.closest("[data-toggle]"); if (!b || b.disabled || state.busy) return;
  const id=b.dataset.toggle;
  if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  invalidate(); render();
});
$("measures").addEventListener("change",(e) => {
  const s=e.target.closest("[data-district]"); if (!s || state.busy) return;
  const id=s.dataset.district, previous=state.targets[id]; state.targets[id]=s.value;
  const errors=validationErrors(getSelected(),false);
  if (errors.length) { state.targets[id]=previous; state.error=errors.join(" "); }
  else if (state.selected.has(id)) invalidate(); else state.error="";
  render();
});
$("reset").addEventListener("click",() => {
  if (state.busy) return; state.selected.clear(); state.targets={}; invalidate(); render();
});
$("reference").addEventListener("click",() => {
  if (state.busy || !state.data) return;
  state.selected=new Set(["M7","M8","M10","M12","M5"]);
  state.targets={M7:"Нура",M8:"Нура",M10:"Нура",M5:"Сарыарка"};
  state.category="Все"; invalidate(); render();
});
$("simulate").addEventListener("click",async () => {
  if (state.busy || !state.data || validationErrors(getSelected()).length) return;
  invalidate(); state.busy=true; render();
  try { state.result=await api("/api/simulate",{selected_measures:getSelected()}); render(); showView("results",true); await analyze(); }
  catch(e) { state.error=e.message; }
  finally { state.busy=false; render(); }
});
$("retry-analysis").addEventListener("click",async () => {
  if (state.busy || !state.result) return;
  state.busy=true; render(); try { await analyze(); } finally { state.busy=false; render(); }
});
async function initialize() {
  $("retry-data").hidden=true;
  try {
    if (location.protocol === "file:") throw new Error("Запустите сервер и откройте http://127.0.0.1:8000 вместо файла.");
    state.data=await api("/api/data"); state.error=""; restoreSelection(); render();
  } catch(e) { $("error").hidden=false; $("error").textContent=e.message; $("retry-data").hidden=false; }
}
$("retry-data").addEventListener("click",initialize);
$("district-ranking").addEventListener("click",e=>{
  const b=e.target.closest("[data-rank-district]"); if (!b) return;
  activeDistrict=b.dataset.rankDistrict; renderDistricts();
  $("district-picker").scrollIntoView({block:"center"});
});
$("find-improvement").addEventListener("click",async()=>{
  if (state.busy || !state.result) return;
  state.busy=true; state.error=""; render();
  try { state.improvement=await api("/api/improve",{selected_measures:getSelected()}); }
  catch(e) { state.error=e.message; }
  finally { state.busy=false; render(); }
});
$("improvement").addEventListener("click",e=>{
  if (!e.target.closest("#apply-improvement") || state.busy || !state.improvement?.candidate) return;
  const candidate=state.improvement.candidate;
  state.selected=new Set(candidate.selected_measures.map(m=>m.id));
  state.targets=Object.fromEntries(candidate.selected_measures.filter(m=>m.district).map(m=>[m.id,m.district]));
  invalidate(); state.result=candidate;
  state.analysisError="План обновлён. Запросите AI-анализ для нового сценария во вкладке советника.";
  render();
});
$("import-scenarios").addEventListener("click",()=>{ if (!state.busy) $("import-file").click(); });
$("import-file").addEventListener("change",async()=>{
  const file=$("import-file").files[0]; $("import-file").value="";
  if (!file || state.busy) return;
  state.busy=true; render(); $("import-status").textContent="Проверяем и пересчитываем импорт…";
  try {
    if (file.size>1024*1024) throw new Error("Файл должен быть не больше 1 МБ.");
    const imported=JSON.parse(await file.text());
    if (imported.format_version!==1 || imported.dataset!=="akim-5-hours" || !imported.scenarios || typeof imported.scenarios!=="object") throw new Error("Неверный формат. Выберите JSON, сохранённый кнопкой «Скачать JSON».");
    const restored={};
    for (const slot of ["A","B"]) {
      if (imported.scenarios[slot]==null) continue;
      const measures=imported.scenarios[slot]?.result?.selected_measures;
      if (!Array.isArray(measures) || measures.length!==5) throw new Error(`Сценарий ${slot}: требуется пять решений.`);
      const selected=measures.map(m=>({id:m?.id,...(m?.district!=null ? {district:m.district}:{})}));
      restored[slot]={result:await api("/api/simulate",{selected_measures:selected}),analysis:null};
    }
    if (!Object.keys(restored).length) throw new Error("В файле нет сценариев.");
    // Применяем только после успешной проверки всех сценариев файла.
    state.scenarios={...state.scenarios,...restored};
    $("import-status").textContent=`Импортированы ${Object.keys(restored).join(", ")}. Соответствующие слоты заменены. Цифры пересчитаны сервером; AI-тексты из файла не импортируются.`;
  } catch(e) { $("import-status").textContent=`Импорт не выполнен: ${e.message}`; }
  finally { state.busy=false; render(); }
});
$("district-picker").addEventListener("click",e=>{
  const b=e.target.closest("[data-pick-district]"); if (!b) return;
  activeDistrict=b.dataset.pickDistrict; renderDistricts();
});
$("selected-preview").addEventListener("click",e=>{
  const b=e.target.closest("[data-remove]"); if (!b || state.busy) return;
  state.selected.delete(b.dataset.remove); invalidate(); render();
});
for (const slot of ["A","B"]) $("save-"+slot).addEventListener("click",()=> {
  if (state.busy || !state.result) return;
  state.scenarios[slot]=structuredClone({result:state.result, analysis:state.analysis || null});
  saveSelection(); renderComparison();
});
$("clear-scenarios").addEventListener("click",()=> {
  if (state.busy) return;
  state.scenarios={A:null,B:null}; saveSelection(); renderComparison();
});
$("delete-saved").addEventListener("click",()=> {
  if (state.busy || !state.data) return;
  state.selected.clear(); state.targets={}; state.category="Все";
  state.scenarios={A:null,B:null}; invalidate(); render();
  try { localStorage.removeItem(DRAFT_KEY); storageNotice("Сохранённые данные удалены. Новый выбор будет сохраняться автоматически."); }
  catch (_) { storageNotice("Браузер не разрешил удалить сохранение. Удалите данные сайта в настройках браузера."); }
});
$("export-scenarios").addEventListener("click",()=> {
  if (!state.scenarios.A && !state.scenarios.B) return;
  const blob=new Blob([JSON.stringify({format_version:1, dataset:"akim-5-hours", scenarios:state.scenarios},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob), link=document.createElement("a");
  link.href=url; link.download="akim-scenarios.json"; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
initialize();
