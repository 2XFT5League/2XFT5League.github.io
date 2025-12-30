// ============================
// 2X FT5 League – Lógica JUGADOR
// Backend: JSON estáticos servidos por GitHub Pages (/data)
// Contrato:
// - jugadores.json: array plano
// - calendario.json: array plano, primer elemento _meta { temporada_activa }
// - clasificacion_ordenada.json: array plano, primer elemento _meta { temporada_activa }
// - partidos no jugados -> marcadores vacíos ("")
// - P1/P2 siempre por orden en el emparejamiento (p1 primero, p2 segundo)
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
let jugadoresLista = [];

let calendarioJson = [];      // calendario con meta (raw)
let clasificacionJson = [];   // clasificacion con meta (raw)

let temporadaActiva = null;

let calendarioRaw = [];       // calendario plano sin meta
let clasificacionRaw = [];    // clasificacion plano sin meta

let calendarioTemporadaPlano = [];     // filas planas filtradas por temporada activa
let clasificacionTemporada = [];       // filas planas filtradas por temporada activa
let calendarioTemporadaAgrupado = [];  // [{jornada, fecha_inicio, fecha_fin, partidos:[rows]}]

// ============================
// ARRANQUE
// ============================

document.addEventListener("DOMContentLoaded", () => {
  cargarJugador();
});

// ============================
// CARGA PRINCIPAL
// ============================

async function cargarJugador() {
  const jugadorId = obtenerJugadorDesdeURL();

  if (!jugadorId) {
    mostrarErrorGlobal("Falta el parámetro ?id=<jugador> en la URL.");
    return;
  }

  try {
    const [jugResp, calResp, claResp] = await Promise.all([
      fetch(getJsonUrl("jugadores")),
      fetch(getJsonUrl("calendario")),
      fetch(getJsonUrl("clasificacion"))
    ]);

    jugadoresLista = await jugResp.json();
    calendarioJson = await calResp.json();
    clasificacionJson = await claResp.json();

    // Índice de jugadores por "jugador"
    jugadoresPorJugador = {};
    if (Array.isArray(jugadoresLista)) {
      jugadoresLista.forEach(j => {
        if (!j || typeof j.jugador !== "string") return;
        jugadoresPorJugador[j.jugador] = j;
      });
    }

    // Temporada activa desde _meta (contrato)
    const metaCal = extraerMetaTemporadaActiva(calendarioJson);
    const metaCla = extraerMetaTemporadaActiva(clasificacionJson);

    temporadaActiva =
      (metaCal !== null ? metaCal : null) ??
      (metaCla !== null ? metaCla : null) ??
      determinarTemporadaFallback(calendarioJson, clasificacionJson);

    // Quitar meta y filtrar por temporada activa
    calendarioRaw = quitarMeta(calendarioJson);
    clasificacionRaw = quitarMeta(clasificacionJson);

    calendarioTemporadaPlano = calendarioRaw.filter(r => Number(r && r.temporada) === Number(temporadaActiva));
    clasificacionTemporada = clasificacionRaw.filter(r => Number(r && r.temporada) === Number(temporadaActiva));

    // Agrupar calendario por jornada (solo en memoria para pintar y lógica)
    calendarioTemporadaAgrupado = agruparCalendarioPorJornada(calendarioTemporadaPlano);

    // Pintar módulos
    pintarPerfilJugador(jugadorId);
    pintarTemporadaJugador(jugadorId);
    pintarProximoEnfrentamiento(jugadorId);
    pintarCalendarioPersonal(jugadorId);

  } catch (err) {
    console.error("Error cargando datos:", err);
    mostrarErrorGlobal("Error cargando datos JSON. Revisa rutas, servidor local y consola.");
  }
}

// ============================
// HELPERS URL
// ============================

function obtenerJugadorDesdeURL() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) return "";
  return id; // se respeta tal cual viene
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
// IMÁGENES: NORMALIZACIÓN RUTAS
// ============================
// Si el JSON trae "chunli.png" o "RedSpecial.jpeg" sin carpeta,
// lo convertimos a "img/chunli.png" / "img/RedSpecial.jpeg".
function normalizarRutaImg(ruta) {
  if (typeof ruta !== "string") return "";
  const r = ruta.trim();
  if (!r) return "";
  if (r.includes("/")) return r;
  return `img/${r}`;
}

// ============================
// CALENDARIO: AGRUPAR POR JORNADA
// ============================
// Entrada: filas planas con columnas típicas:
// temporada, jornada, fecha_inicio, fecha_fin, id_partido, p1, p2, marcadorp1, marcadorp2, replay
// Salida: [{ jornada, fecha_inicio, fecha_fin, partidos:[fila] }]

