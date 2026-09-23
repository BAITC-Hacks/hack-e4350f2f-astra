"use strict";
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const fmt = (n) => Number(n).toFixed(2);
const signed = (n) => `${n >= 0 ? "+" : ""}${fmt(n)}`;
const state = { data:null, selected:new Set(), targets:{}, category:"Все", result:null,
  busy:false, analysis:"", error:"", analysisError:"", scenarios:{ A:null, B:null } };

const DRAFT_KEY = "akim-selection-v1";
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
      <button type="button" class="toggle" data-toggle="${m.id}" aria-label="${chosen ? "Убрать":"Добавить"} ${m.id}: ${esc(m.name)}" aria-pressed="${chosen}" ${state.busy || reasons.length ? "disabled":""}>${chosen ? "✓":"+"}</button>
      <div class="measure-content"><div class="measure-meta"><span class="mono">${m.id}</span><span>${esc(m.direction)}</span><span class="badge">${m.scope}</span></div>
      <h3>${esc(m.name)}</h3><p class="fine-print">Полный эффект: ${esc(effects)}</p><p class="fine-print">Задержка ${m.lag} кв. · Реализуется ${(8-m.lag)/8*100}% эффекта</p>
      <div class="measure-bottom">${m.scope === "Район" ? `<label>Район <select data-district="${m.id}" aria-label="Район для ${m.id}: ${esc(m.name)}" ${state.busy ? "disabled":""}>${Object.keys(state.data.districts).map((d) => `<option ${d===target ? "selected":""}>${esc(d)}</option>`).join("")}</select></label>` : "<span>Во всех 5 районах</span>"}<span class="cost">${m.cost} <small>у.е.</small></span></div>
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

function renderComparison() {
  const {A, B}=state.scenarios;
  for (const slot of ["A", "B"]) {
    $("save-"+slot).disabled=state.busy || !state.result;
    $("save-"+slot).textContent=state.scenarios[slot] ? `Заменить сценарий ${slot}` : `Сохранить как ${slot}`;
  }
  $("export-scenarios").disabled=!A && !B;
  $("clear-scenarios").disabled=state.busy || (!A && !B);
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
  saveSelection();
  renderFilters(); renderMeasures(); renderDistricts(); renderComparison();
  $("export-report").disabled=state.busy || !state.result;
  $("report-status").textContent="";
  $("print-report").replaceChildren();
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
  return `<header><p class="report-kicker">Астана · Городской симулятор</p><h1>Аким на 5 часов</h1><p>Отчёт по текущему сценарию · Горизонт: 8 кварталов</p></header>
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
    state.data=await api("/api/data"); state.error=""; restoreSelection(); render();
  } catch(e) { $("error").hidden=false; $("error").textContent=e.message; $("retry-data").hidden=false; }
}
$("retry-data").addEventListener("click",initialize);
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
