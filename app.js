const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const configured = !/PEGA_AQUI/.test(window.SUPABASE_URL || "PEGA_AQUI");
const db = configured ? supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;

const state = { isAdmin: false, code: null, salon: null, people: [], marks: {}, gender: "F" };
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- utilidades ---------- */
function toast(t) {
  const el = $("#toast"); el.textContent = t; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2200);
}
function show(id) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  $("#" + id).classList.add("active");
  window.scrollTo(0, 0);
}
function waveText() { // letras en movimiento
  $$(".wave").forEach(h => {
    if (h.dataset.w === h.textContent) return;
    const t = h.textContent;
    h.innerHTML = [...t].map((c, i) => `<span style="animation-delay:${i * 0.08}s">${c === " " ? "&nbsp;" : c}</span>`).join("");
    h.dataset.w = t;
  });
}
function need() {
  if (configured) return true;
  toast("Falta pegar las credenciales en config.js");
  return false;
}
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- navegación ---------- */
document.addEventListener("click", e => {
  const go = e.target.closest("[data-go]"); if (go) show(go.dataset.go);
  if (e.target.closest("[data-close]")) $$(".modal").forEach(m => m.classList.remove("open"));
});

/* ---------- acceso por código ---------- */
$("#codeBtn").onclick = async () => {
  if (!need()) return;
  const code = $("#codeInput").value.trim().toUpperCase();
  const { data, error } = await db.rpc("salon_login", { p_code: code });
  if (error || !data?.length) { $("#codeMsg").textContent = "Código incorrecto. Revisa e inténtalo de nuevo."; return; }
  $("#codeMsg").textContent = "";
  state.isAdmin = false; state.code = code;
  openRoom(data[0]);
};

/* ---------- login administrador ---------- */
$("#loginBtn").onclick = async () => {
  if (!need()) return;
  const { error } = await db.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#pass").value });
  if (error) { $("#loginMsg").textContent = "Correo o contraseña incorrectos."; return; }
  $("#loginMsg").textContent = "";
  state.isAdmin = true; loadSalons();
};
$("#logoutBtn").onclick = async () => { await db?.auth.signOut(); state.isAdmin = false; show("welcome"); };

async function loadSalons() {
  const { data } = await db.from("salons").select("*").order("id");
  $("#salonGrid").innerHTML = data.map(s =>
    `<button class="door" data-id="${s.id}" aria-label="${esc(s.name)}"><img src="img/${s.icon}.jpg" alt="${esc(s.name)}"></button>`).join("");
  $$(".door").forEach((b, i) => b.onclick = () => openRoom(data[i]));
  show("salonsScreen"); waveText();
}

/* ---------- salón ---------- */
async function openRoom(salon) {
  state.salon = salon;
  $("#roomTitle").textContent = salon.name;
  $("#dayInput").value = today();
  $$(".admin-only").forEach(el => el.classList.toggle("hidden", !state.isAdmin));
  show("roomScreen"); waveText();
  await refresh();
}
$("#backBtn").onclick = () => state.isAdmin ? loadSalons() : show("welcome");
$("#dayInput").onchange = loadMarks;

async function refresh() {
  if (state.isAdmin) {
    const { data } = await db.from("people").select("*").eq("salon_id", state.salon.id).order("role", { ascending: false }).order("name");
    state.people = data || [];
  } else {
    const { data } = await db.rpc("salon_people", { p_code: state.code });
    state.people = data || [];
  }
  await loadMarks();
}
async function loadMarks() {
  const day = $("#dayInput").value;
  let rows;
  if (state.isAdmin) rows = (await db.from("attendance").select("*").eq("salon_id", state.salon.id).eq("day", day)).data;
  else rows = (await db.rpc("salon_attendance", { p_code: state.code, p_day: day })).data;
  state.marks = {}; (rows || []).forEach(r => state.marks[r.person_id] = r.status);
  render();
}

function render() {
  const box = $("#people");
  if (!state.people.length) {
    box.innerHTML = `<p class="empty">Este salón aún no tiene personas.${state.isAdmin ? " Pulsa «Añadir persona» para empezar." : ""}</p>`;
  } else {
    box.innerHTML = state.people.map((p, i) => `
      <div class="person" style="animation-delay:${i * 0.04}s">
        <img src="img/${p.gender === "F" ? "mujer" : "varon"}.jpg" alt="">
        <div class="info"><b>${esc(p.name)}</b><small>${p.role === "teacher" ? (p.gender === "F" ? "Docente" : "Docente") : (p.gender === "F" ? "Estudiante" : "Estudiante")}</small></div>
        <div class="marks">
          ${[["P", "Presente"], ["T", "Tarde"], ["F", "Falta"]].map(([s, l]) =>
            `<button class="mark ${state.marks[p.id] === s ? "on" : ""}" data-s="${s}" data-id="${p.id}">${l}</button>`).join("")}
        </div>
        ${state.isAdmin ? `<button class="del" data-del="${p.id}" title="Eliminar" aria-label="Eliminar ${esc(p.name)}">🗑️</button>` : ""}
      </div>`).join("");
  }
  const c = s => Object.values(state.marks).filter(v => v === s).length;
  $("#summary").innerHTML = `<span class="chip">Presentes: ${c("P")}</span><span class="chip">Tarde: ${c("T")}</span><span class="chip">Faltas: ${c("F")}</span><span class="chip">Total: ${state.people.length}</span>`;
}