function agruparCalendarioPorJornada(rows) {
  if (!Array.isArray(rows)) return [];

  const map = new Map(); // jornada -> obj

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

    if (!entry.fecha_inicio && typeof r.fecha_inicio === "string" && r.fecha_inicio) entry.fecha_inicio = r.fecha_inicio;
    if (!entry.fecha_fin && typeof r.fecha_fin === "string" && r.fecha_fin) entry.fecha_fin = r.fecha_fin;
  }

  const jornadas = Array.from(map.values()).sort((a, b) => a.jornada - b.jornada);

  jornadas.forEach(j => {
    j.partidos.sort((x, y) => String(x.id_partido || "").localeCompare(String(y.id_partido || "")));
  });

  return jornadas;
}

// ============================
// PERFIL
// ============================

function pintarPerfilJugador(jugadorId) {
  const jugador = jugadoresPorJugador[jugadorId] || null;

  // Elementos
  const elTituloPanel = document.getElementById("jugador-panel-titulo");
  const elFightcade = document.getElementById("jugador-fightcade");
  const elAvatar = document.getElementById("jugador-avatar");
  const elP1 = document.getElementById("jugador-personaje1");
  const elP2 = document.getElementById("jugador-personaje2");

  const lineaWhatsapp = document.getElementById("jugador-whatsapp-linea");
  const linkWhatsapp = document.getElementById("jugador-whatsapp-link");
  const txtWhatsappPlano = document.getElementById("jugador-whatsapp-texto-plano");

  const lineaDisp = document.getElementById("jugador-disponibilidad-linea");
  const elDisp = document.getElementById("jugador-disponibilidad");

  // Encabezado del módulo
  if (elTituloPanel) elTituloPanel.textContent = jugadorId;

  if (!jugador) {
    if (elFightcade) elFightcade.textContent = "-";
    if (elAvatar) elAvatar.src = "img/default.png";

    if (elP1) elP1.style.display = "none";
    if (elP2) elP2.style.display = "none";

    // WhatsApp SIEMPRE visible con "-"
    if (lineaWhatsapp) lineaWhatsapp.style.display = "";
    if (linkWhatsapp) linkWhatsapp.style.display = "none";
    if (txtWhatsappPlano) txtWhatsappPlano.textContent = "-";

    // Disponibilidad SIEMPRE visible con "-"
    if (lineaDisp) lineaDisp.style.display = "";
    if (elDisp) elDisp.textContent = "-";

    return;
  }

  // Fightcade ID: si hay fightcade_link, el ID será un enlace a esa URL
  if (elFightcade) {
    const fcId = (typeof jugador.fightcade_id === "string") ? jugador.fightcade_id.trim() : "";
    const fcLink = (typeof jugador.fightcade_link === "string") ? jugador.fightcade_link.trim() : "";

    if (fcId && fcLink) {
      elFightcade.innerHTML = `<a href="${fcLink}" target="_blank" rel="noopener noreferrer" class="fightcade-link">${escapeHtml(fcId)}</a>`;
    } else {
      elFightcade.textContent = fcId || "-";
    }
  }

  if (elAvatar) {
    elAvatar.onerror = null;
    elAvatar.onerror = function () {
      this.onerror = null;
      this.src = "img/default.png";
    };
    elAvatar.src = (normalizarRutaImg(jugador.avatar) || "img/default.png");
  }

  // Personajes
  const p1img = (typeof jugador.personaje1_img === "string") ? jugador.personaje1_img.trim() : "";
  const p2img = (typeof jugador.personaje2_img === "string") ? jugador.personaje2_img.trim() : "";

  if (elP1) {
    if (p1img) {
      elP1.src = normalizarRutaImg(p1img);
      elP1.style.display = "";
    } else {
      elP1.style.display = "none";
    }
  }

  if (elP2) {
    if (p2img) {
      elP2.src = normalizarRutaImg(p2img);
      elP2.style.display = "";
    } else {
      elP2.style.display = "none";
    }
  }

  // WhatsApp: icono + palabra "Whatsapp" enlazada por whatsapp_link (sin mostrar número)
  const waLink = (typeof jugador.whatsapp_link === "string") ? jugador.whatsapp_link.trim() : "";

  if (lineaWhatsapp) lineaWhatsapp.style.display = "";

  if (waLink) {
    if (linkWhatsapp) {
      linkWhatsapp.style.display = "";
      linkWhatsapp.href = waLink;
    }
    if (txtWhatsappPlano) txtWhatsappPlano.textContent = "";
  } else {
    if (linkWhatsapp) linkWhatsapp.style.display = "none";
    if (txtWhatsappPlano) txtWhatsappPlano.textContent = "-";
  }

  // Disponibilidad: SIEMPRE visible
  const disp = (typeof jugador.disponibilidad === "string") ? jugador.disponibilidad.trim() : "";
  if (lineaDisp) lineaDisp.style.display = "";
  if (elDisp) elDisp.textContent = disp || "-";
}

