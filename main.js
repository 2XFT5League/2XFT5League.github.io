// ============================
// 2X FT5 League – Lógica HOME
// Backend: JSON estáticos servidos por GitHub Pages (/data)
// ============================

// ============================
// CONFIGURACIÓN DE RUTAS JSON
// ============================

// Modo de datos:
// - "local"  → usa los JSON del propio sitio (carpeta /data). En GitHub Pages es lo correcto.
// - "web"    → (opcional) Web App de Google Apps Script para pruebas
const MODO_DATOS = "local";

// Rutas de cada JSON para cada modo
const RUTAS_JSON = {
  local: {
    jugadores: "data/jugadores.json",
    clasificacion: "data/clasificacion_ordenada.json",
    calendario: "data/calendario.json"
  },
    web: {
    jugadores: "https://script.google.com/macros/s/AKfycbwnec5uAWjXQ1dtUoUUos2WuL236hatF9G_v-kT061G2-eM5CMNEj5TsKXXWJKRzf2Q/exec?tipo=jugadores",
    clasificacion: "https://script.google.com/macros/s/AKfycbwnec5uAWjXQ1dtUoUUos2WuL236hatF9G_v-kT061G2-eM5CMNEj5TsKXXWJKRzf2Q/exec?tipo=clasificacion",
    calendario: "https://script.google.com/macros/s/AKfycbwnec5uAWjXQ1dtUoUUos2WuL236hatF9G_v-kT061G2-eM5CMNEj5TsKXXWJKRzf2Q/exec?tipo=calendario"
  }
};

// Devuelve la URL correcta según el modo y el tipo de JSON
function getJsonUrl(tipo) {
  const modo = RUTAS_JSON[MODO_DATOS] ? MODO_DATOS : "local";
  return RUTAS_JSON[modo][tipo];
}

// ============================
// REPLAYS: DESACTIVAR LINKS EN MÓVIL REAL (sin usar ancho de pantalla)
// ============================