/* llamar lista */
$("#people").addEventListener("click", async e => {
  const m = e.target.closest(".mark");
  if (m) {
    const id = m.dataset.id, s = m.dataset.s, day = $("#dayInput").value;
    const { error } = state.isAdmin
      ? await db.from("attendance").upsert({ person_id: id, salon_id: state.salon.id, day, status: s }, { onConflict: "person_id,day" })
      : await db.rpc("mark_attendance", { p_code: state.code, p_person: id, p_day: day, p_status: s });
    if (error) return toast("No se pudo guardar");
    state.marks[id] = s; render(); return;
  }
  const d = e.target.closest("[data-del]");
  if (d && confirm("¿Eliminar a esta persona? También se borrará su asistencia.")) {
    const { error } = await db.from("people").delete().eq("id", d.dataset.del);
    if (error) return toast("No se pudo eliminar");
    toast("Persona eliminada"); refresh();
  }
});

/* descargar lista (CSV, abre en Excel) */
$("#csvBtn").onclick = () => {
  const day = $("#dayInput").value, lbl = { P: "Presente", T: "Tarde", F: "Falta" };
  const rows = [["Nombre", "Rol", "Género", `Asistencia ${day}`]].concat(state.people.map(p =>
    [p.name, p.role === "teacher" ? "Docente" : "Estudiante", p.gender === "F" ? "Mujer" : "Varón", lbl[state.marks[p.id]] || "Sin marcar"]));
  const csv = "\ufeff" + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${state.salon.name.replace(/\s+/g, "_")}_${day}.csv`; a.click();
  toast("Lista descargada");
};

/* ---------- añadir persona (admin) ---------- */
$("#addBtn").onclick = () => { $("#newName").value = ""; $("#addModal").classList.add("open"); };
$("#genderSeg").onclick = e => {
  const b = e.target.closest(".seg-btn"); if (!b) return;
  $$(".seg-btn").forEach(x => x.classList.toggle("on", x === b)); state.gender = b.dataset.v;
};
$("#saveBtn").onclick = async () => {
  const name = $("#newName").value.trim(); if (!name) return toast("Escribe el nombre");
  const { error } = await db.from("people").insert({ salon_id: state.salon.id, name, gender: state.gender, role: $("#newRole").value });
  if (error) return toast("No se pudo guardar");
  $("#addModal").classList.remove("open"); toast("Persona añadida"); refresh();
};

/* ---------- códigos de acceso (admin) ---------- */
async function loadCodes() {
  const { data } = await db.from("access_codes").select("*").eq("salon_id", state.salon.id).order("created_at");
  $("#codesList").innerHTML = (data || []).map(c =>
    `<div class="code-row"><div><b>${c.code}</b><br><small>${esc(c.label || "")}</small></div>
     <button class="btn btn-ghost small" data-copy="${c.code}">Copiar</button>
     <button class="del" data-rm="${c.id}" aria-label="Borrar código">🗑️</button></div>`).join("") || "<p>Aún no hay códigos.</p>";
}
$("#codesBtn").onclick = () => { $("#codesModal").classList.add("open"); loadCodes(); };
$("#genCode").onclick = async () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const { error } = await db.from("access_codes").insert({ code, salon_id: state.salon.id, label: $("#codeLabel").value.trim() });
  if (error) return toast("No se pudo crear el código");
  $("#codeLabel").value = ""; toast("Código creado"); loadCodes();
};
$("#codesList").addEventListener("click", async e => {
  const cp = e.target.closest("[data-copy]");
  if (cp) { navigator.clipboard?.writeText(cp.dataset.copy); return toast("Código copiado"); }
  const rm = e.target.closest("[data-rm]");
  if (rm && confirm("¿Borrar este código? Quien lo use ya no podrá entrar.")) {
    await db.from("access_codes").delete().eq("id", rm.dataset.rm); loadCodes();
  }
});

/* ---------- inicio ---------- */
waveText();
if (db) db.auth.getSession().then(({ data }) => { if (data.session) { state.isAdmin = true; loadSalons(); } });