// ============================
// TEMPORADA (RESUMEN + BARRAS)
// ============================

function pintarTemporadaJugador(jugadorId) {
  const elTemporadaTitulo = document.getElementById("temporada-titulo");
  if (elTemporadaTitulo) elTemporadaTitulo.textContent = `Temporada ${temporadaActiva}`;

  const fila = obtenerFilaClasificacionJugador(jugadorId);

  const elPos = document.getElementById("jugador-posicion");
  const elPts = document.getElementById("jugador-puntos");

  const elSin = document.getElementById("jugador-sin-clasificacion");
  const elBarras = document.getElementById("jugador-barras");

  const elFt5Datos = document.getElementById("barra-ft5-datos");
  const elFt5Win = document.getElementById("barra-ft5-win");
  const elFt5Lose = document.getElementById("barra-ft5-lose");
  const elFt5Texto = document.getElementById("barra-ft5-texto");

  const elCombDatos = document.getElementById("barra-combates-datos");
  const elCombWin = document.getElementById("barra-combates-win");
  const elCombLose = document.getElementById("barra-combates-lose");
  const elCombTexto = document.getElementById("barra-combates-texto");

  // Reset
  if (elPos) {
    elPos.className = "badge-posicion";
    elPos.textContent = "-";
  }
  if (elPts) elPts.textContent = "-";

  if (elBarras) elBarras.style.display = "none";
  if (elSin) elSin.style.display = "none";

  if (!fila) {
    if (elSin) elSin.style.display = "";
    return;
  }

  const pos = safeNum(fila.posicion);
  const pts = safeNum(fila.puntos);

  const pj = safeNum(fila.pj);
  const pg = safeNum(fila.pg);
  const pp = safeNum(fila.pp);
  const difP = safeNum(fila.dif_p);

  const cg = safeNum(fila.cg);
  const cp = safeNum(fila.cp);
  const difC = safeNum(fila.dif_c);

  // Badge posición
  if (elPos) {
    elPos.textContent = `#${pos}`;

    if (pos === 1) elPos.className = "badge-posicion badge-top1";
    else if (pos >= 2 && pos <= 8) elPos.className = "badge-posicion badge-top8";
    else elPos.className = "badge-posicion";
  }

  if (elPts) elPts.textContent = String(pts);

  if (elBarras) elBarras.style.display = "";

  // FT5
  if (elFt5Datos) elFt5Datos.textContent = `${pg}-${pp} (${formatearSigno(difP)})`;

  const ft5Total = pg + pp;
  const ft5WinPct = ft5Total > 0 ? Math.round((pg / ft5Total) * 100) : 0;
  const ft5LosePct = ft5Total > 0 ? (100 - ft5WinPct) : 0;

  if (elFt5Win) elFt5Win.style.width = `${ft5WinPct}%`;
  if (elFt5Lose) elFt5Lose.style.width = `${ft5LosePct}%`;
  if (elFt5Texto) elFt5Texto.textContent = (ft5Total > 0) ? `${ft5WinPct}% ganados` : "Sin datos aún";

  // Combates
  if (elCombDatos) elCombDatos.textContent = `${cg}-${cp} (${formatearSigno(difC)})`;

  const combTotal = cg + cp;
  const combWinPct = combTotal > 0 ? Math.round((cg / combTotal) * 100) : 0;
  const combLosePct = combTotal > 0 ? (100 - combWinPct) : 0;

  if (elCombWin) elCombWin.style.width = `${combWinPct}%`;
  if (elCombLose) elCombLose.style.width = `${combLosePct}%`;
  if (elCombTexto) elCombTexto.textContent = (combTotal > 0) ? `${combWinPct}% ganados` : "Sin datos aún";
}

function obtenerFilaClasificacionJugador(jugadorId) {
  if (!Array.isArray(clasificacionTemporada)) return null;
  return clasificacionTemporada.find(f => f && f.jugador === jugadorId) || null;
}

// ============================
// PRÓXIMO ENFRENTAMIENTO
// ============================