function esMovilReal() {
  const ua = navigator.userAgent || "";
  const esAndroid = /Android/i.test(ua);
  const esIOS = /iPhone|iPad|iPod/i.test(ua);
  const esIPadOS = (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return esAndroid || esIOS || esIPadOS;
}

function permitirLinkReplay() {
  return !esMovilReal();
}

// ============================
// ESTADO EN MEMORIA
// ============================

let jugadoresPorJugador = {}; // clave: jugador (tal cual)
let calendarioRaw = [];       // calendario plano (sin meta)
let clasificacionRaw = [];    // clasificacion plano (sin meta)

let temporadasDisponibles = [];

// temporadaActivaReal = la que viene del _meta (la “activa” de verdad)
let temporadaActivaReal = null;

// temporadaVista = la que seleccionas en el selector de HOME (puede ser distinta)
let temporadaVista = null;

let calendarioTemporadaPlano = [];      // filas planas filtradas por temporada (según temporadaVista)
let calendarioTemporadaAgrupado = [];   // [{ jornada, fecha_inicio, fecha_fin, partidos: [...] }]
let clasificacionTemporada = [];        // filas filtradas por temporada (según temporadaVista)

let jornadaActual = 1;

const STORAGE_KEY_TEMPORADA_HOME = "2xft5_home_temporada";

// ============================
// ARRANQUE
// ============================

document.addEventListener("DOMContentLoaded", () => {
  const btnPrev = document.getElementById("prev-jornada");
  const btnNext = document.getElementById("next-jornada");
  const selTemp = document.getElementById("temporada-select");

  if (btnPrev) btnPrev.addEventListener("click", () => cambiarJornada(-1));
  if (btnNext) btnNext.addEventListener("click", () => cambiarJornada(1));

  if (selTemp) {
    selTemp.addEventListener("change", () => {
      const n = Number(selTemp.value);
      if (!Number.isFinite(n)) return;
      aplicarTemporada(n, true);
      try { localStorage.setItem(STORAGE_KEY_TEMPORADA_HOME, String(n)); } catch (e) {}
    });
  }

  cargarDatos();
});

// ============================
// CARGA DE DATOS
// ============================

async function cargarDatos() {
  try {
    const [jugResp, calResp, claResp] = await Promise.all([
      fetch(getJsonUrl("jugadores")),
      fetch(getJsonUrl("calendario")),
      fetch(getJsonUrl("clasificacion"))
    ]);

    const jugadoresLista = await jugResp.json();
    const calendarioJson = await calResp.json();
    const clasificacionJson = await claResp.json();

    // Índice de jugadores por "jugador" (tal cual viene de Sheets)
    jugadoresPorJugador = {};
    if (Array.isArray(jugadoresLista)) {
      jugadoresLista.forEach(j => {
        if (!j || typeof j.jugador !== "string") return;
        jugadoresPorJugador[j.jugador] = j;
      });
    }

    // Extraer _meta (temporada_activa) y dejar arrays planos limpios
    const metaCal = extraerMetaTemporadaActiva(calendarioJson);
    const metaCla = extraerMetaTemporadaActiva(clasificacionJson);

    const temporadaMeta =
      (metaCal !== null ? metaCal : null) ??
      (metaCla !== null ? metaCla : null) ??
      determinarTemporadaFallback(calendarioJson, clasificacionJson);

    // Guardamos cuál es la temporada ACTIVA REAL (la del _meta o fallback)
    temporadaActivaReal = Number(temporadaMeta);

    calendarioRaw = quitarMeta(calendarioJson);
    clasificacionRaw = quitarMeta(clasificacionJson);

    // Temporadas disponibles (para selector)
    temporadasDisponibles = obtenerTemporadasDisponibles(calendarioRaw, clasificacionRaw);
    configurarSelectorTemporada(temporadasDisponibles);

    // Temporada vista inicial: preferimos selección guardada si es válida
    let temporadaInicial = Number(temporadaMeta);
    try {
      const guardada = Number(localStorage.getItem(STORAGE_KEY_TEMPORADA_HOME));
      if (Number.isFinite(guardada) && temporadasDisponibles.includes(guardada)) {
        temporadaInicial = guardada;
      }
    } catch (e) {}

    aplicarTemporada(temporadaInicial, true);

  } catch (err) {
    console.error("Error cargando datos:", err);
    const listaPartidos = document.getElementById("lista-partidos");
    if (listaPartidos) {
      listaPartidos.innerHTML = "<li>Error cargando datos JSON (revisa rutas y archivos).</li>";
    }
  }
}

// ============================
// TEMPORADAS: SELECTOR + APLICACIÓN
// ============================

function obtenerTemporadasDisponibles(calRows, claRows) {
  const set = new Set();

  if (Array.isArray(calRows)) {
    calRows.forEach(r => {
      const t = Number(r && r.temporada);
      if (Number.isFinite(t)) set.add(t);
    });
  }

  if (Array.isArray(claRows)) {
    claRows.forEach(r => {
      const t = Number(r && r.temporada);
      if (Number.isFinite(t)) set.add(t);
    });
  }

  const arr = Array.from(set);
  arr.sort((a, b) => b - a); // más reciente arriba
  return arr;
}

function configurarSelectorTemporada(temporadas) {
  const sel = document.getElementById("temporada-select");
  if (!sel) return;

  sel.innerHTML = "";

  if (!Array.isArray(temporadas) || temporadas.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "—";
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }

  temporadas.forEach(t => {
    const opt = document.createElement("option");
    opt.value = String(t);
    opt.textContent = String(t); // SOLO el año
    sel.appendChild(opt);
  });

  sel.disabled = false;
}

function aplicarTemporada(temporada, recalcularJornada) {
  const t = Number(temporada);
  if (!Number.isFinite(t)) return;

  // temporadaVista = la que se está consultando en HOME (selector)
  temporadaVista = t;

  const sel = document.getElementById("temporada-select");
  if (sel && String(sel.value) !== String(t)) {
    sel.value = String(t);
  }

  // Tema rojizo si la temporada vista NO es la activa real
  actualizarTemaHome();

  // Filtrar por temporada vista
  calendarioTemporadaPlano = Array.isArray(calendarioRaw)
    ? calendarioRaw.filter(r => Number(r && r.temporada) === Number(temporadaVista))
    : [];

  clasificacionTemporada = Array.isArray(clasificacionRaw)
    ? clasificacionRaw.filter(r => Number(r && r.temporada) === Number(temporadaVista))
    : [];

  // Agrupar calendario por jornada
  calendarioTemporadaAgrupado = agruparCalendarioPorJornada(calendarioTemporadaPlano);

  // Jornada por defecto al cambiar de temporada
  if (recalcularJornada) {
    jornadaActual = determinarJornadaPorDefecto(calendarioTemporadaAgrupado);
  }

  // Pintar
  pintarJornada();
  pintarClasificacion();
}

// Aplica clase al BODY para que CSS cambie a tonos rojizos cuando sea “modo consulta”
function actualizarTemaHome() {
  const body = document.body;
  if (!body) return;

  const esActiva = Number(temporadaVista) === Number(temporadaActivaReal);
  body.classList.toggle("tema-temporada-no-activa", !esActiva);
}

// ============================
// META + TEMPORADA
// ============================

function extraerMetaTemporadaActiva(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  if (!first || typeof first !== "object") return null;
  if (first._meta === "temporada_activa" && Object.prototype.hasOwnProperty.call(first, "valor")) {
    const n = Number(first.valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function quitarMeta(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const first = arr[0];
  if (first && typeof first === "object" && first._meta === "temporada_activa") {
    return arr.slice(1);
  }
  return arr.slice();
}

function determinarTemporadaFallback(calendarioAll, clasificacionAll) {
  const temporadas = [];

  if (Array.isArray(calendarioAll)) {
    quitarMeta(calendarioAll).forEach(r => {
      const t = Number(r && r.temporada);
      if (Number.isFinite(t)) temporadas.push(t);
    });
  }

  if (Array.isArray(clasificacionAll)) {
    quitarMeta(clasificacionAll).forEach(r => {
      const t = Number(r && r.temporada);
      if (Number.isFinite(t)) temporadas.push(t);
    });
  }

  if (temporadas.length === 0) return new Date().getFullYear();

  temporadas.sort((a, b) => b - a);
  return temporadas[0];
}

// ============================
// CALENDARIO: AGRUPAR POR JORNADA
// ============================
// Entrada: filas planas con columnas:
// temporada, jornada, fecha_inicio, fecha_fin, id_partido, p1, p2, marcadorp1, marcadorp2, replay
// Salida:
// [{ jornada, fecha_inicio, fecha_fin, partidos:[{...fila}] }]

function agruparCalendarioPorJornada(rows) {
  if (!Array.isArray(rows)) return [];

  const map = new Map(); // jornada -> obj jornada
  for (const r of rows) {
    if (!r) continue;

    const j = Number(r.jornada);
    if (!Number.isFinite(j)) continue;

    if (!map.has(j)) {
      map.set(j, {
        jornada: j,
        fecha_inicio: (typeof r.fecha_inicio === "string") ? r.fecha_inicio : "",
        fecha_fin: (typeof r.fecha_fin === "string") ? r.fecha_fin : "",
        partidos: []
      });
    }

    const entry = map.get(j);
    entry.partidos.push(r);

    // Por si hubiera inconsistencias, preferimos la primera fecha no vacía
    if (!entry.fecha_inicio && typeof r.fecha_inicio === "string" && r.fecha_inicio) entry.fecha_inicio = r.fecha_inicio;
    if (!entry.fecha_fin && typeof r.fecha_fin === "string" && r.fecha_fin) entry.fecha_fin = r.fecha_fin;
  }

  const jornadas = Array.from(map.values()).sort((a, b) => a.jornada - b.jornada);

  // Ordenar partidos dentro de cada jornada por id_partido (estable) para consistencia
  jornadas.forEach(j => {
    j.partidos.sort((x, y) => String(x.id_partido || "").localeCompare(String(y.id_partido || "")));
  });

  return jornadas;
}

// ============================
// JORNADAS: NAVEGACIÓN Y SELECCIÓN
// ============================

function cambiarJornada(delta) {
  if (!Array.isArray(calendarioTemporadaAgrupado) || calendarioTemporadaAgrupado.length === 0) return;

  const jornadas = calendarioTemporadaAgrupado
    .map(j => j && j.jornada)
    .filter(n => typeof n === "number" && !Number.isNaN(n))
    .sort((a, b) => a - b);

  if (jornadas.length === 0) return;

  const minJornada = jornadas[0];
  const maxJornada = jornadas[jornadas.length - 1];

  jornadaActual += delta;

  if (jornadaActual < minJornada) {
    jornadaActual = maxJornada;
  } else if (jornadaActual > maxJornada) {
    jornadaActual = minJornada;
  }

  pintarJornada();
}

function obtenerDatosJornada(num) {
  if (!Array.isArray(calendarioTemporadaAgrupado)) return null;
  return calendarioTemporadaAgrupado.find(j => j && j.jornada === num) || null;
}

// Jornada por defecto:
// - Si hoy cae dentro de una o varias jornadas (por solape), elegir la jornada con número más alto.
// - Si hoy es antes de la primera, elegir la primera.
// - Si hoy es después de la última, elegir la última.

function determinarJornadaPorDefecto(calAgrupado) {
  if (!Array.isArray(calAgrupado) || calAgrupado.length === 0) return 1;

  const hoy = normalizarFecha(new Date());

  const jornadasOrdenadas = calAgrupado
    .filter(j => j && typeof j.jornada === "number")
    .slice()
    .sort((a, b) => a.jornada - b.jornada);

  const activas = jornadasOrdenadas.filter(j => {
    const ini = parseFechaYYYYMMDD(j.fecha_inicio);
    const fin = parseFechaYYYYMMDD(j.fecha_fin);
    if (!ini || !fin) return false;
    const iniN = normalizarFecha(ini);
    const finN = normalizarFecha(fin);
    return hoy >= iniN && hoy <= finN;
  });

  if (activas.length > 0) {
    return Math.max(...activas.map(j => j.jornada));
  }

  const primera = jornadasOrdenadas[0];
  const iniPrimera = parseFechaYYYYMMDD(primera.fecha_inicio);
  if (iniPrimera && hoy < normalizarFecha(iniPrimera)) return primera.jornada;

  const ultima = jornadasOrdenadas[jornadasOrdenadas.length - 1];
  return ultima.jornada;
}

// ============================
// PINTAR JORNADA
// ============================

function pintarJornada() {
  const titulo = document.getElementById("jornada-titulo");
  const lista = document.getElementById("lista-partidos");
  if (!titulo || !lista) return;

  lista.innerHTML = "";

  const datosJornada = obtenerDatosJornada(jornadaActual);

  if (!datosJornada) {
    titulo.textContent = "Jornada no encontrada";
    return;
  }

  const rangoVisual = construirRangoVisual(datosJornada.fecha_inicio, datosJornada.fecha_fin);

  if (rangoVisual) {
    titulo.innerHTML = `
      JORNADA ${datosJornada.jornada}<br>
      <span class="jornada-rango">(${rangoVisual})</span>
    `;
  } else {
    titulo.textContent = `JORNADA ${datosJornada.jornada}`;
  }

  if (!Array.isArray(datosJornada.partidos)) return;

  const hoy = normalizarFecha(new Date());
  const fechaInicioJ = parseFechaYYYYMMDD(datosJornada.fecha_inicio);
  const fechaInicioN = fechaInicioJ ? normalizarFecha(fechaInicioJ) : null;

  datosJornada.partidos.forEach(partido => {
    if (!partido) return;

    const p1 = (typeof partido.p1 === "string") ? partido.p1 : "";
    const p2 = (typeof partido.p2 === "string") ? partido.p2 : "";

    const jug1 = p1 ? (jugadoresPorJugador[p1] || null) : null;
    const jug2 = p2 ? (jugadoresPorJugador[p2] || null) : null;

    const li = document.createElement("li");
    li.className = "partido";

    const avatarP1 = (jug1 && jug1.avatar) ? (normalizarRutaImg(jug1.avatar) || "img/default.png") : "img/default.png";
    const avatarP2 = (jug2 && jug2.avatar) ? (normalizarRutaImg(jug2.avatar) || "img/default.png") : "img/default.png";

    const nombreP1 = p1 || "P1";
    const nombreP2 = p2 || "P2";

    const idParamP1 = nombreP1;
    const idParamP2 = nombreP2;

    const jugado = esPartidoJugado(partido);

    // Estado visual:
    // - Si hoy < fecha_inicio de la jornada: "-"
    // - Si hoy >= fecha_inicio y no jugado: "Pendiente"
    // - Si jugado:
    //    - si hay replay: el marcador "X - Y" es el link
    //    - si no: "X - Y"
    let resultadoHtml = "-";

    if (jugado) {
      const m1 = Number(partido.marcadorp1);
      const m2 = Number(partido.marcadorp2);
      const marcadorTxt = `${m1} - ${m2}`;

      const replayUrl = (typeof partido.replay === "string") ? partido.replay.trim() : "";

      if (replayUrl !== "" && permitirLinkReplay()) {
        resultadoHtml = `<a href="${replayUrl}" target="_blank" rel="noopener noreferrer">${marcadorTxt}</a>`;
      } else {
        resultadoHtml = marcadorTxt;
      }

      li.classList.add("partido-jugado");
    } else {
      const noJugableAun = (fechaInicioN && hoy < fechaInicioN);

      if (noJugableAun) {
        resultadoHtml = "-";
        li.classList.add("partido-no-jugable");
      } else {
        resultadoHtml = "Pendiente";
        li.classList.add("partido-pendiente");
      }
    }

    li.innerHTML = `
      <div class="jugador jugador-izq">
        <img src="${avatarP1}" alt="${nombreP1}" class="avatar">
        <a href="jugador.html?id=${encodeURIComponent(idParamP1)}" class="nombre">
          ${nombreP1}
        </a>
      </div>
      <div class="resultado">${resultadoHtml}</div>
      <div class="jugador jugador-der">
        <a href="jugador.html?id=${encodeURIComponent(idParamP2)}" class="nombre">
          ${nombreP2}
        </a>
        <img src="${avatarP2}" alt="${nombreP2}" class="avatar">
      </div>
    `;

    lista.appendChild(li);
  });
}

function esPartidoJugado(partido) {
  const a = partido ? partido.marcadorp1 : "";
  const b = partido ? partido.marcadorp2 : "";
  if (a === "" || b === "" || a === null || b === null || typeof a === "undefined" || typeof b === "undefined") return false;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb);
}

// ============================
// PINTAR CLASIFICACIÓN
// ============================
// HOME (nuevo orden visual):
// - 5 columnas: Pos | Jugador | Puntos | FT5 | Combates
// - FT5: PJ | PG-PP (±DIF_P)
// - Combates: CG-CP (±DIF_C)

function pintarClasificacion() {
  const tbody = document.getElementById("tabla-clasificacion-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!Array.isArray(clasificacionTemporada)) return;

  const filasOrdenadas = clasificacionTemporada
    .filter(f => f && typeof f.posicion !== "undefined")
    .slice()
    .sort((a, b) => Number(a.posicion) - Number(b.posicion));

  filasOrdenadas.forEach(fila => {
    const jugadorKey = (typeof fila.jugador === "string") ? fila.jugador : "";
    const jugador = jugadorKey ? (jugadoresPorJugador[jugadorKey] || null) : null;

    const tr = document.createElement("tr");

    const avatar = (jugador && jugador.avatar) ? (normalizarRutaImg(jugador.avatar) || "img/default.png") : "img/default.png";
    const nombre = jugadorKey || "???";
    const idParam = nombre;

    const pj = safeNum(fila.pj);
    const pg = safeNum(fila.pg);
    const pp = safeNum(fila.pp);
    const difP = safeNum(fila.dif_p);

    const cg = safeNum(fila.cg);
    const cp = safeNum(fila.cp);
    const difC = safeNum(fila.dif_c);

    // FT5 compacto:
    // - SIN espacios alrededor del separador "|"
    // - y SIN “aire” a la izquierda de PG-PP (anulamos el centrado de .stats-rest solo aquí)
    const ft5Html = `<span class="stats stats-ft5"><span class="stats-pj">${pj}</span>|<span class="stats-rest" style="min-width:0;text-align:left;">${pg}-${pp} (${formatearSigno(difP)})</span></span>`;
    const combHtml = `<span class="stats stats-comb"><span class="stats-rest">${cg}-${cp} (${formatearSigno(difC)})</span></span>`;

    tr.innerHTML = `
      <td class="posicion">${safeNum(fila.posicion)}</td>
      <td class="jugador-cell">
        <img src="${avatar}" alt="${nombre}" class="avatar">
        <a href="jugador.html?id=${encodeURIComponent(idParam)}" class="nombre">
          ${nombre}
        </a>
      </td>
      <td class="td-puntos">${safeNum(fila.puntos)}</td>
      <td class="td-stats td-ft5">${ft5Html}</td>
      <td class="td-stats td-comb">${combHtml}</td>
    `;

    tbody.appendChild(tr);
  });
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatearSigno(valor) {
  const n = Number(valor) || 0;
  if (n > 0) return `+${n}`;
  return `${n}`;
}

// ============================
// FECHAS (yyyy-mm-dd → dd/mm)
// ============================

function parseFechaYYYYMMDD(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;

  // Mediodía para minimizar problemas de DST
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

function normalizarFecha(dt) {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
}

function construirRangoVisual(iniStr, finStr) {
  const ini = parseFechaYYYYMMDD(iniStr);
  const fin = parseFechaYYYYMMDD(finStr);
  if (!ini || !fin) return "";

  const iniTxt = formatearDDMM(ini);
  const finTxt = formatearDDMM(fin);

  return `${iniTxt} - ${finTxt}`;
}

function formatearDDMM(dt) {
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

// ============================
// IMÁGENES: NORMALIZACIÓN RUTAS
// ============================
// Si el JSON trae "chunli.png" o "RedSpecial.jpeg" sin carpeta,
// lo convertimos a "img/chunli.png" / "img/RedSpecial.jpeg".
function normalizarRutaImg(ruta) {
  if (typeof ruta !== "string") return "";
  const r = ruta.trim();
  if (!r) return "";
  if (r.includes("/")) return r; // ya viene como "img/xxx.png" o similar
  return `img/${r}`;
}
