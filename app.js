// Visitas Dénia: hoy, semana (con arrastre), negocios (ruta, guion y resultado).
// Datos en Supabase (tablas prospectos y plan, solo tu cuenta por RLS). Sin conexión se usa la copia de localStorage
// y las escrituras pendientes se guardan en una cola que se envía al volver la conexión.

const SUPABASE_URL = "https://rnbvfujxvkaulvsxlizq.supabase.co";
const SUPABASE_KEY = "sb_publishable_ofCyI4sX4AO4FixE7ZUQKQ_KvdNdHhS";
const EMAIL_PROPIETARIO = "alexsivera.1999@gmail.com";

const DAY = 864e5, ROW = 26, SLOT = 30, START = 420, END = 1380, DUR = 60;
const REF = new Date(2026, 10, 2).getTime(); // lunes de la semana A
const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const LETRA = ["L", "M", "X", "J", "V", "S", "D"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const CHECK = ["Demo abierta en el móvil", "Horario confirmado en la puerta", "Persona que decide", "Siguiente paso acordado"];
const RES = { visitado: "Visitado", volver: "Volver otro día", no_interesado: "No interesado" };
const CLAVE_CACHE = "visitas.cache.v1";
const CLAVE_COLA = "visitas.cola.v1";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const st = {
  sesion: null,
  listo: false,
  prospectos: [],
  planes: {},            // clave de semana (YYYY-MM-DD del lunes) -> { placements, invertida }
  cola: [],              // escrituras pendientes de enviar
  lunes: lunesDe(new Date()),
  diaSel: (new Date().getDay() + 6) % 7, // día visible en Semana cuando la pantalla es estrecha
  filtro: "todos",
  seleccion: null,
  notas: new Map(),
  fechas: new Map(),
  volver: new Set(),
  busqueda: "",
  aviso: ""
};

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = min => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const clave = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fechaCorta = iso => { const d = new Date(iso.slice(0, 10) + "T12:00"); return `${d.getDate()} ${MESES[d.getMonth()]}`; };
const hoyISO = () => clave(new Date());
const manana = () => clave(new Date(Date.now() + DAY));
const byNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es");
const prospecto = id => st.prospectos.find(p => p.id === id);
const mapsUrl = p => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent((p.direccion || p.nombre) + ", Alicante, España")}`;
const movil = matchMedia("(max-width: 699px)");
const diaDeHoy = () => (new Date().getDay() + 6) % 7;
const minDeAhora = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const telefono = p => { const m = String(p.horario || "").match(/(\+34\s?)?[6-9](?:\s?\d){8}/); return m ? m[0].replace(/\s/g, "") : null; };

// En el login el mensaje se queda en la tarjeta; en el resto de vistas sale como aviso flotante que se va solo.
let temporizadorAviso;
const aviso = t => {
  st.aviso = t;
  const el = document.getElementById("msg");
  if (el) { el.textContent = t; return; }
  const toast = document.getElementById("toast");
  if (!toast || !t) return;
  toast.textContent = t;
  toast.classList.add("visible");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => toast.classList.remove("visible"), 3500);
};

function lunesDe(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function indice(l) { return Math.round((l.getTime() - REF) / (7 * DAY)); }
function planDe(l = st.lunes) { return st.planes[clave(l)] || { placements: [], invertida: false }; }
function paridad(l = st.lunes) {
  const auto = ((indice(l) % 2) + 2) % 2;             // 0 = semana A, 1 = semana B
  return planDe(l).invertida ? 1 - auto : auto;
}

// Bloques fijos de cada semana: curso, gimnasio, viajes.
function bloques(par) {
  const b = [];
  for (let d = 0; d < 5; d++) b.push({ dia: d, ini: 1020, fin: 1260, txt: "Curso · Xàbia", fijo: true });
  const gym = par === 0 ? [1, 2, 4, 5] : [0, 1, 3, 4];
  gym.forEach(d => b.push({ dia: d, ini: 510, fin: 585, txt: "Gimnasio", fijo: true }));
  if (par === 0) {
    b.push({ dia: 0, ini: 750, fin: 810, txt: "Vuelta de Valencia", fijo: true });
  } else {
    b.push({ dia: 4, ini: 1290, fin: 1350, txt: "Salida a Valencia", fijo: true });
    b.push({ dia: 5, ini: START, fin: END, txt: "Fin de semana en Valencia", fijo: true });
    b.push({ dia: 6, ini: START, fin: END, txt: "Fin de semana en Valencia", fijo: true });
  }
  return b;
}

// Abierto a la hora de inicio según el horario guardado (semana: [[inicio, fin], ...] por día, 0 = lunes).
function estado(p, dia, min) {
  if (!p || !p.semana) return { ok: false, texto: "sin horario" };
  const tramos = p.semana[dia] || [];
  const ok = tramos.some(([a, b]) => min >= a && min < b);
  return { ok, texto: ok ? "abierto" : "cerrado" };
}

// Texto corto para una visita cerrada: cuándo abre ese día, si abre.
function cuandoAbre(p, dia, min) {
  if (!p || !p.semana) return "sin horario verificado";
  const tramos = p.semana[dia] || [];
  if (!tramos.length) return "no abre ese día";
  const prox = tramos.find(([a]) => a > min);
  return prox ? `abre ${fmt(prox[0])}` : "ya ha cerrado ese día";
}

// Estado en este momento, para la ficha.
function estadoAhora(p) {
  if (!p.semana) return { clase: "", texto: "Sin horario verificado" };
  const dia = diaDeHoy(), min = minDeAhora(), tramos = p.semana[dia] || [];
  const abierto = tramos.find(([a, b]) => min >= a && min < b);
  if (abierto) return { clase: "ok", texto: `Abierto ahora · cierra ${fmt(abierto[1])}` };
  const prox = tramos.find(([a]) => a > min);
  return { clase: "no", texto: prox ? `Cerrado ahora · abre ${fmt(prox[0])}` : "Cerrado por hoy" };
}

// Primera visita colocada en la semana actual para un negocio (para la lista).
function colocadoEstaSemana(id) {
  const plan = st.planes[clave(lunesDe(new Date()))];
  const p = plan && plan.placements.filter(x => x.prospectoId === id).sort((a, b) => a.dia - b.dia || a.inicio - b.inicio)[0];
  return p ? `${LETRA[p.dia]} ${fmt(p.inicio)}` : null;
}

function pendientes() {
  const n = st.cola.length;
  return n ? `<span class="chip pendiente" title="Se enviará al recuperar la conexión">${n} sin sincronizar</span>` : "";
}

function conflicto(dia, ini, fin) {
  for (const b of bloques(paridad())) if (b.dia === dia && b.ini < fin && ini < b.fin) return b.txt;
  for (const p of planDe().placements) {
    if (p.dia === dia && p.inicio < fin && ini < p.inicio + p.duracion) return (prospecto(p.prospectoId) || {}).nombre || "otro negocio";
  }
  return null;
}

// ---------- Persistencia local y cola de escrituras ----------

function guardarCache() {
  try { localStorage.setItem(CLAVE_CACHE, JSON.stringify({ prospectos: st.prospectos, planes: st.planes })); } catch (e) { /* sin almacenamiento */ }
}
function cargarCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE_CACHE) || "null");
    if (c) { st.prospectos = c.prospectos || []; st.planes = c.planes || {}; }
  } catch (e) { /* caché corrupta: se ignora */ }
  try { st.cola = JSON.parse(localStorage.getItem(CLAVE_COLA) || "[]"); } catch (e) { st.cola = []; }
}
function guardarCola() {
  try { localStorage.setItem(CLAVE_COLA, JSON.stringify(st.cola)); } catch (e) { /* sin almacenamiento */ }
}

// Una operación pendiente por documento: la última gana.
function encolar(op) {
  st.cola = st.cola.filter(o => !(o.tipo === op.tipo && o.clave === op.clave));
  st.cola.push(op);
  guardarCola();
  vaciarCola();
}

let vaciando = false, errorAvisado = false;
async function vaciarCola() {
  if (vaciando || !st.sesion || !navigator.onLine) return;
  vaciando = true;
  try {
    while (st.cola.length) {
      const op = st.cola[0];
      const ahora = new Date().toISOString();
      const { error } = op.tipo === "prospecto"
        ? await sb.from("prospectos").update({ data: op.data, updated_at: ahora }).eq("id", op.id)
        : await sb.from("plan").upsert({ semana: op.semana, placements: op.placements, invertida: op.invertida, updated_at: ahora });
      // Se avisa una vez; el chip "sin sincronizar" de cada vista recuerda lo pendiente.
      if (error) { if (!errorAvisado) aviso("No se pudo guardar; se reintentará al volver la conexión."); errorAvisado = true; break; }
      errorAvisado = false;
      const idx = st.cola.indexOf(op);
      if (idx >= 0) st.cola.splice(idx, 1);
      guardarCola();
    }
  } finally {
    vaciando = false;
  }
}

// ---------- Lectura desde Supabase ----------

async function cargarDatos() {
  const { data, error } = await sb.from("prospectos").select("id,data");
  if (error) throw error;
  st.prospectos = data.map(r => ({ id: r.id, ...r.data }));
  await cargarPlan(st.lunes);
  guardarCache();
}

async function cargarPlan(l) {
  const k = clave(l);
  if (st.cola.some(o => o.tipo === "plan" && o.clave === k)) return; // lo local pendiente manda
  const { data, error } = await sb.from("plan").select("semana,placements,invertida").eq("semana", k).maybeSingle();
  if (error) return;
  st.planes[k] = data ? { placements: data.placements || [], invertida: !!data.invertida } : (st.planes[k] || { placements: [], invertida: false });
  guardarCache();
}

// ---------- Escrituras ----------

function actualizarProspecto(id, cambios) {
  const p = prospecto(id);
  if (!p) return;
  Object.assign(p, cambios, { actualizadoEn: new Date().toISOString() });
  const data = { ...p };
  delete data.id;
  guardarCache();
  encolar({ tipo: "prospecto", clave: id, id, data });
}

function guardarPlan(lista, invertida = planDe().invertida) {
  const k = clave(st.lunes);
  st.planes[k] = { placements: lista, invertida };
  guardarCache();
  encolar({ tipo: "plan", clave: k, semana: k, placements: lista, invertida });
  render();
}

function colocar(id, col, e) {
  const pr = prospecto(id);
  if (!pr) return;
  const dia = +col.dataset.dia;
  const idx = Math.max(0, Math.floor((e.clientY - col.getBoundingClientRect().top) / ROW));
  const ini = Math.min(START + idx * SLOT, END - DUR), fin = ini + DUR;
  const choque = conflicto(dia, ini, fin);
  if (choque) { aviso(`Hueco ocupado por ${choque}.`); render(); return; }
  const est = estado(pr, dia, ini);
  const nuevo = [...planDe().placements, { id: Math.random().toString(36).slice(2, 10), prospectoId: id, dia, inicio: ini, duracion: DUR }];
  st.seleccion = null;
  guardarPlan(nuevo);
  aviso(`${pr.nombre}: ${DIAS[dia]} ${fmt(ini)} — ${est.texto}.`);
}

// ---------- Vistas ----------

let vistaAnterior = "";
function render() {
  if (!st.listo) return;
  if (!st.sesion && navigator.onLine) return renderLogin();
  tabs.hidden = false;
  const r = ruta();
  // La animación de entrada solo al cambiar de pantalla, no en cada repintado.
  const vista = `${r.vista}/${r.id || ""}`;
  app.classList.toggle("entra", vista !== vistaAnterior);
  vistaAnterior = vista;
  const actual = r.vista === "negocio" ? "negocios" : r.vista;
  tabs.querySelectorAll("button").forEach(b => {
    if (b.dataset.ir === actual) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (r.vista === "semana") renderSemana();
  else if (r.vista === "negocios") renderNegocios();
  else if (r.vista === "negocio") renderNegocio(r.id);
  else renderHoy();
}

function ruta() {
  const [vista, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { vista: vista || "hoy", id };
}

function renderLogin() {
  tabs.hidden = true;
  app.innerHTML = `
    <section class="login">
      <header class="login-marca">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
        <p class="kicker">Dénia · Beniarbeig</p>
        <h1>Visitas</h1>
      </header>
      <div class="login-cuerpo">
        <h2>Entrar</h2>
        <p class="muted">Te enviamos un enlace al correo. Ábrelo desde este mismo móvil.</p>
        <input type="email" id="correo" value="${EMAIL_PROPIETARIO}" autocomplete="email" aria-label="Correo">
        <button type="button" class="boton principal" data-accion="entrar">Enviar enlace</button>
        <p class="msg" id="msg">${esc(st.aviso)}</p>
      </div>
    </section>`;
}

function renderHoy() {
  const ahora = new Date();
  const lun = lunesDe(ahora);
  if (clave(lun) !== clave(st.lunes)) { st.lunes = lun; cargarPlan(lun).then(render).catch(() => {}); }
  const par = paridad(), dia = (ahora.getDay() + 6) % 7, min = ahora.getHours() * 60 + ahora.getMinutes();
  const items = [
    ...bloques(par).filter(b => b.dia === dia).map(b => ({ ini: b.ini, fin: b.fin, txt: b.txt, fijo: true })),
    ...planDe().placements.filter(p => p.dia === dia).map(p => ({ ini: p.inicio, fin: p.inicio + p.duracion, id: p.prospectoId, fijo: false }))
  ].sort((a, b) => a.ini - b.ini);
  const siguiente = items.find(i => i.fin > min);
  const visitas = items.filter(i => !i.fijo);
  const hechas = visitas.filter(i => (prospecto(i.id) || {}).ultimaVisita === hoyISO()).length;
  const marcaAhora = `<li class="fila-hora ahora" aria-label="Ahora"><time>${fmt(min)}</time><span class="linea-ahora">Ahora</span></li>`;
  let filas = items.map(i => {
    const clases = ["tarjeta", i.fijo ? "fijo" : "visita", i.fin <= min ? "pasado" : "", i === siguiente ? "siguiente" : ""].join(" ");
    const hora = `<time>${fmt(i.ini)}</time>`;
    const etiqueta = i === siguiente ? `<p class="etiqueta">${i.ini <= min ? "En curso" : "Siguiente"}</p>` : "";
    if (i.fijo) return `<li class="fila-hora">${hora}<div class="${clases}">${etiqueta}<h2>${esc(i.txt)}</h2><p class="meta">${fmt(i.ini)}–${fmt(i.fin)}</p></div></li>`;
    const p = prospecto(i.id);
    if (!p) return "";
    const e = estado(p, dia, i.ini);
    return `<li class="fila-hora">${hora}<div class="${clases}">
      ${etiqueta}
      <h2>${esc(p.nombre)}</h2>
      <p class="meta">${esc(p.tipo)} · ${esc(p.zona)} · ${fmt(i.ini)}–${fmt(i.fin)}</p>
      <p class="estado-visita"><span class="chip ${e.ok ? "ok" : "no"}">${e.ok ? "abierto a esa hora" : "cerrado a esa hora"}</span>${e.ok ? "" : `<small>${cuandoAbre(p, dia, i.ini)}</small>`}</p>
      <div class="acciones">
        <a class="enlace-boton" href="${mapsUrl(p)}" target="_blank" rel="noopener">Cómo llegar</a>
        <a class="boton" href="#negocio/${esc(p.id)}">Ficha</a>
      </div>
    </div></li>`;
  });
  if (items.length) {
    const pos = siguiente ? items.indexOf(siguiente) : items.length;
    if (!siguiente || siguiente.ini > min) filas.splice(pos, 0, marcaAhora);
  }
  const resumen = visitas.length
    ? `${visitas.length} visita${visitas.length > 1 ? "s" : ""} hoy${hechas ? ` · ${hechas} hecha${hechas > 1 ? "s" : ""}` : ""}`
    : "Sin visitas hoy";
  const cuerpo = items.length ? `<ol class="linea-tiempo">${filas.join("")}</ol>` : "";
  const vacio = visitas.length ? "" : `<div class="vacio"><p>No hay visitas colocadas para hoy.</p><a class="boton" href="#semana">Planificar la semana</a></div>`;
  app.innerHTML = `
    <header class="hoy-cab">
      <p class="kicker">${DIAS[dia]} ${ahora.getDate()} ${MESES[ahora.getMonth()]}</p>
      <h1>Hoy</h1>
      <div class="hoy-meta"><span class="chip-semana">Semana ${par === 0 ? "A" : "B"}</span><span class="muted">${resumen}</span>${pendientes()}</div>
    </header>
    ${cuerpo}
    ${vacio}`;
}

function renderSemana() {
  const l = st.lunes, dom = new Date(l.getFullYear(), l.getMonth(), l.getDate() + 6), par = paridad();
  const plan = planDe();
  const actual = clave(l) === clave(lunesDe(new Date()));
  const hoy = actual ? diaDeHoy() : -1;
  const otra = par === 0 ? "B" : "A";
  const negocios = st.prospectos.slice().sort(byNombre).map(p => {
    const n = plan.placements.filter(x => x.prospectoId === p.id).length;
    return `<button type="button" class="neg${st.seleccion === p.id ? " sel" : ""}${n ? " colocado" : ""}" draggable="true" data-neg="${esc(p.id)}" aria-pressed="${st.seleccion === p.id}">
      <b>${esc(p.nombre)}</b><small>${p.semana ? "" : '<span class="sin">sin horario</span> · '}${n ? n + " colocado" + (n > 1 ? "s" : "") : esc(p.zona)}</small>
    </button>`;
  }).join("");

  // En pantalla estrecha se ve un día cada vez, elegido en la tira de días; en ancha, la semana entera.
  const unDia = movil.matches;
  const dias = unDia ? [st.diaSel] : [0, 1, 2, 3, 4, 5, 6];
  const tira = unDia ? `<div class="tira-dias" role="tablist" aria-label="Día">${[0, 1, 2, 3, 4, 5, 6].map(d => {
    const f = new Date(l.getFullYear(), l.getMonth(), l.getDate() + d);
    const puntos = plan.placements.filter(x => x.dia === d)
      .map(x => `<i class="${estado(prospecto(x.prospectoId), d, x.inicio).ok ? "ok" : "no"}"></i>`).join("");
    return `<button type="button" role="tab" class="dia${d === hoy ? " hoy" : ""}" data-accion="dia" data-dia="${d}" aria-selected="${d === st.diaSel}">
      <small>${LETRA[d]}</small><b>${f.getDate()}</b><span class="puntos">${puntos}</span></button>`;
  }).join("")}</div>` : "";

  const alto = (END - START) / SLOT * ROW;
  let tablero = "";
  if (!unDia) {
    tablero += '<div class="cab"></div>';
    for (const d of dias) {
      const f = new Date(l.getFullYear(), l.getMonth(), l.getDate() + d);
      tablero += `<div class="cab${d === hoy ? " hoy" : ""}"><b>${LETRA[d]}</b><small>${f.getDate()}</small></div>`;
    }
  }
  tablero += `<div class="horas" style="height:${alto}px">`;
  for (let h = 8; h <= 22; h++) tablero += `<span style="top:${(h * 60 - START) / SLOT * ROW}px">${h}:00</span>`;
  tablero += "</div>";
  const topDe = min => (min - START) / SLOT * ROW + 1;
  const altoDe = dur => dur / SLOT * ROW - 3;
  const ahora = minDeAhora();
  for (const d of dias) {
    tablero += `<div class="col${st.seleccion ? " objetivo" : ""}${d === hoy ? " hoy" : ""}" data-dia="${d}" style="height:${alto}px">`;
    if (d === hoy && ahora >= START && ahora < END) tablero += `<div class="ahora" style="top:${topDe(ahora)}px" aria-hidden="true"></div>`;
    for (const b of bloques(par).filter(x => x.dia === d)) {
      tablero += `<div class="bloque fijo" style="top:${topDe(b.ini)}px;height:${altoDe(b.fin - b.ini)}px"><strong>${esc(b.txt)}</strong><span>${fmt(b.ini)}–${fmt(b.fin)}</span></div>`;
    }
    for (const p of plan.placements.filter(x => x.dia === d)) {
      const pr = prospecto(p.prospectoId);
      if (!pr) continue;
      const e = estado(pr, d, p.inicio);
      tablero += `<div class="bloque ${e.ok ? "ok" : "no"}" style="top:${topDe(p.inicio)}px;height:${altoDe(p.duracion)}px">
        <a href="#negocio/${esc(pr.id)}"><strong>${esc(pr.nombre)}</strong></a><span>${fmt(p.inicio)} · ${e.ok ? e.texto : e.texto + (pr.semana ? ", " + cuandoAbre(pr, d, p.inicio) : "")}</span>
        <button type="button" class="quitar" data-quitar="${esc(p.id)}" aria-label="Quitar ${esc(pr.nombre)}">×</button></div>`;
    }
    tablero += "</div>";
  }

  const sel = st.seleccion && prospecto(st.seleccion);
  const barraSel = sel
    ? `<div class="seleccion-bar" role="status"><span>Colocando <b>${esc(sel.nombre)}</b>. Toca un hueco${unDia ? " de este día" : ""}.</span><button type="button" class="boton pequeno" data-accion="cancelar-sel">Cancelar</button></div>`
    : "";
  const ayuda = !sel && !plan.placements.length ? `<p class="ayuda">Toca un negocio y después un hueco${unDia ? "" : ", o arrástralo"}.</p>` : "";

  app.innerHTML = `
    <div class="semana-bar">
      <button type="button" class="boton icono-boton" data-accion="semana-prev" aria-label="Semana anterior">‹</button>
      <div class="titulo">
        <strong>Semana ${par === 0 ? "A" : "B"}${plan.invertida ? " <em>cambiada</em>" : ""}</strong>
        <span>${l.getDate()} ${MESES[l.getMonth()]} – ${dom.getDate()} ${MESES[dom.getMonth()]}</span>
      </div>
      <button type="button" class="boton icono-boton" data-accion="semana-next" aria-label="Semana siguiente">›</button>
    </div>
    <div class="semana-opciones">
      ${actual ? "" : '<button type="button" class="enlace" data-accion="semana-hoy">Ir a esta semana</button>'}
      <button type="button" class="enlace" data-accion="invertir">${plan.invertida ? `Volver a semana ${otra}` : `Usar semana ${otra}`}</button>
      ${pendientes()}
    </div>
    ${ayuda}
    <div class="neg-lista">${negocios}</div>
    ${barraSel}
    ${tira}
    <div class="board-wrap${unDia ? " un-dia" : ""}"><div class="board${unDia ? " dia-unico" : ""}">${tablero}</div></div>`;
}

const FILTROS = [["todos", "Todos"], ["pendiente", "Pendientes"], ["volver", "Volver"], ["visitado", "Visitados"], ["no_interesado", "No interesados"]];
const filtroDe = p => p.resultado || "pendiente";

function renderNegocios() {
  const cuenta = f => f === "todos" ? st.prospectos.length : st.prospectos.filter(p => filtroDe(p) === f).length;
  const visitados = cuenta("visitado");
  app.innerHTML = `
    <div class="cabecera"><div><p class="kicker">${st.prospectos.length} negocios · ${visitados} visitado${visitados === 1 ? "" : "s"}</p><h1>Negocios</h1></div>${pendientes()}</div>
    <input class="buscar" id="buscar" type="search" placeholder="Buscar por nombre, tipo o zona" value="${esc(st.busqueda)}" aria-label="Buscar negocio">
    <div class="filtros" role="group" aria-label="Filtrar por resultado">${FILTROS.map(([f, t]) => {
      const n = cuenta(f);
      return f !== "todos" && !n ? "" : `<button type="button" class="filtro" data-accion="filtro" data-filtro="${f}" aria-pressed="${st.filtro === f}">${t} <span>${n}</span></button>`;
    }).join("")}</div>
    <div id="lista-negocios"></div>`;
  pintarListaNegocios();
}

function pintarListaNegocios() {
  const q = st.busqueda.trim().toLowerCase();
  const lista = st.prospectos.slice().sort(byNombre)
    .filter(p => st.filtro === "todos" || filtroDe(p) === st.filtro)
    .filter(p => !q || `${p.nombre} ${p.zona} ${p.tipo}`.toLowerCase().includes(q));
  document.getElementById("lista-negocios").innerHTML = lista.map(p => {
    const cuando = colocadoEstaSemana(p.id);
    const lado = p.resultado
      ? `<span class="chip ${p.resultado === "visitado" ? "ok" : p.resultado === "no_interesado" ? "no" : "aviso"}">${RES[p.resultado]}${p.resultado === "volver" && p.volverEl ? " · " + fechaCorta(p.volverEl) : ""}</span>`
      : cuando ? `<span class="chip plan">${cuando}</span>` : '<span class="sin-colocar">Sin colocar</span>';
    return `
    <a class="fila" href="#negocio/${esc(p.id)}">
      <span><b>${esc(p.nombre)}</b><small>${esc(p.tipo)} · ${esc(p.zona)}${p.semana ? "" : ' · <span class="sin">sin horario</span>'}</small></span>
      <span class="fila-lado">${lado}<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></span>
    </a>`;
  }).join("") || '<p class="vacio">Ningún negocio coincide.</p>';
}

function renderNegocio(id) {
  const p = prospecto(id);
  if (!p) { app.innerHTML = '<p>Negocio no encontrado.</p><p><a href="#negocios">Volver a negocios</a></p>'; return; }
  const nota = st.notas.has(id) ? st.notas.get(id) : (p.nota || "");
  const marcas = p.checklist || [];
  const fecha = st.fechas.get(id) || manana();
  const estadoTxt = p.resultado
    ? `${RES[p.resultado]}${p.ultimaVisita ? " · " + fechaCorta(p.ultimaVisita) : ""}${p.volverEl ? " · volver el " + fechaCorta(p.volverEl) : ""}`
    : "Sin resultado todavía";
  const ya = estadoAhora(p);
  const tel = telefono(p);
  const hechos = CHECK.filter((_, i) => marcas[i]).length;
  const hoy = diaDeHoy();
  const tabla = p.semana ? `<table class="horario">${DIAS.map((nombre, d) => {
    const tramos = p.semana[d] || [];
    const hasta = m => m === 1440 ? "24:00" : fmt(m);
    return `<tr${d === hoy ? ' class="hoy"' : ""}><th scope="row">${nombre}</th><td>${tramos.length ? tramos.map(([a, b]) => `<span class="tramo">${fmt(a)}–${hasta(b)}</span>`).join("") : '<span class="muted">Cerrado</span>'}</td></tr>`;
  }).join("")}</table>` : "";
  const fuente = p.horarioVerificado === "google_maps" ? "Horario de Google Maps." : "";
  const pulsado = r => `aria-pressed="${p.resultado === r}"`;
  app.innerHTML = `
    <a class="atras" href="#negocios"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>Negocios</a>
    <header class="ficha-cab">
      <p class="kicker">${esc(p.tipo)} · ${esc(p.zona)}</p>
      <h1>${esc(p.nombre)}</h1>
      <p><span class="chip ${ya.clase}">${ya.texto}</span></p>
    </header>
    <div class="ficha">
      <div class="acciones-ficha">
        <a class="enlace-boton" href="${mapsUrl(p)}" target="_blank" rel="noopener">Cómo llegar</a>
        ${tel ? `<a class="boton" href="tel:${esc(tel)}">Llamar</a>` : ""}
        ${p.demoUrl ? `<a class="boton" href="${esc(p.demoUrl)}" target="_blank" rel="noopener">Ver demo ↗</a>` : ""}
      </div>
      <section class="panel">
        <h3>Horario</h3>
        ${tabla || `<p><span class="sin">Sin horario verificado.</span> ${esc(p.horario)}</p>`}
        <p class="ventana"><b>Mejor momento para ir</b>${esc(p.ventanaVisita)}</p>
        <p class="muted pequeno">${esc(p.direccion || "")}${p.direccion && fuente ? " · " : ""}${fuente}</p>
      </section>
      <section class="panel">
        <h3>Argumento</h3>
        <p class="arg">${esc(p.argumento)}</p>
        ${p.demoUrl ? "" : '<p class="muted pequeno">Sin demo publicada todavía.</p>'}
      </section>
      ${p.guion ? `<section class="panel"><h3>Guion</h3><p class="guion">${esc(p.guion)}</p></section>` : ""}
      <section class="panel">
        <h3>En la visita <span class="progreso">${hechos}/${CHECK.length}</span></h3>
        <ul class="checks">${CHECK.map((t, i) => `<li><label><input type="checkbox" data-check="${i}" data-id="${esc(id)}" ${marcas[i] ? "checked" : ""}> ${t}</label></li>`).join("")}</ul>
      </section>
      <section class="panel">
        <h3>Resultado</h3>
        <div class="resultados">
          <button type="button" class="boton ok" data-accion="visitado" data-id="${esc(id)}" ${pulsado("visitado")}>Visitado</button>
          <button type="button" class="boton aviso" data-accion="volver" data-id="${esc(id)}" ${pulsado("volver")}>Volver otro día</button>
          <button type="button" class="boton no" data-accion="no" data-id="${esc(id)}" ${pulsado("no_interesado")}>No interesado</button>
        </div>
        ${st.volver.has(id) ? `<div class="fecha"><label>Volver el <input type="date" data-fecha="${esc(id)}" value="${fecha}"></label><button type="button" class="boton principal" data-accion="volver-guardar" data-id="${esc(id)}">Guardar</button></div>` : ""}
        <label class="nota">Nota
          <textarea data-nota="${esc(id)}" placeholder="Con quién hablaste, qué te dijo…">${esc(nota)}</textarea>
        </label>
        <p class="estado-resultado"><span class="muted">${esc(estadoTxt)}</span>${p.resultado ? `<button type="button" class="enlace" data-accion="deshacer" data-id="${esc(id)}">Quitar resultado</button>` : ""}</p>
      </section>
      ${p.guion ? "" : '<p class="muted pequeno nota-guion">Guion pendiente: se escribirá a partir de la demo y de los datos verificados.</p>'}
    </div>`;
}

// ---------- Eventos ----------

app.addEventListener("click", async e => {
  const b = e.target.closest("[data-accion]");
  if (b) return accion(b);
  if (e.target.closest("a")) return;
  const neg = e.target.closest("[data-neg]");
  if (neg) {
    st.seleccion = st.seleccion === neg.dataset.neg ? null : neg.dataset.neg;
    return render();
  }
  const q = e.target.closest("[data-quitar]");
  if (q) return guardarPlan(planDe().placements.filter(p => p.id !== q.dataset.quitar));
  const col = e.target.closest(".col");
  if (col && st.seleccion) colocar(st.seleccion, col, e);
});

tabs.addEventListener("click", e => {
  const b = e.target.closest("[data-ir]");
  if (b) location.hash = "#" + b.dataset.ir;
});

app.addEventListener("change", e => {
  const t = e.target;
  if (t.matches("[data-check]")) {
    const id = t.dataset.id, p = prospecto(id);
    if (!p) return;
    const arr = CHECK.map((_, i) => i === +t.dataset.check ? t.checked : !!(p.checklist || [])[i]);
    actualizarProspecto(id, { checklist: arr });
    const progreso = app.querySelector(".progreso");
    if (progreso) progreso.textContent = `${arr.filter(Boolean).length}/${CHECK.length}`;
  }
  // La nota se guarda al salir del campo, sin depender de pulsar un resultado.
  if (t.matches("[data-nota]") && prospecto(t.dataset.nota) && (prospecto(t.dataset.nota).nota || "") !== t.value) {
    actualizarProspecto(t.dataset.nota, { nota: t.value });
    aviso("Nota guardada.");
  }
  if (t.matches("[data-fecha]")) st.fechas.set(t.dataset.fecha, t.value);
});

app.addEventListener("input", e => {
  const t = e.target;
  if (t.matches("[data-nota]")) st.notas.set(t.dataset.nota, t.value);
  if (t.id === "buscar") { st.busqueda = t.value; pintarListaNegocios(); }
});

app.addEventListener("dragstart", e => {
  const b = e.target.closest("[data-neg]");
  if (!b) return;
  e.dataTransfer.setData("text/plain", b.dataset.neg);
  e.dataTransfer.effectAllowed = "copy";
});
app.addEventListener("dragover", e => { if (e.target.closest(".col")) e.preventDefault(); });
app.addEventListener("drop", e => {
  const col = e.target.closest(".col");
  if (!col) return;
  e.preventDefault();
  colocar(e.dataTransfer.getData("text/plain"), col, e);
});

async function accion(b) {
  const a = b.dataset.accion, id = b.dataset.id;
  if (a === "semana-prev" || a === "semana-next") {
    const l = st.lunes;
    st.lunes = new Date(l.getFullYear(), l.getMonth(), l.getDate() + (a === "semana-next" ? 7 : -7));
    await cargarPlan(st.lunes);
    return render();
  }
  if (a === "semana-hoy") { st.lunes = lunesDe(new Date()); st.diaSel = diaDeHoy(); await cargarPlan(st.lunes); return render(); }
  if (a === "invertir") {
    guardarPlan(planDe().placements, !planDe().invertida);
    return aviso(`Esta semana cuenta como semana ${paridad() === 0 ? "A" : "B"}.`);
  }
  if (a === "dia") { st.diaSel = +b.dataset.dia; return render(); }
  if (a === "cancelar-sel") { st.seleccion = null; return render(); }
  if (a === "filtro") { st.filtro = b.dataset.filtro; return render(); }
  if (a === "entrar") return enviarEnlace();

  const p = prospecto(id);
  if (!p) return;
  const nota = st.notas.has(id) ? st.notas.get(id) : (p.nota || "");
  if (a === "volver") { st.volver.add(id); if (!st.fechas.has(id)) st.fechas.set(id, manana()); return render(); }
  if (a === "volver-guardar") {
    const f = st.fechas.get(id);
    if (!f) return aviso("Elige una fecha para volver.");
    st.volver.delete(id);
    actualizarProspecto(id, { resultado: "volver", volverEl: f, nota });
    aviso("Guardado. Volver el " + fechaCorta(f) + ".");
    return render();
  }
  if (a === "visitado") { st.volver.delete(id); actualizarProspecto(id, { resultado: "visitado", ultimaVisita: hoyISO(), volverEl: null, nota }); aviso("Visita registrada."); }
  if (a === "no") { st.volver.delete(id); actualizarProspecto(id, { resultado: "no_interesado", nota }); aviso("Marcado como no interesado."); }
  if (a === "deshacer") { actualizarProspecto(id, { resultado: null, ultimaVisita: null, volverEl: null }); aviso("Resultado quitado."); }
  render();
}

async function enviarEnlace() {
  const correo = document.getElementById("correo").value.trim();
  if (correo !== EMAIL_PROPIETARIO) return aviso("Este correo no tiene acceso.");
  const { error } = await sb.auth.signInWithOtp({ email: correo, options: { emailRedirectTo: location.origin + location.pathname } });
  aviso(error ? `No se pudo enviar: ${error.message}` : "Revisa tu correo y abre el enlace desde este móvil.");
  render();
}

// ---------- Arranque ----------

async function arrancar() {
  cargarCache();
  const { data } = await sb.auth.getSession();
  st.sesion = data.session;
  if (st.sesion && st.sesion.user.email !== EMAIL_PROPIETARIO) {
    await sb.auth.signOut();
    st.sesion = null;
    aviso("Esta cuenta no tiene acceso.");
  }
  sb.auth.onAuthStateChange((_evento, sesion) => {
    st.sesion = sesion && sesion.user.email === EMAIL_PROPIETARIO ? sesion : null;
    if (st.sesion) cargarDatos().catch(() => aviso("Sin conexión: se usan los datos guardados."))
      .finally(() => { render(); vaciarCola(); });
    else render();
  });
  if (st.sesion) {
    try { await cargarDatos(); } catch (e) { aviso("Sin conexión: se usan los datos guardados en este móvil."); }
    vaciarCola();
  }
  st.listo = true;
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  if (movil.addEventListener) movil.addEventListener("change", render);
  else if (movil.addListener) movil.addListener(render); // Safari y Chrome antiguos
  window.addEventListener("online", () => {
    aviso("Conexión recuperada.");
    if (st.sesion) cargarDatos().catch(() => {}).finally(() => { render(); vaciarCola(); });
    else render();
  });
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

arrancar();
