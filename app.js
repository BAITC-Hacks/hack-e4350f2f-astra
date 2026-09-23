"use strict";
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const fmt = (n) => Number(n).toFixed(2);
const signed = (n) => `${n >= 0 ? "+" : ""}${fmt(n)}`;
const state = { data:null, selected:new Set(), targets:{}, category:"Все", result:null,
  busy:false, analysis:"", error:"", analysisError:"" };

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
function invalidate() { state.result=null; state.analysis=""; state.error=""; state.analysisError=""; }
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
      <button type="button" class="toggle" data-toggle="${m.id}" aria-label="${chosen ? "Убрать":"Добавить"} ${m.id}" aria-pressed="${chosen}" ${state.busy || reasons.length ? "disabled":""}>${chosen ? "✓":"+"}</button>
      <div class="measure-content"><div class="measure-meta"><span class="mono">${m.id}</span><span>${esc(m.direction)}</span><span class="badge">${m.scope}</span></div>
      <h3>${esc(effects)}</h3><p class="fine-print">Задержка ${m.lag} кв. · Реализуется ${(8-m.lag)/8*100}% эффекта</p>
      <div class="measure-bottom">${m.scope === "Район" ? `<label>Район <select data-district="${m.id}" aria-label="Район для ${m.id}" ${state.busy ? "disabled":""}>${Object.keys(state.data.districts).map((d) => `<option ${d===target ? "selected":""}>${esc(d)}</option>`).join("")}</select></label>` : "<span>Во всех 5 районах</span>"}<span class="cost">${m.cost} <small>у.е.</small></span></div>
      ${reasons.length ? `<p class="fine-print">${esc(reasons.join(" "))}</p>`:""}</div></article>`;
  }).join("");
}
function renderDistricts() {
  $("district-state").textContent=state.result ? "После 8 кварталов":"Исходные данные";
  $("districts").innerHTML=Object.entries(state.data.districts).map(([name,d]) => {
    const result=state.result?.districts[name], values=result?.after || d.indicators;
    const critical=Object.values(values).some((v) => v<40);
    return `<article class="district ${critical ? "critical":""}"><div class="district-heading"><h3>${esc(name)}</h3><span class="zone">${critical ? "ВНИМАНИЕ":"НОРМА"}</span></div>
      <p class="fine-print">Население: ${Math.round(d.population_share*100)}% · Индекс: ${fmt(state.data.baseline.districts[name])}${result ? ` → ${fmt(result.d_after)}`:""}</p>
      <div class="indicators">${Object.entries(values).map(([k,v]) => {
        const info=state.data.indicator_info[k], delta=result?.deltas[k] || 0;
        return `<div class="metric ${v<40 ? "critical":""}"><div class="metric-heading"><span title="${esc(info.description)}">${k} · ${esc(info.label)}</span><span class="metric-value">${result ? `${fmt(d.indicators[k])} → `:""}${fmt(v)}</span></div>
        <div class="metric-track" role="progressbar" aria-label="${esc(name)}: ${k}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"><div class="metric-fill" style="--value:${v}%"></div></div>
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
function render() {
  if (!state.data) return;
  renderFilters(); renderMeasures(); renderDistricts();
  const selected=getSelected(), errors=validationErrors(selected), limit=state.data.rules.budget_limit;
  const budget=selected.reduce((sum,s) => sum+state.data.measures.find((m) => m.id===s.id).cost,0);
  $("budget-value").textContent=`${budget} / ${limit} у.е.`;
  $("budget-fill").style.width=`${budget/limit*100}%`;
  $("budget-bar").setAttribute("aria-valuenow",budget);
  $("budget-note").textContent=`Доступно ещё ${limit-budget} у.е.`;
  $("decision-count").textContent=selected.length;
  $("decision-slots").innerHTML=Array.from({length:5},(_,i) => `<span class="${i<selected.length ? "filled":""}"></span>`).join("");
  $("selection-note").textContent=errors.join(" ") || "Пять решений готовы к расчёту.";
  $("reset").hidden=!selected.length; $("reset").disabled=state.busy;
  $("reference").disabled=state.busy;
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
async function analyze() {
  state.analysisError="";
  try { state.analysis=(await api("/api/analyze",{selected_measures:getSelected()})).analysis; }
  catch(e) { state.analysisError=`Расчёт сохранён. AI-анализ недоступен: ${e.message}`; }
}
$("filters").addEventListener("click",(e) => {
  const b=e.target.closest("[data-category]"); if (!b) return;
  state.category=b.dataset.category; renderFilters(); renderMeasures();
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
  try { state.result=await api("/api/simulate",{selected_measures:getSelected()}); render(); await analyze(); }
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
    state.data=await api("/api/data"); state.error=""; render();
  } catch(e) { $("error").hidden=false; $("error").textContent=e.message; $("retry-data").hidden=false; }
}
$("retry-data").addEventListener("click",initialize);
initialize();