function pintarProximoEnfrentamiento(jugadorId) {
  const cont = document.getElementById("jugador-proximo");
  if (!cont) return;

  const prox = obtenerProximoPartidoJugador(jugadorId);

  if (!prox) {
    cont.innerHTML = `
      <p>Este jugador no tiene partidos asignados en la temporada ${temporadaActiva}.</p>
    `;
    return;
  }

  const { jornada, fecha_inicio, fecha_fin, partido, tipo } = prox;

  // P1/P2 por orden del calendario
  const p1Id = partido.p1 || "";
  const p2Id = partido.p2 || "";

  const p1 = jugadoresPorJugador[p1Id] || null;
  const p2 = jugadoresPorJugador[p2Id] || null;

  const p1Avatar = (p1 && typeof p1.avatar === "string" && p1.avatar.trim()) ? (normalizarRutaImg(p1.avatar) || "img/default.png") : "img/default.png";
  const p2Avatar = (p2 && typeof p2.avatar === "string" && p2.avatar.trim()) ? (normalizarRutaImg(p2.avatar) || "img/default.png") : "img/default.png";

  const rangoVisual = construirRangoVisual(fecha_inicio, fecha_fin);
  const cabecera = `Jornada ${jornada}${rangoVisual ? ` (${rangoVisual})` : ""}`;

  // Centro (pendiente o futuro)
  let centroHtml = `<span class="resultado-pendiente">Pendiente</span>`;
  if (tipo === "futuro") centroHtml = `<span class="resultado-futuro">-</span>`;

  // Rival
  const esP1Jugador = (p1Id === jugadorId);
  const esP2Jugador = (p2Id === jugadorId);
  const rivalId = esP1Jugador ? p2Id : (esP2Jugador ? p1Id : "");

  const rival = rivalId ? (jugadoresPorJugador[rivalId] || null) : null;

  // Clasificación rival
  const filaRival = rivalId ? obtenerFilaClasificacionJugador(rivalId) : null;

  const rivalPos = filaRival ? safeNum(filaRival.posicion) : "-";
  const rivalPts = filaRival ? safeNum(filaRival.puntos) : "-";
  const rivalPj = filaRival ? safeNum(filaRival.pj) : "-";
  const rivalPg = filaRival ? safeNum(filaRival.pg) : "-";
  const rivalPp = filaRival ? safeNum(filaRival.pp) : "-";
  const rivalDifP = filaRival ? formatearSigno(safeNum(filaRival.dif_p)) : "-";
  const rivalCg = filaRival ? safeNum(filaRival.cg) : "-";
  const rivalCp = filaRival ? safeNum(filaRival.cp) : "-";
  const rivalDifC = filaRival ? formatearSigno(safeNum(filaRival.dif_c)) : "-";

  // Personajes rival
  const rivalP1Img = (rival && typeof rival.personaje1_img === "string") ? normalizarRutaImg(rival.personaje1_img.trim()) : "";
  const rivalP2Img = (rival && typeof rival.personaje2_img === "string") ? normalizarRutaImg(rival.personaje2_img.trim()) : "";

  // Historial directo (multi-temporada, compacto):
  // 2025
  // 8-0 / (40-32)
  // J82. 5-4
  // ...
  // Temporada activa en rojo. Resultados en verde/rojo como siempre y link a replay si existe.
  let historialHtml = `
    <p><span class="jugador-perfil-etiqueta">Historial directo:</span></p>
    <p>No hay FT5 jugados entre ambos.</p>
  `;

  if (rivalId) {
    const porTemporada = new Map(); // temporada -> { temporada, ft5G, ft5P, combG, combP, partidos:[{jornada, marcador, replay, clase}] }

    if (Array.isArray(calendarioRaw)) {
      calendarioRaw.forEach(p => {
        if (!p) return;

        const esDirecto =
          (p.p1 === jugadorId && p.p2 === rivalId) ||
          (p.p1 === rivalId && p.p2 === jugadorId);

        if (!esDirecto) return;
        if (!esPartidoJugado(p)) return;

        const temp = Number(p.temporada);
        const jor = Number(p.jornada);

        if (!Number.isFinite(temp) || !Number.isFinite(jor)) return;

        if (!porTemporada.has(temp)) {
          porTemporada.set(temp, {
            temporada: temp,
            ft5G: 0,
            ft5P: 0,
            combG: 0,
            combP: 0,
            partidos: []
          });
        }

        const s = porTemporada.get(temp);

        const m1 = Number(p.marcadorp1);
        const m2 = Number(p.marcadorp2);

        const jugadorEsP1 = (p.p1 === jugadorId);
        const juegosJugador = jugadorEsP1 ? m1 : m2;
        const juegosRival = jugadorEsP1 ? m2 : m1;

        // FT5 W/L
        if (juegosJugador > juegosRival) s.ft5G += 1;
        else if (juegosJugador < juegosRival) s.ft5P += 1;

        // Combates
        s.combG += juegosJugador;
        s.combP += juegosRival;

        // Clase “habitual” verde/rojo
        let clase = "";
        if (juegosJugador > juegosRival) clase = "resultado-win";
        else if (juegosJugador < juegosRival) clase = "resultado-lose";

        const replayUrl = (typeof p.replay === "string") ? p.replay.trim() : "";

        s.partidos.push({
          jornada: jor,
          marcador: `${juegosJugador}-${juegosRival}`,
          replay: replayUrl,
          clase
        });
      });
    }

    let temporadas = Array.from(porTemporada.values())
      .filter(s => s && (s.ft5G + s.ft5P) > 0);

    // Orden: temporada activa primero, luego el resto por año desc
    temporadas.sort((a, b) => {
      const aAct = Number(a.temporada) === Number(temporadaActiva) ? 1 : 0;
      const bAct = Number(b.temporada) === Number(temporadaActiva) ? 1 : 0;
      if (aAct !== bAct) return bAct - aAct;
      return Number(b.temporada) - Number(a.temporada);
    });

    if (temporadas.length > 0) {
      let html = `<div class="historial-directo">`;

      temporadas.forEach(s => {
        s.partidos.sort((x, y) => Number(x.jornada) - Number(y.jornada));

        const esActiva = Number(s.temporada) === Number(temporadaActiva);

        const claseTemp = esActiva
          ? "hist-temporada-label hist-temporada-activa"
          : "hist-temporada-label";

        html += `
          <div class="hist-temporada-bloque">
            <div class="hist-temporada-anio">
              <span class="${claseTemp}"><strong>${s.temporada}</strong></span>
            </div>

            <div class="hist-temporada-resumen">
              <span class="hist-temporada-resumen-text"><strong>${s.ft5G}-${s.ft5P}</strong> / (${s.combG}-${s.combP})</span>
            </div>

            <div class="hist-temporada-partidos">
        `;

        s.partidos.forEach(pp => {
          const marcadorHtml = (pp.replay && permitirLinkReplay())
            ? `<a href="${pp.replay}" target="_blank" rel="noopener noreferrer" class="calendario-resultado-link ${pp.clase}"><strong>${pp.marcador}</strong></a>`
            : `<strong class="${pp.clase}">${pp.marcador}</strong>`;

          html += `
              <div class="hist-temporada-partido">
                <span class="hist-jornada">J${pp.jornada}.</span>
                <span class="hist-marcador">${marcadorHtml}</span>
              </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += `</div>`;

      historialHtml = `
        <p><span class="jugador-perfil-etiqueta">Historial directo:</span></p>
        ${html}
      `;
    }
  }

  const enlaceP1 = `<a href="jugador.html?id=${encodeURIComponent(p1Id)}" class="nombre">${p1Id}</a>`;
  const enlaceP2 = `<a href="jugador.html?id=${encodeURIComponent(p2Id)}" class="nombre">${p2Id}</a>`;

  cont.innerHTML = `
    <p><strong>${cabecera}</strong></p>

    <div class="partido">
      <div class="jugador jugador-izq">
        <img src="${p1Avatar}" alt="${p1Id}" class="avatar" onerror="this.onerror=null; this.src='img/default.png';">
        ${enlaceP1}
      </div>

      <div class="resultado">${centroHtml}</div>

      <div class="jugador jugador-der">
        ${enlaceP2}
        <img src="${p2Avatar}" alt="${p2Id}" class="avatar" onerror="this.onerror=null; this.src='img/default.png';">
      </div>
    </div>

    ${
      rivalId
        ? `
          <div class="proximo-rival-bloque">
            <a href="jugador.html?id=${encodeURIComponent(rivalId)}" class="proximo-rival-nombre">${rivalId}</a>

            <div class="proximo-rival-dos-columnas">
              <div class="proximo-rival-col proximo-rival-col-izq">
                <div class="proximo-rival-clasificacion">
                  <p><span class="jugador-perfil-etiqueta">Clasificación:</span></p>
                  <p>
                    Posición: <strong>${rivalPos !== "-" ? `${rivalPos}º` : "-"}</strong>
                    ${rivalPts !== "-" ? ` · Puntos: <strong>${rivalPts}</strong>` : ""}
                  </p>
                  <p>FT5: <strong>${rivalPj} | ${rivalPg}-${rivalPp} (${rivalDifP})</strong></p>
                  <p>Combates: <strong>${rivalCg}-${rivalCp} (${rivalDifC})</strong></p>
                </div>

                <div class="proximo-rival-personajes">
                  <p><span class="jugador-perfil-etiqueta">Personajes:</span></p>
                  <div class="proximo-rival-personajes-iconos">
                    ${rivalP1Img ? `<img src="${rivalP1Img}" alt="" class="avatar-personaje-proximo">` : ""}
                    ${rivalP2Img ? `<img src="${rivalP2Img}" alt="" class="avatar-personaje-proximo">` : ""}
                  </div>
                </div>
              </div>

              <div class="proximo-rival-col proximo-rival-col-der">
                <div class="proximo-rival-historial">
                  ${historialHtml}
                </div>
              </div>
            </div>
          </div>
        `
        : ""
    }
  `;
}

function obtenerProximoPartidoJugador(jugadorId) {
  if (!Array.isArray(calendarioTemporadaAgrupado)) return null;

  const hoy = normalizarFecha(new Date());

  const candidatos = [];

  calendarioTemporadaAgrupado
    .slice()
    .sort((a, b) => a.jornada - b.jornada)
    .forEach(j => {
      if (!j || typeof j.jornada !== "number") return;
      if (!Array.isArray(j.partidos)) return;

      const ini = parseFechaYYYYMMDD(j.fecha_inicio);
      const iniN = ini ? normalizarFecha(ini) : null;

      j.partidos.forEach(p => {
        if (!p) return;
        if (p.p1 !== jugadorId && p.p2 !== jugadorId) return;

        const jugado = esPartidoJugado(p);
        const noJugableAun = (iniN && hoy < iniN);

        let tipo = "";
        if (!jugado && !noJugableAun) tipo = "pendiente";
        else if (!jugado && noJugableAun) tipo = "futuro";
        else tipo = "jugado";

        candidatos.push({
          jornada: j.jornada,
          fecha_inicio: j.fecha_inicio,
          fecha_fin: j.fecha_fin,
          partido: p,
          tipo
        });
      });
    });

  const pendientes = candidatos.filter(x => x.tipo === "pendiente").sort((a, b) => a.jornada - b.jornada);
  if (pendientes.length > 0) return pendientes[0];

  const futuros = candidatos.filter(x => x.tipo === "futuro").sort((a, b) => a.jornada - b.jornada);
  if (futuros.length > 0) return futuros[0];

  return null;
}

function obtenerEstadisticasDirectasTemporada(jugadorId, rivalId) {
  if (!Array.isArray(calendarioTemporadaAgrupado)) return null;

  const jugados = [];

  calendarioTemporadaAgrupado.forEach(j => {
    if (!j || typeof j.jornada !== "number") return;
    if (!Array.isArray(j.partidos)) return;

    j.partidos.forEach(p => {
      if (!p) return;

      const esDirecto =
        (p.p1 === jugadorId && p.p2 === rivalId) ||
        (p.p1 === rivalId && p.p2 === jugadorId);

      if (!esDirecto) return;
      if (!esPartidoJugado(p)) return;

      jugados.push({ jornada: j.jornada, partido: p });
    });
  });

  if (jugados.length === 0) {
    return {
      ft5Jugados: 0,
      ft5Ganados: 0,
      ft5Perdidos: 0,
      combGanados: 0,
      combPerdidos: 0,
      ultimo: null
    };
  }

  jugados.sort((a, b) => a.jornada - b.jornada);

  let ft5Ganados = 0;
  let ft5Perdidos = 0;
  let combGanados = 0;
  let combPerdidos = 0;

  jugados.forEach(x => {
    const p = x.partido;

    const m1 = Number(p.marcadorp1);
    const m2 = Number(p.marcadorp2);

    const jugadorEsP1 = (p.p1 === jugadorId);

    const juegosJugador = jugadorEsP1 ? m1 : m2;
    const juegosRival = jugadorEsP1 ? m2 : m1;

    if (juegosJugador > juegosRival) ft5Ganados++;
    else if (juegosJugador < juegosRival) ft5Perdidos++;

    combGanados += juegosJugador;
    combPerdidos += juegosRival;
  });

  const ultimoRegistro = jugados.slice().sort((a, b) => b.jornada - a.jornada)[0];

  let ultimo = null;
  if (ultimoRegistro) {
    const p = ultimoRegistro.partido;

    const m1 = Number(p.marcadorp1);
    const m2 = Number(p.marcadorp2);

    const jugadorEsP1 = (p.p1 === jugadorId);
    const juegosJugador = jugadorEsP1 ? m1 : m2;
    const juegosRival = jugadorEsP1 ? m2 : m1;

    const replayUrl = (typeof p.replay === "string") ? p.replay.trim() : "";

    let resultadoJugador = "";
    if (juegosJugador > juegosRival) resultadoJugador = "ganado";
    else if (juegosJugador < juegosRival) resultadoJugador = "perdido";

    ultimo = {
      jornada: ultimoRegistro.jornada,
      marcadorJugador: `${juegosJugador} - ${juegosRival}`,
      replay: replayUrl,
      resultadoJugador
    };
  }

  return {
    ft5Jugados: jugados.length,
    ft5Ganados,
    ft5Perdidos,
    combGanados,
    combPerdidos,
    ultimo
  };
}

/*
  Historial directo multi-temporada (usa calendarioRaw = todas las temporadas sin meta).
  Devuelve un array de temporadas con resultados (solo partidos jugados), ordenado por temporada desc.
*/
function obtenerEstadisticasDirectasTodasTemporadas(jugadorId, rivalId) {
  if (!Array.isArray(calendarioRaw)) return [];

  const porTemporada = new Map(); // temporada -> { ...stats }

  for (const p of calendarioRaw) {
    if (!p) continue;

    const esDirecto =
      (p.p1 === jugadorId && p.p2 === rivalId) ||
      (p.p1 === rivalId && p.p2 === jugadorId);

    if (!esDirecto) continue;
    if (!esPartidoJugado(p)) continue;

    const temp = Number(p.temporada);
    const jor = Number(p.jornada);

    if (!Number.isFinite(temp) || !Number.isFinite(jor)) continue;

    if (!porTemporada.has(temp)) {
      porTemporada.set(temp, {
        temporada: temp,
        ft5Jugados: 0,
        ft5Ganados: 0,
        ft5Perdidos: 0,
        combGanados: 0,
        combPerdidos: 0,
        ultimo: null
      });
    }

    const s = porTemporada.get(temp);

    const m1 = Number(p.marcadorp1);
    const m2 = Number(p.marcadorp2);

    const jugadorEsP1 = (p.p1 === jugadorId);
    const juegosJugador = jugadorEsP1 ? m1 : m2;
    const juegosRival = jugadorEsP1 ? m2 : m1;

    s.ft5Jugados += 1;
    if (juegosJugador > juegosRival) s.ft5Ganados += 1;
    else if (juegosJugador < juegosRival) s.ft5Perdidos += 1;

    s.combGanados += juegosJugador;
    s.combPerdidos += juegosRival;

    const replayUrl = (typeof p.replay === "string") ? p.replay.trim() : "";

    let resultadoJugador = "";
    if (juegosJugador > juegosRival) resultadoJugador = "ganado";
    else if (juegosJugador < juegosRival) resultadoJugador = "perdido";

    // Último por temporada: mayor jornada
    if (!s.ultimo || (Number.isFinite(s.ultimo.jornada) && jor > s.ultimo.jornada)) {
      s.ultimo = {
        temporada: temp,
        jornada: jor,
        marcadorJugador: `${juegosJugador} - ${juegosRival}`,
        replay: replayUrl,
        resultadoJugador
      };
    }
  }

  const arr = Array.from(porTemporada.values());
  arr.sort((a, b) => b.temporada - a.temporada);
  return arr;
}

// ============================
// CALENDARIO PERSONAL
// ============================

function pintarCalendarioPersonal(jugadorId) {
  const cont = document.getElementById("jugador-calendario");
  if (!cont) return;

  if (!Array.isArray(calendarioTemporadaAgrupado) || calendarioTemporadaAgrupado.length === 0) {
    cont.innerHTML = `<p>No hay calendario disponible para la temporada ${temporadaActiva}.</p>`;
    return;
  }

  const jornadasOrdenadas = calendarioTemporadaAgrupado
    .slice()
    .sort((a, b) => a.jornada - b.jornada);

  let filasHtml = "";
  let tienePartidos = false;

  jornadasOrdenadas.forEach(j => {
    if (!j || typeof j.jornada !== "number") return;
    if (!Array.isArray(j.partidos)) return;

    const partidosJugador = j.partidos.filter(p => p && (p.p1 === jugadorId || p.p2 === jugadorId));
    if (partidosJugador.length === 0) return;

    tienePartidos = true;

    const rangoVisual = construirRangoVisual(j.fecha_inicio, j.fecha_fin);

    const jornadaHtml = `
      <span class="cal-jornada-num" data-jornada="${j.jornada}">Jornada ${j.jornada}</span>
      ${rangoVisual ? `<span class="cal-jornada-rango">(${rangoVisual})</span>` : ""}
    `;

    partidosJugador.forEach(partido => {
      if (!partido) return;

      // Orden FT5: p1 vs p2 (regla)
      const p1Id = partido.p1 || "";
      const p2Id = partido.p2 || "";

      const p1 = jugadoresPorJugador[p1Id] || {};
      const p2 = jugadoresPorJugador[p2Id] || {};

      const p1Avatar = (typeof p1.avatar === "string" && p1.avatar.trim()) ? (normalizarRutaImg(p1.avatar) || "img/default.png") : "img/default.png";
      const p2Avatar = (typeof p2.avatar === "string" && p2.avatar.trim()) ? (normalizarRutaImg(p2.avatar) || "img/default.png") : "img/default.png";

      // Resultado / estado
      const jugado = esPartidoJugado(partido);

      const hoy = normalizarFecha(new Date());
      const ini = parseFechaYYYYMMDD(j.fecha_inicio);
      const iniN = ini ? normalizarFecha(ini) : null;

      let resultadoHtml = "";
      let claseResultado = "";

      if (!jugado) {
        if (iniN && hoy < iniN) {
          claseResultado = "resultado-futuro";
          resultadoHtml = `<span class="${claseResultado}">-</span>`;
        } else {
          claseResultado = "resultado-pendiente";
          resultadoHtml = `<span class="${claseResultado}">Pendiente</span>`;
        }
      } else {
        const m1 = Number(partido.marcadorp1);
        const m2 = Number(partido.marcadorp2);
        const marcadorTxt = `${m1} - ${m2}`;

        const jugadorEsP1 = (p1Id === jugadorId);
        const jugadorEsP2 = (p2Id === jugadorId);

        if (jugadorEsP1) claseResultado = (m1 > m2) ? "resultado-win" : "resultado-lose";
        else if (jugadorEsP2) claseResultado = (m2 > m1) ? "resultado-win" : "resultado-lose";
        else claseResultado = "";

        const replayUrl = (typeof partido.replay === "string") ? partido.replay.trim() : "";

        if (replayUrl && permitirLinkReplay()) {
          resultadoHtml = `<a href="${replayUrl}" target="_blank" rel="noopener noreferrer" class="${claseResultado} calendario-resultado-link">${marcadorTxt}</a>`;
        } else {
          resultadoHtml = `<span class="${claseResultado}">${marcadorTxt}</span>`;
        }
      }

      const p1EsPropio = (p1Id === jugadorId);
      const p2EsPropio = (p2Id === jugadorId);

      const p1ClaseNombre = p1EsPropio ? "cal-propio" : "cal-rival";
      const p2ClaseNombre = p2EsPropio ? "cal-propio" : "cal-rival";

      const ft5HtmlFinal = `
        <div class="cal-ft5">
          <div class="cal-ft5-jugador">
            <img src="${p1Avatar}" alt="${p1Id}" class="cal-ft5-avatar" onerror="this.onerror=null; this.src='img/default.png';">
            <span class="cal-ft5-nombre ${p1ClaseNombre}" data-propio="${p1EsPropio ? "1" : "0"}" data-rival="${p1EsPropio ? "0" : "1"}">
              <a href="jugador.html?id=${encodeURIComponent(p1Id)}" class="cal-ft5-nombre-link">${p1Id}</a>
            </span>
          </div>

          <span class="cal-ft5-res">${resultadoHtml}</span>

          <div class="cal-ft5-jugador">
            <span class="cal-ft5-nombre ${p2ClaseNombre}" data-propio="${p2EsPropio ? "1" : "0"}" data-rival="${p2EsPropio ? "0" : "1"}">
              <a href="jugador.html?id=${encodeURIComponent(p2Id)}" class="cal-ft5-nombre-link">${p2Id}</a>
            </span>
            <img src="${p2Avatar}" alt="${p2Id}" class="cal-ft5-avatar" onerror="this.onerror=null; this.src='img/default.png';">
          </div>
        </div>
      `;

      filasHtml += `
        <tr>
          <td class="cal-col-jornada">${jornadaHtml}</td>
          <td class="cal-col-ft5">${ft5HtmlFinal}</td>
        </tr>
      `;
    });
  });

  if (!tienePartidos) {
    cont.innerHTML = `<p>Este jugador no tiene partidos asignados en la temporada ${temporadaActiva}.</p>`;
    return;
  }

  cont.innerHTML = `
    <table class="tabla-clasificacion tabla-calendario tabla-calendario-sin-cabecera">
      <tbody>
        ${filasHtml}
      </tbody>
    </table>
  `;
}

// ============================
// PARTIDO JUGADO
// ============================

function esPartidoJugado(partido) {
  if (!partido) return false;

  const a = partido.marcadorp1;
  const b = partido.marcadorp2;

  if (a === "" || b === "" || a === null || b === null || typeof a === "undefined" || typeof b === "undefined") return false;

  const na = Number(a);
  const nb = Number(b);

  return Number.isFinite(na) && Number.isFinite(nb);
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

  // Mediodía para minimizar problemas de DST al normalizar luego a 00:00
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
// UTILS
// ============================

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatearSigno(valor) {
  const n = Number(valor) || 0;
  if (n > 0) return `+${n}`;
  return `${n}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mostrarErrorGlobal(msg) {
  const contPerfil = document.getElementById("jugador-contenido");
  const contClasif = document.getElementById("jugador-clasificacion");
  const contProx = document.getElementById("jugador-proximo");
  const contCal = document.getElementById("jugador-calendario");

  if (contPerfil) contPerfil.innerHTML = `<p>${msg}</p>`;
  if (contClasif) contClasif.innerHTML = `<p>${msg}</p>`;
  if (contProx) contProx.innerHTML = `<p>${msg}</p>`;
  if (contCal) contCal.innerHTML = `<p>${msg}</p>`;
}
