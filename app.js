let stages = [], currentUser = null, isRegister = false, recoveryState = { balance_half_days: 0, earned_half_days: 0, adjustment_half_days: 0 }, cumulativeAdjustment = 0;
const body = document.querySelector("#stages-body"), dialog = document.querySelector("#stage-dialog"), form = document.querySelector("#stage-form"), dateFormat = new Intl.DateTimeFormat("fr-FR");
const api = async (path, options = {}) => { const response = await fetch(path, { cache:"no-store", credentials:"same-origin", headers:{"Content-Type":"application/json", ...(options.headers || {})}, ...options }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Une erreur est survenue."); return data; };
const addMonths = (dateString, months) => { const d = new Date(`${dateString}T12:00:00`); d.setMonth(d.getMonth() + months); return d; };
const showDate = date => dateFormat.format(date instanceof Date ? date : new Date(`${date}T12:00:00`));
const showMonth = date => { const value = date instanceof Date ? date : new Date(`${date}T12:00:00`); return `${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`; };
const badgeClass = status => ({"Terminé":"termine","Pas payé":"non-paye","Pas commencé":"pas-commence","En cours":"en-cours","En cours de paiement":"paiement"}[status] || "");
const escapeHtml = value => { const node = document.createElement("div"); node.textContent = value; return node.innerHTML; };

async function loadStages() {
  stages = await api("/api/stages");
  render();
  await loadCumulativeAdjustment();
  await loadRecovery();
}
function updateMetrics() { const count = value => stages.filter(stage => stage.status === value).length; document.querySelector("#count-current").textContent=count("En cours de paiement"); document.querySelector("#count-finished").textContent=count("Terminé"); document.querySelector("#count-not-started").textContent=count("Pas commencé"); document.querySelector("#count-unpaid").textContent=count("Pas payé"); }
function automaticCumulative() {
  const duration = notes => {
    const match = String(notes || "").match(/(\d+(?:[.,]\d+)?)\s*h\b/i);
    return match ? Number(match[1].replace(",", ".")) : 0;
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eligible = stages
    .filter(stage => stage.status === "Pas payé" || stage.status === "Pas commencé")
    .map(stage => ({ ...stage, hours: duration(stage.notes) }))
    .filter(stage => stage.hours > 0 && stage.hours < 18)
    .sort((a, b) => a.start.localeCompare(b.start));
  const active = eligible.filter(stage => addMonths(stage.start, 12) >= today);
  const first = active[0];
  const cutoff = first ? addMonths(first.start, 12) : null;
  const cycle = first ? active.filter(stage => addMonths(stage.start, 0) <= cutoff) : [];
  return cycle.reduce((sum, stage) => sum + stage.hours, 0);
}
function updateCumulative() {
  const total = Math.max(0, automaticCumulative() + cumulativeAdjustment);
  const formatted = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(total);
  document.querySelector("#cumul-total").textContent = formatted + " h";
  document.querySelector("#cumul-bar").style.width = Math.min(total / 35 * 100, 100) + "%";
  const alert = document.querySelector("#cumul-alert");
  if (total > 35) {
    alert.hidden = false;
    alert.textContent = "Alerte : le cumul dépasse 35 h (" + formatted + " h).";
  } else {
    alert.hidden = true;
  }
}
async function loadCumulativeAdjustment() {
  try {
    const data = await api("/api/cumulative-adjustment");
    cumulativeAdjustment = Number(data.adjustment_hours) || 0;
    updateCumulative();
  } catch (error) {
    const alert = document.querySelector("#cumul-alert");
    alert.hidden = false;
    alert.textContent = "Impossible de charger le réglage manuel du cumul : " + error.message;
  }
}
function openCumulativeEditor() {
  const total = Math.max(0, automaticCumulative() + cumulativeAdjustment);
  document.querySelector("#cumul-hours").value = Number(total.toFixed(2));
  document.querySelector("#cumul-edit-status").textContent = "";
  document.querySelector("#cumul-edit-dialog").showModal();
}
async function saveCumulativeEdit(event) {
  event.preventDefault();
  const input = document.querySelector("#cumul-hours");
  const status = document.querySelector("#cumul-edit-status");
  const button = document.querySelector("#save-cumul-edit");
  const desired = Number(input.value);
  if (!Number.isFinite(desired) || desired < 0 || desired > 10000) {
    status.className = "import-status error";
    status.textContent = "Saisis une valeur entre 0 et 10 000 heures.";
    return;
  }
  button.disabled = true;
  try {
    const data = await api("/api/cumulative-adjustment", { method:"POST", body:JSON.stringify({ adjustment_hours: desired - automaticCumulative() }) });
    cumulativeAdjustment = Number(data.adjustment_hours) || 0;
    updateCumulative();
    document.querySelector("#cumul-edit-dialog").close();
  } catch (error) {
    status.className = "import-status error";
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
function renderRecovery() {
  const halfDays = recoveryState.balance_half_days || 0;
  const days = halfDays / 2;
  const amount = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(days);
  document.querySelector("#recovery-total").textContent = amount + (days === 1 ? " jour" : " jours");
  document.querySelector("#recovery-take").disabled = halfDays < 1;
}
async function loadRecovery() {
  const status = document.querySelector("#recovery-status");
  try {
    recoveryState = await api("/api/recovery");
    renderRecovery();
    status.hidden = true;
  } catch (error) {
    status.textContent = error.message;
    status.hidden = false;
  }
}
async function changeRecovery(action) {
  const buttons = [document.querySelector("#recovery-add"), document.querySelector("#recovery-take")];
  buttons.forEach(button => { button.disabled = true; });
  try {
    recoveryState = await api("/api/recovery", { method: "POST", body: JSON.stringify({ action }) });
    renderRecovery();
    document.querySelector("#recovery-status").hidden = true;
  } catch (error) {
    const status = document.querySelector("#recovery-status");
    status.textContent = error.message;
    status.hidden = false;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
    renderRecovery();
  }
}
function visibleStages() { const term=document.querySelector("#search").value.trim().toLowerCase(), status=document.querySelector("#filter-status").value, start=document.querySelector("#filter-from").value, end=document.querySelector("#filter-to").value, year=document.querySelector("#filter-year").value; return stages.filter(s=>s.name.toLowerCase().includes(term)&&(!status||s.status===status)&&(!start||s.start>=start)&&(!end||s.start<=end)&&(!year||s.start.startsWith(year))); }
function render() { const displayed=visibleStages(); body.innerHTML=displayed.map(s=>`<tr><td class="stage-name">${escapeHtml(s.name)}</td><td><span class="badge ${badgeClass(s.status)}">${escapeHtml(s.status)}</span></td><td class="date">${showDate(s.start)}</td><td class="date">${showDate(s.end)}</td><td class="date">${showMonth(addMonths(s.start,1))}</td><td class="date">${showMonth(addMonths(s.start,7))}</td><td class="notes">${escapeHtml(s.notes||"—")}</td><td>${s.attachment?`<a class="attachment-link" href="${encodeURI(s.attachment)}" target="_blank" rel="noopener">Ouvrir</a>`:"—"}</td><td><div class="row-actions"><button class="small-button" data-edit="${s.id}">Modifier</button><button class="small-button danger" data-delete="${s.id}">Supprimer</button></div></td></tr>`).join(""); document.querySelector("#empty-state").hidden=displayed.length!==0; updateMetrics(); updateCumulative(); }
function openForm(stage) { form.reset(); document.querySelector("#import-status").textContent=""; document.querySelector("#attachment-status").textContent=""; document.querySelector("#stage-id").value=stage?.id||""; document.querySelector("#dialog-title").textContent=stage?"Modifier le stage":"Ajouter un stage"; if(stage) for(const [key,id] of [["name","stage-name"],["status","stage-status"],["start","stage-start"],["end","stage-end"],["notes","stage-notes"]]) document.querySelector(`#${id}`).value=stage[key]; dialog.showModal(); }
function showApp(user) { currentUser=user; document.querySelector("#current-user").textContent=user.email; document.querySelector("#admin-panel").hidden=!user.is_admin; document.querySelector("#auth-screen").hidden=true; document.querySelector("#app-screen").hidden=false; loadStages().catch(() => { body.innerHTML=""; document.querySelector("#empty-state").hidden=false; }); }
async function session() { try { showApp(await api("/api/me")); } catch { document.querySelector("#auth-screen").hidden=false; document.querySelector("#app-screen").hidden=true; } }
async function uploadAttachment(id) { const file=document.querySelector("#stage-attachment").files[0]; if(!file)return; const status=document.querySelector("#attachment-status"); status.textContent="Envoi de la piece jointe..."; const data=new FormData();data.append("file",file);const response=await fetch(`/api/stages/${id}/attachment`,{method:"POST",body:data,credentials:"same-origin"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Envoi impossible.");status.className="import-status success";status.textContent="Piece jointe enregistree."; }
function openStats() { const today=new Date();today.setHours(0,0,0,0); const days=stages.reduce((total,s)=>total+Math.max(1,Math.round((new Date(`${s.end}T12:00:00`)-new Date(`${s.start}T12:00:00`))/86400000)+1),0); const next=stages.map(s=>({name:s.name,date:addMonths(s.start,1)})).filter(s=>s.date>=today).sort((a,b)=>a.date-b.date)[0]; document.querySelector("#stats-days").textContent=days;document.querySelector("#stats-finished").textContent=stages.filter(s=>s.status==="Terminé").length;document.querySelector("#stats-total").textContent=stages.length;document.querySelector("#stats-payment").textContent=next?`${next.name} · ${showMonth(next.date)}`:"Aucun paiement à venir";document.querySelector("#stats-dialog").showModal(); }
async function loadUsers() { const users=await api("/api/admin/users"); document.querySelector("#users-body").innerHTML=users.map(user=>`<tr><td>${escapeHtml(user.email)}</td><td>${user.stage_count}</td><td><div class="row-actions"><button class="small-button" data-reset-user="${user.id}" data-user-email="${escapeHtml(user.email)}">Mot de passe</button>${user.id===currentUser.id?"":`<button class="small-button danger" data-delete-user="${user.id}" data-user-email="${escapeHtml(user.email)}">Supprimer</button>`}</div></td></tr>`).join(""); }
async function openAdmin() { const status=document.querySelector("#admin-status"); status.className="admin-status";status.textContent="Chargement…";document.querySelector("#admin-dialog").showModal();try{await loadUsers();status.textContent="";}catch(error){status.className="admin-status error";status.textContent=error.message;} }

document.querySelector("#auth-form").addEventListener("submit",async e=>{e.preventDefault();const status=document.querySelector("#auth-status"),button=document.querySelector("#auth-submit");status.className="import-status";status.textContent="Connexion…";button.disabled=true;try{showApp(await api(isRegister?"/api/register":"/api/login",{method:"POST",body:JSON.stringify({email:document.querySelector("#auth-email").value,password:document.querySelector("#auth-password").value})}));}catch(error){status.className="import-status error";status.textContent=error.message;}finally{button.disabled=false;}});
document.querySelector("#auth-toggle").addEventListener("click",()=>{isRegister=!isRegister;document.querySelector("#auth-title").textContent=isRegister?"Créer mon compte":"Suivi de mes stages";document.querySelector("#auth-description").textContent=isRegister?"Renseigne ton e-mail et choisis un mot de passe d’au moins 8 caractères.":"Connecte-toi pour retrouver ton suivi personnel.";document.querySelector("#auth-submit").textContent=isRegister?"Créer mon compte":"Se connecter";document.querySelector("#auth-toggle").textContent=isRegister?"J’ai déjà un compte":"Je n’ai pas encore de compte";document.querySelector("#auth-status").textContent="";});
document.querySelector("#logout").addEventListener("click",async()=>{await api("/api/logout",{method:"POST"});currentUser=null;session();}); document.querySelector("#add-stage").addEventListener("click",()=>openForm()); document.querySelector("#close-dialog").addEventListener("click",()=>dialog.close());document.querySelector("#cancel-dialog").addEventListener("click",()=>dialog.close());document.querySelector("#admin-panel").addEventListener("click",openAdmin);document.querySelector("#close-admin").addEventListener("click",()=>document.querySelector("#admin-dialog").close());document.querySelector("#stats-panel").addEventListener("click",openStats);document.querySelector("#close-stats").addEventListener("click",()=>document.querySelector("#stats-dialog").close());document.querySelector("#password-panel").addEventListener("click",()=>document.querySelector("#password-dialog").showModal());document.querySelector("#close-password").addEventListener("click",()=>document.querySelector("#password-dialog").close());
["search","filter-status","filter-from","filter-to","filter-year"].forEach(id=>document.querySelector(`#${id}`).addEventListener(id==="search"?"input":"change",render));document.querySelector("#clear-filters").addEventListener("click",()=>{["search","filter-status","filter-from","filter-to","filter-year"].forEach(id=>document.querySelector(`#${id}`).value="");render();});
body.addEventListener("click",async e=>{const id=e.target.dataset.edit||e.target.dataset.delete;if(!id)return;if(e.target.dataset.edit)openForm(stages.find(s=>String(s.id)===id));if(e.target.dataset.delete&&confirm("Supprimer ce stage ?")){await api(`/api/stages/${id}`,{method:"DELETE"});await loadStages();}});
document.querySelector("#users-body").addEventListener("click",async e=>{const id=e.target.dataset.resetUser||e.target.dataset.deleteUser;if(!id)return;const email=e.target.dataset.userEmail;if(e.target.dataset.resetUser){const password=prompt(`Nouveau mot de passe pour ${email} (8 caractères minimum) :`);if(password===null)return;try{await api(`/api/admin/users/${id}/password`,{method:"POST",body:JSON.stringify({password})});alert("Mot de passe modifié.");}catch(error){alert(error.message);}}else if(confirm(`Supprimer définitivement le compte ${email} et ses stages ?`)){try{await api(`/api/admin/users/${id}`,{method:"DELETE"});await loadUsers();}catch(error){alert(error.message);}}});
document.querySelector("#stage-pdf").addEventListener("change",async e=>{const file=e.target.files[0];if(!file)return;const message=document.querySelector("#import-status");message.textContent="Lecture du PDF...";try{const data=new FormData();data.append("pdf",file);const r=await fetch("/api/extract-pdf",{method:"POST",body:data,cache:"no-store"});const x=await r.json();if(!r.ok)throw new Error(x.error);for(const [key,id]of[["name","stage-name"],["start","stage-start"],["end","stage-end"],["notes","stage-notes"]])document.querySelector(`#${id}`).value=x[key]||"";message.className="import-status success";message.textContent="PDF lu : verifie puis enregistre.";}catch(error){message.className="import-status error";message.textContent=error.message;}});
form.addEventListener("submit",async e=>{e.preventDefault();const id=document.querySelector("#stage-id").value;const stage={name:document.querySelector("#stage-name").value.trim(),status:document.querySelector("#stage-status").value,start:document.querySelector("#stage-start").value,end:document.querySelector("#stage-end").value,notes:document.querySelector("#stage-notes").value.trim()};if(stage.end<stage.start)return alert("La date de fin doit \u00eatre post\u00e9rieure au d\u00e9but.");const endpoint=id?`/api/stages/${id}`:"/api/stages";const saved=await api(endpoint,{method:id?"PUT":"POST",body:JSON.stringify(stage)});if(!id&&saved.id)await uploadAttachment(saved.id);else if(id)await uploadAttachment(id);dialog.close();await loadStages();});
document.querySelector("#password-form").addEventListener("submit",async e=>{e.preventDefault();const status=document.querySelector("#password-status"),current_password=document.querySelector("#current-password").value,new_password=document.querySelector("#new-password").value,confirm_password=document.querySelector("#confirm-password").value;if(new_password!==confirm_password){status.className="import-status error";status.textContent="Les nouveaux mots de passe ne correspondent pas.";return;}try{await api("/api/password",{method:"POST",body:JSON.stringify({current_password,new_password})});status.className="import-status success";status.textContent="Mot de passe modifié.";e.target.reset();}catch(error){status.className="import-status error";status.textContent=error.message;}});
document.querySelector("#rules-panel").addEventListener("click", () => document.querySelector("#rules-dialog").showModal());
document.querySelector("#close-rules").addEventListener("click", () => document.querySelector("#rules-dialog").close());
document.querySelector("#edit-cumul").addEventListener("click", openCumulativeEditor);
document.querySelector("#close-cumul-edit").addEventListener("click", () => document.querySelector("#cumul-edit-dialog").close());
document.querySelector("#cumul-edit-form").addEventListener("submit", saveCumulativeEdit);
document.querySelector("#recovery-add").addEventListener("click", () => changeRecovery("add"));
document.querySelector("#recovery-take").addEventListener("click", () => changeRecovery("take"));
session();
