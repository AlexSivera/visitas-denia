// Visitas Dénia: centro de negocio. Hoy, semana (con arrastre), negocios por etapa y categoría, apuntar desde Maps y manual.
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
// Centro de negocio: cada negocio pasa por estas etapas, de apuntado en Maps a cliente.
const ETAPAS = [
  ["captado", "Captados", "Apuntado, sin investigar"],
  ["investigado", "Investigados", "Investigado, falta la demo"],
  ["demo", "Demo hecha", "Listo para visitar"],
  ["visitado", "Visitados", "Ya le has enseñado la demo"],
  ["propuesta", "Propuesta", "Propuesta enviada, esperando respuesta"],
  ["cliente", "Clientes", "Ha contratado"],
  ["descartado", "Descartados", "No interesado o no encaja"]
];
const CATEGORIAS = [
  ["restauracion", "Restauración"], ["cafes", "Cafés y dulce"], ["belleza", "Belleza y bienestar"],
  ["comercio", "Comercio"], ["servicios", "Servicios y talleres"]
];
const MOTIVOS = ["Sin web", "Web antigua o mala", "Solo Instagram", "Buenas reseñas", "Buen producto", "Buenas fotos"];
const ZONAS = ["Dénia", "Les Marines (Dénia)", "Beniarbeig", "Xàbia", "Pedreguer", "Ondara", "El Verger", "Els Poblets", "Gata de Gorgos"];
const CLAVE_CACHE = "visitas.cache.v1";
const CLAVE_COLA = "visitas.cola.v1";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const st = {
  sesion: null,
  listo: false,
  prospectos: [],
  docs: [],              // manual de ventas: método común y dossier de cada negocio (solo lectura)
  planes: {},           // clave de semana (YYYY-MM-DD del lunes) -> { placements, invertida }
  cola: [],              // escrituras pendientes de enviar
  lunes: lunesDe(new Date()),
  diaSel: (new Date().getDay() + 6) % 7, // día visible en Semana cuando la pantalla es estrecha
  etapa: "activos",      // filtro de Negocios: "activos", "todos" o una etapa
  categoria: "todas",
  compartido: null,      // lo que llega al compartir desde Google Maps, para rellenar Apuntar
  seleccion: null,
  notas: new Map(),
  fechas: new Map(),
  volver: new Set(),
  busqueda: "",
  busquedaDoc: "",
  aviso: ""
};

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");
const fab = document.getElementById("fab");

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = min => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const clave = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fechaCorta = iso => { const d = new Date(iso.slice(0, 10) + "T12:00"); return `${d.getDate()} ${MESES[d.getMonth()]}`; };
const hoyISO = () => clave(new Date());
const manana = () => clave(new Date(Date.now() + DAY));
const byNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es");
const prospecto = id => st.prospectos.find(p => p.id === id);
const mapsUrl = p => !p.direccion && p.mapsLink ? p.mapsLink : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent((p.direccion || p.nombre) + ", Alicante, España")}`;
const movil = matchMedia("(max-width: 699px)");
const diaDeHoy = () => (new Date().getDay() + 6) % 7;
const minDeAhora = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const telefono = p => { const m = String(p.telefono || p.horario || "").match(/(\+34\s?)?[6-9](?:\s?\d){8}/); return m ? m[0].replace(/\s/g, "") : null; };

// Etapa y categoría guardadas; si faltan (datos antiguos) se deducen.
const rango = e => ETAPAS.findIndex(x => x[0] === e);
const etiquetaEtapa = e => (ETAPAS.find(x => x[0] === e) || [0, e])[1];
const etiquetaCategoria = c => (CATEGORIAS.find(x => x[0] === c) || [0, "Sin categoría"])[1];
function etapaDe(p) {
  if (p.etapa) return p.etapa;
  if (p.resultado === "no_interesado") return "descartado";
  if (p.resultado === "visitado") return "visitado";
  return p.demoUrl ? "demo" : "investigado";
}
function adivinarCategoria(texto) {
  const t = String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/peluq|perruq|barber|estetic|masaje|spa\b|unas|nails?\b|fisio|yoga|pilates|gimnas|tatu|tattoo|belleza|depila/.test(t)) return "belleza";
  if (/cafe|panad|helad|paster|churr|forn\b|horno|crep|gofre|zumo|te\b|dulce|bombon/.test(t)) return "cafes";
  if (/restaur|\bbar\b|pizz|hambur|burger|tabern|tapas|arroc|kebab|sushi|asador|brasa|cocina|marisq|gastro|chiringu|cervec/.test(t)) return "restauracion";
  if (/flor|tienda|boutique|moda|zapat|librer|joyer|optica|regalo|ferret|bodega|vinos|muebles|decorac|botiga|mercad/.test(t)) return "comercio";
  return "servicios";
}
const categoriaDe = p => p.categoria || adivinarCategoria(`${p.tipo} ${p.nombre}`);
// Siguiente paso con fecha; "volver otro día" de las visitas antiguas cuenta como tal.
function siguienteDe(p) {
  if (p.siguientePaso || p.siguienteFecha) return { txt: p.siguientePaso || "Siguiente paso", fecha: p.siguienteFecha || null };
  if (p.resultado === "volver" && p.volverEl) return { txt: "Volver a visitar", fecha: p.volverEl };
  return null;
}
const urlDe = t => { const m = String(t || "").match(/https?:\/\/\S+/); return m ? m[0].replace(/[),.]+$/, "") : ""; };
const slug = t => plegar(t).replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "negocio";

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
  try { localStorage.setItem(CLAVE_CACHE, JSON.stringify({ prospectos: st.prospectos, planes: st.planes, docs: st.docs })); } catch (e) { /* sin almacenamiento */ }
}
function cargarCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE_CACHE) || "null");
    if (c) { st.prospectos = c.prospectos || []; st.planes = c.planes || {}; st.docs = c.docs || []; }
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
      // upsert para que los negocios apuntados sin conexión se creen al volver la red.
      const { error } = op.tipo === "prospecto"
        ? (op.borrar
          ? await sb.from("prospectos").delete().eq("id", op.id)
          : await sb.from("prospectos").upsert({ id: op.id, data: op.data, updated_at: ahora }))
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
  // Los documentos se editan en los .md del ordenador; si fallan, se queda la copia guardada.
  const docs = await sb.from("documentos").select("id,data,updated_at");
  if (!docs.error) st.docs = docs.data.map(r => ({ id: r.id, ...r.data, actualizado: r.updated_at }));
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

function crearProspecto(datos) {
  let id = slug(datos.nombre), n = 2;
  while (prospecto(id)) id = `${slug(datos.nombre)}-${n++}`;
  const ahora = new Date().toISOString();
  const p = { id, ...datos, etapa: "captado", captadoEl: hoyISO(), actualizadoEn: ahora };
  st.prospectos.push(p);
  const data = { ...p };
  delete data.id;
  guardarCache();
  encolar({ tipo: "prospecto", clave: id, id, data });
  return p;
}

function borrarProspecto(id) {
  st.prospectos = st.prospectos.filter(p => p.id !== id);
  guardarCache();
  encolar({ tipo: "prospecto", clave: id, id, borrar: true });
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
  const actual = r.vista === "negocio" || r.vista === "captar" ? "negocios" : r.vista === "doc" ? "manual" : r.vista;
  tabs.querySelectorAll("button").forEach(b => {
    if (b.dataset.ir === actual) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  // El botón de apuntar solo donde se consulta la lista: en la semana taparía el tablero.
  fab.hidden = !(r.vista === "hoy" || r.vista === "negocios");
  document.body.classList.toggle("con-fab", !fab.hidden);
  if (r.vista === "semana") renderSemana();
  else if (r.vista === "captar") renderCaptar();
  else if (r.vista === "negocios") renderNegocios();
  else if (r.vista === "negocio") renderNegocio(r.id);
  else if (r.vista === "manual") renderManual();
  else if (r.vista === "doc") renderDoc(r.id);
  else renderHoy();
}

function ruta() {
  const [vista, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { vista: vista || "hoy", id };
}

function renderLogin() {
  tabs.hidden = true;
  fab.hidden = true;
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
  // Lo que toca o ya se ha pasado de fecha, y los apuntados que esperan investigación.
  const hoy = hoyISO();
  const tareas = st.prospectos
    .map(p => ({ p, s: siguienteDe(p) }))
    .filter(x => x.s && x.s.fecha && x.s.fecha <= hoy && etapaDe(x.p) !== "descartado")
    .sort((a, b) => a.s.fecha.localeCompare(b.s.fecha) || byNombre(a.p, b.p));
  const captados = st.prospectos.filter(p => etapaDe(p) === "captado").length;
  const tareasHtml = tareas.length || captados ? `
    <section class="pendiente-hoy">
      <h2 class="kicker">Para hoy <span>${tareas.length}</span></h2>
      ${tareas.map(({ p, s }) => `
        <a class="fila" href="#negocio/${esc(p.id)}">
          <span><b>${esc(p.nombre)}</b><small>${esc(s.txt)}</small></span>
          <span class="fila-lado"><span class="chip ${s.fecha < hoy ? "no" : "aviso"}">${s.fecha < hoy ? "desde el " + fechaCorta(s.fecha) : "hoy"}</span>${CHEVRON}</span>
        </a>`).join("")}
      ${captados ? `<button type="button" class="fila captados" data-accion="ver-etapa" data-etapa="captado">
        <span><b>${captados} negocio${captados === 1 ? "" : "s"} por investigar</b><small>Apuntados en Captados, sin investigar todavía</small></span>
        <span class="fila-lado">${CHEVRON}</span></button>` : ""}
    </section>` : "";
  app.innerHTML = `
    <header class="hoy-cab">
      <p class="kicker">${DIAS[dia]} ${ahora.getDate()} ${MESES[ahora.getMonth()]}</p>
      <h1>Hoy</h1>
      <div class="hoy-meta"><span class="chip-semana">Semana ${par === 0 ? "A" : "B"}</span><span class="muted">${resumen}</span>${pendientes()}</div>
    </header>
    ${cuerpo}
    ${vacio}
    ${tareasHtml}`;
}

function renderSemana() {
  const l = st.lunes, dom = new Date(l.getFullYear(), l.getMonth(), l.getDate() + 6), par = paridad();
  const plan = planDe();
  const actual = clave(l) === clave(lunesDe(new Date()));
  const hoy = actual ? diaDeHoy() : -1;
  const otra = par === 0 ? "B" : "A";
  // Para colocar solo sirven los que tienen algo que enseñar; también los ya colocados esta semana.
  const colocable = p => ["investigado", "demo", "visitado", "propuesta"].indexOf(etapaDe(p)) >= 0 || plan.placements.some(x => x.prospectoId === p.id);
  const negocios = st.prospectos.filter(colocable).sort(byNombre).map(p => {
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

// "Activos" es todo lo que aún se mueve: ni clientes cerrados ni descartados.
const activo = p => etapaDe(p) !== "descartado" && etapaDe(p) !== "cliente";
const enEtapa = (p, f) => f === "todos" || (f === "activos" ? activo(p) : etapaDe(p) === f);

function renderNegocios() {
  const n = f => st.prospectos.filter(p => enEtapa(p, f)).length;
  const clientes = n("cliente");
  const embudo = [["activos", "En marcha"], ...ETAPAS.map(e => [e[0], e[1]]), ["todos", "Todos"]]
    .filter(([f]) => f === "activos" || f === "todos" || f === "captado" || f === "cliente" || n(f))
    .map(([f, t]) => `<button type="button" class="paso${f === "activos" || f === "todos" ? " total" : ""}" data-accion="etapa-filtro" data-etapa="${f}" aria-pressed="${st.etapa === f}"><b>${n(f)}</b><small>${t}</small></button>`).join("");
  app.innerHTML = `
    <div class="cabecera"><div><p class="kicker">${n("activos")} en marcha · ${clientes} cliente${clientes === 1 ? "" : "s"}</p><h1>Negocios</h1></div>${pendientes()}</div>
    <input class="buscar" id="buscar" type="search" placeholder="Buscar: nombre, tipo, zona o nota" value="${esc(st.busqueda)}" aria-label="Buscar negocio">
    <div class="embudo" role="group" aria-label="Filtrar por etapa">${embudo}</div>
    <div class="filtros" id="filtros-cat" role="group" aria-label="Filtrar por categoría"></div>
    <div id="lista-negocios"></div>`;
  pintarListaNegocios();
}

function pintarListaNegocios() {
  const q = plegar(st.busqueda.trim());
  const texto = p => plegar([p.nombre, p.tipo, p.zona, p.direccion, etiquetaCategoria(categoriaDe(p)), p.nota, (p.motivos || []).join(" ")].join(" "));
  const base = st.prospectos.filter(p => enEtapa(p, st.etapa) && (!q || texto(p).includes(q)));
  // Las categorías cuentan sobre lo ya filtrado por etapa y búsqueda.
  const nCat = c => base.filter(p => categoriaDe(p) === c).length;
  if (st.categoria !== "todas" && !nCat(st.categoria)) st.categoria = "todas";
  document.getElementById("filtros-cat").innerHTML = [["todas", "Todas"], ...CATEGORIAS]
    .filter(([c]) => c === "todas" || nCat(c))
    .map(([c, t]) => `<button type="button" class="filtro" data-accion="categoria" data-cat="${c}" aria-pressed="${st.categoria === c}">${t} <span>${c === "todas" ? base.length : nCat(c)}</span></button>`).join("");
  const lista = base.filter(p => st.categoria === "todas" || categoriaDe(p) === st.categoria)
    .sort((a, b) => rango(etapaDe(a)) - rango(etapaDe(b)) || byNombre(a, b));
  const fila = (p, conEtapa) => {
    const sig = siguienteDe(p), cuando = colocadoEstaSemana(p.id);
    const vence = sig && sig.fecha && sig.fecha <= hoyISO();
    const lado = sig
      ? `<span class="chip ${vence ? "no" : "aviso"}">${esc(sig.txt)}${sig.fecha ? " · " + fechaCorta(sig.fecha) : ""}</span>`
      : cuando ? `<span class="chip plan">${cuando}</span>`
      : conEtapa ? `<span class="sin-colocar">${etiquetaEtapa(etapaDe(p))}</span>` : "";
    const sub = [p.tipo || etiquetaCategoria(categoriaDe(p)), p.zona].filter(Boolean).map(esc).join(" · ");
    return `
    <a class="fila" href="#negocio/${esc(p.id)}">
      <span><b>${esc(p.nombre)}</b><small>${sub}</small></span>
      <span class="fila-lado">${lado}${CHEVRON}</span>
    </a>`;
  };
  const el = document.getElementById("lista-negocios");
  if (!lista.length) {
    el.innerHTML = q || st.etapa !== "captado"
      ? '<p class="vacio">Ningún negocio coincide.</p>'
      : '<div class="vacio"><p>No tienes negocios apuntados por investigar.</p><a class="boton" href="#captar">Apuntar uno</a></div>';
    return;
  }
  // Sin búsqueda y viendo varias etapas, la lista se agrupa por etapa en el orden del embudo.
  if (!q && (st.etapa === "activos" || st.etapa === "todos")) {
    el.innerHTML = ETAPAS.map(([e, t, ayuda]) => {
      const grupo = lista.filter(p => etapaDe(p) === e);
      return grupo.length ? `<section class="grupo-docs"><h2 class="kicker">${t} <span>${grupo.length}</span><small>${ayuda}</small></h2>${grupo.map(p => fila(p, false)).join("")}</section>` : "";
    }).join("");
  } else el.innerHTML = lista.map(p => fila(p, st.etapa === "todos" || !!q)).join("");
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
  const dossier = dossierDe(id);
  const hechos = CHECK.filter((_, i) => marcas[i]).length;
  const hoy = diaDeHoy();
  const tabla = p.semana ? `<table class="horario">${DIAS.map((nombre, d) => {
    const tramos = p.semana[d] || [];
    const hasta = m => m === 1440 ? "24:00" : fmt(m);
    return `<tr${d === hoy ? ' class="hoy"' : ""}><th scope="row">${nombre}</th><td>${tramos.length ? tramos.map(([a, b]) => `<span class="tramo">${fmt(a)}–${hasta(b)}</span>`).join("") : '<span class="muted">Cerrado</span>'}</td></tr>`;
  }).join("")}</table>` : "";
  const fuente = p.horarioVerificado === "google_maps" ? "Horario de Google Maps." : "";
  const pulsado = r => `aria-pressed="${p.resultado === r}"`;
  const etapa = etapaDe(p), cat = categoriaDe(p), sig = siguienteDe(p);
  const deVisita = !!p.demoUrl || rango(etapa) >= rango("demo");
  const motivos = p.motivos || [];
  app.innerHTML = `
    <a class="atras" href="#negocios"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>Negocios</a>
    <header class="ficha-cab">
      <p class="kicker">${[p.tipo || etiquetaCategoria(cat), p.zona].filter(Boolean).map(esc).join(" · ")}</p>
      <h1>${esc(p.nombre)}</h1>
      ${p.semana ? `<p><span class="chip ${ya.clase}">${ya.texto}</span></p>` : ""}
    </header>
    <div class="ficha">
      <div class="acciones-ficha">
        <a class="enlace-boton" href="${esc(mapsUrl(p))}" target="_blank" rel="noopener">${p.direccion || !p.mapsLink ? "Cómo llegar" : "Abrir en Google Maps"}</a>
        ${tel ? `<a class="boton" href="tel:${esc(tel)}">Llamar</a>` : ""}
        ${p.demoUrl ? `<a class="boton" href="${esc(p.demoUrl)}" target="_blank" rel="noopener">Ver demo ↗</a>` : ""}
      </div>
      <section class="panel seguimiento">
        <h3>Etapa</h3>
        <div class="filtros etapas" role="group" aria-label="Etapa">${ETAPAS.map(([e, t]) =>
          `<button type="button" class="filtro" data-accion="etapa" data-etapa="${e}" data-id="${esc(id)}" aria-pressed="${etapa === e}">${t}</button>`).join("")}</div>
        <p class="muted pequeno">${(ETAPAS.find(x => x[0] === etapa) || [])[2] || ""}${p.captadoEl ? ` · apuntado el ${fechaCorta(p.captadoEl)}` : ""}</p>
        <div class="paso-siguiente">
          <label>Siguiente paso<input type="text" data-paso="${esc(id)}" value="${esc(sig ? sig.txt : "")}" placeholder="Investigar, hacer la demo, llamar…" enterkeyhint="done"></label>
          <label>Cuándo<input type="date" data-pasofecha="${esc(id)}" value="${sig && sig.fecha ? sig.fecha : ""}"></label>
        </div>
        ${sig ? `<button type="button" class="enlace" data-accion="paso-hecho" data-id="${esc(id)}">Hecho: quitar el siguiente paso</button>` : ""}
      </section>
      ${p.semana || p.horario ? `<section class="panel">
        <h3>Horario</h3>
        ${tabla || `<p><span class="sin">Sin horario verificado.</span> ${esc(p.horario)}</p>`}
        ${p.ventanaVisita ? `<p class="ventana"><b>Mejor momento para ir</b>${esc(p.ventanaVisita)}</p>` : ""}
        <p class="muted pequeno">${esc(p.direccion || "")}${p.direccion && fuente ? " · " : ""}${fuente}</p>
      </section>` : ""}
      ${p.argumento ? `<section class="panel">
        <h3>Argumento</h3>
        <p class="arg">${esc(p.argumento)}</p>
        ${p.demoUrl ? "" : '<p class="muted pequeno">Sin demo publicada todavía.</p>'}
      </section>` : ""}
      ${motivos.length || etapa === "captado" ? `<section class="panel">
        <h3>Por qué lo apuntaste</h3>
        ${motivos.length ? `<p class="motivos">${motivos.map(m => `<span class="chip">${esc(m)}</span>`).join("")}</p>` : ""}
        ${etapa === "captado" ? '<p class="muted pequeno">Para investigarlo, en el ordenador pídele a Claude «investiga los captados»: buscará web, reseñas, horario y redes, y rellenará esta ficha.</p>' : ""}
      </section>` : ""}
      ${p.guion || dossier ? `<section class="panel preparar">
        <h3>Preparar la visita</h3>
        ${p.guion ? `<p class="guion">${esc(p.guion)}</p>` : ""}
        ${dossier ? `<a class="boton dossier" href="#doc/${esc(dossier.id)}"><span><b>Estudiar el dossier completo</b><small>Guion, objeciones y qué no decir</small></span>${CHEVRON}</a>` : ""}
      </section>` : ""}
      ${deVisita ? `<section class="panel">
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
      ${p.guion || dossier ? "" : '<p class="muted pequeno nota-guion">Guion pendiente: se escribirá a partir de la demo y de los datos verificados.</p>'}` : `<section class="panel">
        <label class="nota">Nota
          <textarea data-nota="${esc(id)}" placeholder="Qué te llamó la atención, a quién conoces allí…">${esc(nota)}</textarea>
        </label>
      </section>`}
      <details class="panel editar">
        <summary>Editar datos</summary>
        <label>Nombre<input type="text" data-campo="nombre" data-id="${esc(id)}" value="${esc(p.nombre)}"></label>
        <label>Categoría<select data-campo="categoria" data-id="${esc(id)}">${CATEGORIAS.map(([c, t]) => `<option value="${c}"${c === cat ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Tipo<input type="text" data-campo="tipo" data-id="${esc(id)}" value="${esc(p.tipo || "")}" placeholder="Hamburguesería, taller de motos…"></label>
        <label>Zona<input type="text" data-campo="zona" data-id="${esc(id)}" value="${esc(p.zona || "")}" list="zonas"></label>
        <label>Dirección<input type="text" data-campo="direccion" data-id="${esc(id)}" value="${esc(p.direccion || "")}"></label>
        <label>Teléfono<input type="tel" data-campo="telefono" data-id="${esc(id)}" value="${esc(p.telefono || "")}"></label>
        <label>Enlace de Google Maps<input type="url" data-campo="mapsLink" data-id="${esc(id)}" value="${esc(p.mapsLink || "")}"></label>
        <datalist id="zonas">${ZONAS.map(z => `<option value="${esc(z)}">`).join("")}</datalist>
        ${etapa === "captado" || etapa === "descartado" ? `<button type="button" class="enlace peligro" data-accion="borrar" data-id="${esc(id)}">Borrar este negocio</button>` : ""}
      </details>
    </div>`;
}

// ---------- Apuntar un negocio (a mano o compartido desde Google Maps) ----------

// Google Maps comparte el nombre, a veces la dirección, y el enlace corto en líneas separadas.
function leerCompartido(titulo, texto, url) {
  const todo = [titulo, texto, url].filter(Boolean).join("\n");
  const enlace = urlDe(url) || urlDe(todo);
  const lineas = todo.split(/\n+/).map(l => l.trim()).filter(l => l && !/https?:\/\//.test(l));
  const nombre = (titulo && !/https?:\/\//.test(titulo) ? titulo.trim() : lineas[0]) || "";
  const direccion = lineas.find(l => l !== nombre && /\d|,/.test(l)) || "";
  const zona = ZONAS.find(z => plegar(direccion).includes(plegar(z))) || "";
  return { nombre, direccion, zona, mapsLink: enlace };
}

function renderCaptar() {
  // Si la vista se repinta (llegan datos, vuelve la conexión) no se borra lo que ya está escrito.
  if (document.getElementById("form-captar")) return;
  const c = st.compartido || {};
  st.compartido = null;
  app.innerHTML = `
    <a class="atras" href="#negocios"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>Negocios</a>
    <header class="ficha-cab">
      <p class="kicker">Nuevo candidato</p>
      <h1>Apuntar negocio</h1>
      <p class="muted">En Google Maps: <b>Compartir → Visitas</b>, o copia el enlace y pégalo aquí. Lo demás se investiga después.</p>
    </header>
    <form class="ficha captar" id="form-captar" novalidate>
      <section class="panel">
        <label>Enlace de Google Maps<input type="text" name="maps" id="captar-maps" inputmode="url" autocomplete="off" placeholder="https://maps.app.goo.gl/…" value="${esc(c.mapsLink || "")}"></label>
        <label>Nombre<input type="text" name="nombre" id="captar-nombre" required autocomplete="off" value="${esc(c.nombre || "")}" placeholder="Cómo se llama"></label>
        <fieldset><legend>Categoría</legend><div class="opciones">${CATEGORIAS.map(([v, t]) =>
          `<label class="filtro"><input type="radio" name="categoria" value="${v}">${t}</label>`).join("")}</div></fieldset>
        <label>Tipo<input type="text" name="tipo" id="captar-tipo" placeholder="Opcional: hamburguesería, taller…" autocomplete="off"></label>
        <label>Zona<input type="text" name="zona" list="zonas-captar" value="${esc(c.zona || "Dénia")}"></label>
        <datalist id="zonas-captar">${ZONAS.map(z => `<option value="${esc(z)}">`).join("")}</datalist>
        <input type="hidden" name="direccion" value="${esc(c.direccion || "")}">
      </section>
      <section class="panel">
        <fieldset><legend>Por qué es buen candidato</legend><div class="opciones">${MOTIVOS.map(m =>
          `<label class="filtro"><input type="checkbox" name="motivo" value="${esc(m)}">${esc(m)}</label>`).join("")}</div></fieldset>
        <label class="nota">Nota<textarea name="nota" placeholder="Qué te llamó la atención"></textarea></label>
      </section>
      <button type="submit" class="enlace-boton">Guardar en Captados</button>
    </form>`;
  const nombre = document.getElementById("captar-nombre");
  if (!nombre.value) (c.mapsLink ? nombre : document.getElementById("captar-maps")).focus();
}

function guardarCaptado(form) {
  const f = new FormData(form);
  const nombre = String(f.get("nombre") || "").trim();
  if (!nombre) { aviso("Falta el nombre del negocio."); document.getElementById("captar-nombre").focus(); return; }
  const tipo = String(f.get("tipo") || "").trim();
  const datos = {
    nombre, tipo,
    categoria: f.get("categoria") || adivinarCategoria(`${tipo} ${nombre}`),
    zona: String(f.get("zona") || "").trim(),
    mapsLink: urlDe(f.get("maps")),
    motivos: f.getAll("motivo"),
    nota: String(f.get("nota") || "").trim(),
    siguientePaso: "Investigar"
  };
  const dir = String(f.get("direccion") || "").trim();
  if (dir) datos.direccion = dir;
  const p = crearProspecto(datos);
  st.etapa = "captado";
  aviso(`${p.nombre} apuntado en Captados.`);
  location.hash = "#negocio/" + p.id;
}

// ---------- Manual: método común y dossier de cada negocio ----------

const GRUPOS = [["venta", "Dossier por negocio"], ["metodo", "Método"], ["notas", "Notas y decisiones"]];
const CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const doc = id => st.docs.find(d => d.id === id);
const dossierDe = id => st.docs.find(d => d.grupo === "venta" && d.prospectoId === id);
// Minúsculas sin tildes y con la misma longitud, para poder resaltar lo encontrado en el texto original.
const plegar = s => String(s || "").toLowerCase().split("").map(c => c.normalize("NFD")[0]).join("");

// Markdown mínimo de los .md comerciales: títulos, listas, tablas, citas y enlaces.
function mdLinea(t) {
  return esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
      if (/^https?:/.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`;
      const d = doc(url.replace(/^.*\//, "").replace(/\.md$/, ""));
      return d ? `<a href="#doc/${esc(d.id)}">${txt}</a>` : txt;
    })
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

// En la entradilla las citas son notas sobre el documento; dentro de las secciones, frases para decir.
function mdBloques(md, entradilla) {
  const lineas = md.split("\n"), out = [];
  const celdas = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  const marcaLista = /^\s*([-*]|\d+\.)\s+/;
  const inicioBloque = /^(#{3,6}\s|>|\s*\||\s*([-*]|\d+\.)\s|-{3,}\s*$)/;
  let i = 0, m;
  while (i < lineas.length) {
    const l = lineas[i];
    if (!l.trim()) { i++; continue; }
    if ((m = l.match(/^(#{3,6})\s+(.*)/))) {
      const h = m[1].length === 3 ? "h3" : "h4";
      out.push(`<${h}>${mdLinea(m[2])}</${h}>`); i++; continue;
    }
    if (/^-{3,}\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (l.startsWith(">")) {
      const b = [];
      while (i < lineas.length && lineas[i].startsWith(">")) b.push(lineas[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote${entradilla ? ' class="nota-doc"' : ""}>${b.map(mdLinea).join("<br>")}</blockquote>`); continue;
    }
    if (l.trim().startsWith("|")) {
      const filas = [];
      while (i < lineas.length && lineas[i].trim().startsWith("|")) filas.push(lineas[i++]);
      const cab = celdas(filas[0]);
      const cuerpo = filas.slice(/^[\s|:-]+$/.test(filas[1] || "") ? 2 : 1).map(celdas);
      // En móvil las tablas de más de dos columnas se leen como fichas con la etiqueta de cada dato.
      out.push(`<div class="tabla"><table${cab.length > 2 ? ' class="ancha"' : ""}><thead><tr>${cab.map(c => `<th>${mdLinea(c)}</th>`).join("")}</tr></thead><tbody>${cuerpo.map(f =>
        `<tr>${f.map((c, j) => `<td data-th="${esc((cab[j] || "").replace(/\*\*/g, ""))}">${mdLinea(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if ((m = l.match(marcaLista))) {
      const ordenada = /\d/.test(m[1]), items = [];
      while (i < lineas.length && (m = lineas[i].match(marcaLista)) && /\d/.test(m[1]) === ordenada) items.push(lineas[i++].replace(marcaLista, ""));
      const li = t => {
        const c = t.match(/^\[( |x)\]\s+(.*)/i);
        return c ? `<li class="tarea">${mdLinea(c[2])}</li>` : `<li>${mdLinea(t)}</li>`;
      };
      out.push(ordenada ? `<ol>${items.map(li).join("")}</ol>` : `<ul>${items.map(li).join("")}</ul>`); continue;
    }
    const p = [lineas[i++]];
    while (i < lineas.length && lineas[i].trim() && !inicioBloque.test(lineas[i])) p.push(lineas[i++]);
    out.push(`<p>${p.map(mdLinea).join("<br>")}</p>`);
  }
  return out.join("");
}

// Cada "## " es una sección plegable; lo anterior es la entradilla.
function mdSecciones(md) {
  const partes = ("\n" + md).split(/\n## /);
  const intro = partes.shift();
  return {
    intro,
    secciones: partes.map(s => {
      const n = s.indexOf("\n");
      return { titulo: n < 0 ? s : s.slice(0, n), cuerpo: n < 0 ? "" : s.slice(n + 1) };
    })
  };
}

function renderManual() {
  const n = st.docs.length;
  app.innerHTML = `
    <div class="cabecera"><div><p class="kicker">Centro de operaciones · ${n} documento${n === 1 ? "" : "s"}</p><h1>Manual</h1></div></div>
    <input class="buscar" id="buscar-doc" type="search" placeholder="Buscar en guiones, objeciones y dossiers" value="${esc(st.busquedaDoc)}" aria-label="Buscar en el manual">
    <div id="lista-docs"></div>`;
  pintarListaDocs();
}

function pintarListaDocs() {
  const el = document.getElementById("lista-docs");
  if (!st.docs.length) { el.innerHTML = '<p class="vacio">Todavía no hay documentos en este dispositivo. Se descargan al entrar con conexión.</p>'; return; }
  const q = plegar(st.busquedaDoc.trim());
  const nombre = d => d.prospectoId && prospecto(d.prospectoId) ? prospecto(d.prospectoId).nombre : d.titulo;
  const coincide = d => !q || plegar(`${nombre(d)} ${d.titulo} ${d.contenido}`).includes(q);
  // Con búsqueda, la línea de debajo enseña el trozo de texto donde aparece.
  const extracto = d => {
    if (!q) return esc(d.resumen || "");
    const txt = String(d.contenido || "").replace(/[#>*`|[\]]|:?-{3,}:?/g, " ").replace(/\s+/g, " ");
    const pos = plegar(txt).indexOf(q);
    if (pos < 0) return esc(d.resumen || "");
    const fin = pos + q.length;
    return `${pos > 40 ? "…" : ""}${esc(txt.slice(Math.max(0, pos - 40), pos))}<mark>${esc(txt.slice(pos, fin))}</mark>${esc(txt.slice(fin, fin + 70))}…`;
  };
  const fila = d => `
    <a class="fila doc" href="#doc/${esc(d.id)}">
      ${d.grupo === "metodo" ? `<span class="num">${String(d.orden || 0).padStart(2, "0")}</span>` : ""}
      <span class="doc-texto"><b>${esc(nombre(d))}</b><small>${extracto(d)}</small></span>
      <span class="fila-lado">${CHEVRON}</span>
    </a>`;
  const conDossier = new Set(st.docs.filter(d => d.grupo === "venta").map(d => d.prospectoId));
  const sinDossier = st.prospectos.filter(p => !conDossier.has(p.id)).length;
  const html = GRUPOS.map(([g, t]) => {
    const lista = st.docs.filter(d => d.grupo === g && coincide(d))
      .sort((a, b) => (a.orden || 0) - (b.orden || 0) || nombre(a).localeCompare(nombre(b), "es"));
    const falta = g === "venta" && !q && sinDossier ? `<p class="muted pequeno falta-dossier">${sinDossier} negocio${sinDossier === 1 ? "" : "s"} sin dossier todavía.</p>` : "";
    if (!lista.length && !falta) return "";
    return `<section class="grupo-docs"><h2 class="kicker">${t} <span>${lista.length}</span></h2>${lista.map(fila).join("")}${falta}</section>`;
  }).join("");
  el.innerHTML = html.indexOf("fila doc") >= 0 || !q ? html : '<p class="vacio">Nada coincide con la búsqueda.</p>';
}

function renderDoc(id) {
  const d = doc(id);
  if (!d) { app.innerHTML = '<p>Documento no encontrado.</p><p><a href="#manual">Volver al manual</a></p>'; return; }
  const p = d.prospectoId ? prospecto(d.prospectoId) : null;
  const { intro, secciones } = mdSecciones(d.contenido || "");
  const grupo = (GRUPOS.find(g => g[0] === d.grupo) || [0, ""])[1];
  app.innerHTML = `
    <a class="atras" href="#manual"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>Manual</a>
    <header class="ficha-cab doc-cab">
      <p class="kicker">${esc(grupo)}</p>
      <h1>${esc(p ? p.nombre : d.titulo)}</h1>
      ${p ? `<p class="muted">${esc(d.resumen || "")}</p>` : ""}
    </header>
    ${p ? `<div class="acciones-ficha">
      ${p.demoUrl ? `<a class="enlace-boton" href="${esc(p.demoUrl)}" target="_blank" rel="noopener">Abrir la demo ↗</a>` : ""}
      <a class="boton" href="#negocio/${esc(p.id)}">Ficha y resultado</a>
      <a class="boton" href="${mapsUrl(p)}" target="_blank" rel="noopener">Cómo llegar</a>
    </div>` : ""}
    ${secciones.length > 2 ? `<nav class="indice" aria-label="Ir a una sección">${secciones.map((s, i) =>
      `<button type="button" class="filtro" data-accion="ir-seccion" data-sec="${i}">${mdLinea(s.titulo.replace(/^\d+\.\s*/, ""))}</button>`).join("")}</nav>` : ""}
    <article class="md">
      ${intro.trim() ? `<div class="md-intro">${mdBloques(intro, true)}</div>` : ""}
      ${secciones.length > 1 ? '<div class="md-controles"><button type="button" class="enlace" data-accion="desplegar">Abrir todo</button></div>' : ""}
      ${secciones.map((s, i) => `
        <details class="seccion" id="sec-${i}"${i === 0 || secciones.length === 1 ? " open" : ""}>
          <summary>${mdLinea(s.titulo)}</summary>
          <div class="seccion-cuerpo">${mdBloques(s.cuerpo)}</div>
        </details>`).join("")}
    </article>
    <p class="muted pequeno fuente-doc">Solo lectura. Se edita en ${esc(d.origen || "el ordenador")}${d.actualizado ? " · actualizado el " + fechaCorta(d.actualizado) : ""}.</p>`;
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
  // Chips de categoría y motivos: se marcan con clase para navegadores sin :has().
  if (t.closest(".opciones")) Array.prototype.forEach.call(t.form.querySelectorAll(`input[name="${t.name}"]`), i => i.parentNode.classList.toggle("marcado", i.checked));
  if (t.matches("[data-paso], [data-pasofecha]")) {
    const id = t.dataset.paso || t.dataset.pasofecha, p = prospecto(id);
    if (!p) return;
    const sig = siguienteDe(p) || {};
    const txt = t.matches("[data-paso]") ? t.value.trim() : (sig.txt || "");
    const fecha = t.matches("[data-pasofecha]") ? t.value : (sig.fecha || "");
    actualizarProspecto(id, { siguientePaso: txt || (fecha ? "Siguiente paso" : null), siguienteFecha: fecha || null, ...(p.resultado === "volver" ? { volverEl: fecha || null } : {}) });
    aviso(txt || fecha ? "Siguiente paso guardado." : "Siguiente paso quitado.");
    render();
  }
  if (t.matches("[data-campo]")) {
    const p = prospecto(t.dataset.id), campo = t.dataset.campo;
    const v = t.value.trim();
    if (!p || (p[campo] || "") === v) return;
    if (campo === "nombre" && !v) { t.value = p.nombre; return aviso("El nombre no puede quedar vacío."); }
    actualizarProspecto(p.id, { [campo]: campo === "mapsLink" ? urlDe(v) : v });
    aviso("Guardado.");
  }
});

app.addEventListener("submit", e => {
  if (e.target.id !== "form-captar") return;
  e.preventDefault();
  guardarCaptado(e.target);
});

app.addEventListener("input", e => {
  const t = e.target;
  if (t.matches("[data-nota]")) st.notas.set(t.dataset.nota, t.value);
  if (t.id === "buscar") { st.busqueda = t.value; pintarListaNegocios(); }
  if (t.id === "buscar-doc") { st.busquedaDoc = t.value; pintarListaDocs(); }
  // Si se pega el texto entero que comparte Maps, se separan el enlace y el nombre.
  if (t.id === "captar-maps" && /\S\s+https?:|https?:\S+\s+\S/.test(t.value)) {
    const c = leerCompartido("", t.value, "");
    t.value = c.mapsLink;
    const n = document.getElementById("captar-nombre");
    if (n && !n.value && c.nombre) n.value = c.nombre;
    const dir = t.form && t.form.elements.direccion;
    if (dir && !dir.value) dir.value = c.direccion;
  }
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
  if (a === "etapa-filtro") { st.etapa = b.dataset.etapa; st.categoria = "todas"; return render(); }
  if (a === "categoria") { st.categoria = b.dataset.cat; return pintarListaNegocios(); }
  if (a === "ver-etapa") { st.etapa = b.dataset.etapa; st.categoria = "todas"; st.busqueda = ""; location.hash = "#negocios"; return; }
  if (a === "desplegar") {
    const secciones = app.querySelectorAll("details.seccion");
    const abrir = Array.prototype.some.call(secciones, s => !s.open);
    Array.prototype.forEach.call(secciones, s => { s.open = abrir; });
    b.textContent = abrir ? "Cerrar todo" : "Abrir todo";
    return;
  }
  if (a === "ir-seccion") {
    const s = document.getElementById("sec-" + b.dataset.sec);
    if (!s) return;
    s.open = true;
    s.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    return;
  }
  if (a === "entrar") return enviarEnlace();

  const p = prospecto(id);
  if (!p) return;
  const nota = st.notas.has(id) ? st.notas.get(id) : (p.nota || "");
  if (a === "volver") { st.volver.add(id); if (!st.fechas.has(id)) st.fechas.set(id, manana()); return render(); }
  if (a === "volver-guardar") {
    const f = st.fechas.get(id);
    if (!f) return aviso("Elige una fecha para volver.");
    st.volver.delete(id);
    actualizarProspecto(id, { resultado: "volver", volverEl: f, siguientePaso: "Volver a visitar", siguienteFecha: f, nota });
    aviso("Guardado. Volver el " + fechaCorta(f) + ".");
    return render();
  }
  // El resultado de la visita mueve la etapa, sin retroceder si ya iba más adelante.
  const etapa = etapaDe(p);
  const limpiarVolver = p.siguientePaso === "Volver a visitar" ? { siguientePaso: null, siguienteFecha: null } : {};
  if (a === "visitado") {
    st.volver.delete(id);
    actualizarProspecto(id, { resultado: "visitado", ultimaVisita: hoyISO(), volverEl: null, nota, ...limpiarVolver, etapa: rango(etapa) < rango("visitado") ? "visitado" : etapa });
    aviso("Visita registrada.");
  }
  if (a === "no") { st.volver.delete(id); actualizarProspecto(id, { resultado: "no_interesado", nota, ...limpiarVolver, etapa: "descartado" }); aviso("Marcado como no interesado: pasa a Descartados."); }
  if (a === "deshacer") {
    const vuelve = etapa === "visitado" || etapa === "descartado" ? (p.demoUrl ? "demo" : "investigado") : etapa;
    actualizarProspecto(id, { resultado: null, ultimaVisita: null, volverEl: null, ...limpiarVolver, etapa: vuelve });
    aviso("Resultado quitado.");
  }
  if (a === "etapa") {
    actualizarProspecto(id, { etapa: b.dataset.etapa });
    aviso(`${p.nombre}: ${etiquetaEtapa(b.dataset.etapa)}.`);
  }
  if (a === "paso-hecho") { actualizarProspecto(id, { siguientePaso: null, siguienteFecha: null, volverEl: null }); aviso("Paso hecho."); }
  if (a === "borrar") {
    if (!confirm(`¿Borrar ${p.nombre}? No se puede deshacer.`)) return;
    borrarProspecto(id);
    aviso(`${p.nombre} borrado.`);
    location.hash = "#negocios";
    return;
  }
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
  // Al compartir desde Google Maps (Android) la app se abre con ?title=&text=&url=.
  const q = new URLSearchParams(location.search);
  if (q.has("title") || q.has("text") || q.has("url")) {
    st.compartido = leerCompartido(q.get("title"), q.get("text"), q.get("url"));
    history.replaceState(null, "", location.pathname + "#captar");
  }
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
