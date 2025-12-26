/**
 * 2X FT5 League – Generador de jornadas + Calendario (join) + WebApp JSON + Export Drive
 *
 * ACUERDOS:
 * - Temporada activa: jornadas!J1
 * - El generador NO toca fechas (C/D) en "jornadas"
 * - Regla P1/P2: orden p1/p2 en "jornadas"
 * - Vuelta: invertir orden p1/p2 respecto a la ida
 * - "calendario" se genera automáticamente (join de jornadas + resultados)
 *
 * NUEVO (JSON):
 * - WebApp:
 *     ?tipo=jugadores
 *     ?tipo=calendario
 *     ?tipo=clasificacion   (equivale a clasificacion_ordenada)
 * - Exportación opcional a Drive: 2X_FT5_Web_JSON
 * - Opción A: _meta temporada_activa en calendario.json y clasificacion_ordenada.json
 */

const CFG = {
  HOJA_JUGADORES: "jugadores",
  HOJA_JORNADAS: "jornadas",
  HOJA_RESULTADOS: "resultados",
  HOJA_CALENDARIO: "calendario",

  // Vista activa (calculada en Sheets)
  HOJA_CLASIF_ORD: "clasificacion_ordenada",

  // Histórico publicado (persistente, multitemporada)
  HOJA_CLASIF_HIST: "clasificacion_ordenada_hist",

  // Celda de temporada activa dentro de "jornadas"
  CELDA_TEMPORADA_ACTIVA: "J1",

  // (NUEVO) Control de ida/vuelta desde Sheets:
  // - TRUE  => ida + vuelta
  // - FALSE => solo ida
  CELDA_GENERAR_VUELTA: "J2",

  // Fallback si J2 está vacío
  GENERAR_VUELTA: true,

  // Export Drive (opcional)
  EXPORT_FOLDER_NAME: "2X_FT5_Web_JSON",

  // Token para ejecutar acciones por URL (Web App) desde el móvil.
  // Pon una cadena larga y no la compartas.
  TRIGGER_TOKEN: "g35iu6j0f9cd9v8bv7bv5bv6v5vcc1"
};

let SUPPRESS_UI_ALERTS = false;

/**
 * Alert compatible:
 * - Desde menú (Sheets UI): muestra alert normal.
 * - Desde WebApp (doGet): se suprime para evitar error por falta de UI.
 */
function uiAlert_(message) {
  if (SUPPRESS_UI_ALERTS) return;
  SpreadsheetApp.getUi().alert(message);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("2X FT5 League")
    .addItem("Generar jornadas (temporada activa)", "generarJornadasTemporadaActiva")
    .addItem("Sincronizar resultados (temporada activa)", "sincronizarResultadosTemporadaActiva")
    .addItem("Actualizar calendario (join jornadas+resultados)", "actualizarCalendario")
    .addSeparator()
    .addItem("Publicar clasificación (temporada activa)", "publicarClasificacionTemporadaActiva")
    .addSeparator()
    .addItem("Publicar web (GitHub Pages)", "publicarWebGitHubPages")
    .addToUi();
}

/**
 * Genera TODAS las jornadas de la temporada activa.
 * - No borra filas.
 * - No toca fechas (C/D).
 * - Sobrescribe SOLO A,B,E,F,G desde fila 2 hacia abajo.
 */
function generarJornadasTemporadaActiva() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const shJug = ss.getSheetByName(CFG.HOJA_JUGADORES);
  if (!shJug) throw new Error(`No existe la hoja "${CFG.HOJA_JUGADORES}".`);

  const shJor = ss.getSheetByName(CFG.HOJA_JORNADAS);
  if (!shJor) throw new Error(`No existe la hoja "${CFG.HOJA_JORNADAS}".`);

  const temporadaActiva = leerTemporadaActiva_(shJor, CFG.CELDA_TEMPORADA_ACTIVA);

  const jugadores = leerJugadoresActivos_(shJug);
  if (jugadores.length < 2) throw new Error("Necesitas al menos 2 jugadores activos para generar jornadas.");

  const jornadasBase = generarRoundRobinPorJornadas_(jugadores);
  const jornadasIdaOrientadas = orientarJornadasParaAlternancia_(jornadasBase);

  // Determinar si hay vuelta desde la celda (checkbox) jornadas!J2
  let generarVuelta = CFG.GENERAR_VUELTA;
  try {
    const v = shJor.getRange(CFG.CELDA_GENERAR_VUELTA).getValue();
    if (v === true || String(v).toUpperCase() === "TRUE" || v === 1) generarVuelta = true;
    if (v === false || String(v).toUpperCase() === "FALSE" || v === 0) generarVuelta = false;
  } catch (e) {
    // Si la celda no existe o hay cualquier problema, usamos el fallback CFG.GENERAR_VUELTA
  }

  let jornadasFinal = jornadasIdaOrientadas.slice();
  if (generarVuelta) {
    const vuelta = jornadasIdaOrientadas.map(partidosDeJornada => {
      return partidosDeJornada.map(p => ({ p1: p.p2, p2: p.p1 }));
    });
    jornadasFinal = jornadasFinal.concat(vuelta);
  }

  const filas = construirFilasSalida_(temporadaActiva, jornadasFinal);
  escribirSalidaSinTocarFechas_(shJor, filas);

  uiAlert_(
    `Jornadas generadas (sin tocar fechas).\n\n` +
    `Temporada activa: ${temporadaActiva}\n` +
    `Jugadores activos: ${jugadores.length}\n` +
    `Formato: ${generarVuelta ? "Doble vuelta" : "Una sola vuelta"}\n` +
    `Jornadas: ${jornadasFinal.length}\n` +
    `Partidos: ${filas.length}`
  );
}
/**
 * Sincroniza la hoja "resultados" para la temporada activa (MULTITEMPORADA, sin duplicados):
 * - Conserva histórico de TODAS las temporadas
 * - Reemplaza SOLO la temporada activa en A/B/C (y mantiene el orden por jornada/id_partido)
 * - Preserva los datos manuales (marcadorp1/marcadorp2/replay) por id_partido dentro de la temporada activa
 *
 * Requisito: "resultados" debe ser una tabla estable (SIN QUERY en A2).
 */
function sincronizarResultadosTemporadaActiva() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const shJor = ss.getSheetByName(CFG.HOJA_JORNADAS);
  if (!shJor) throw new Error(`No existe la hoja "${CFG.HOJA_JORNADAS}".`);

  const shRes = ss.getSheetByName(CFG.HOJA_RESULTADOS);
  if (!shRes) throw new Error(`No existe la hoja "${CFG.HOJA_RESULTADOS}".`);

  const temporadaActiva = leerTemporadaActiva_(shJor, CFG.CELDA_TEMPORADA_ACTIVA);

  // Asegurar cabeceras en resultados si está vacío
  asegurarCabecerasResultados_(shRes);

  // Leer cabeceras de resultados y localizar índices
  const lastCol = shRes.getLastColumn();
  const headers = shRes
    .getRange(1, 1, 1, Math.max(1, lastCol))
    .getValues()[0]
    .map(h => String(h).trim());

  const idxTemp = headers.indexOf("temporada");
  const idxJor = headers.indexOf("jornada");
  const idxId = headers.indexOf("id_partido");
  const idxM1 = headers.indexOf("marcadorp1");
  const idxM2 = headers.indexOf("marcadorp2");
  const idxRep = headers.indexOf("replay");

  if (idxTemp === -1) throw new Error('En "resultados" falta la columna "temporada".');
  if (idxJor === -1) throw new Error('En "resultados" falta la columna "jornada".');
  if (idxId === -1) throw new Error('En "resultados" falta la columna "id_partido".');
  if (idxM1 === -1) throw new Error('En "resultados" falta la columna "marcadorp1".');
  if (idxM2 === -1) throw new Error('En "resultados" falta la columna "marcadorp2".');
  if (idxRep === -1) throw new Error('En "resultados" falta la columna "replay".');

  // 1) Leer TODA la tabla resultados (para conservar histórico + rescatar D/E/F)
  const lastRow = shRes.getLastRow();
  let existentes = [];
  if (lastRow >= 2) {
    const data = shRes.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (const row of data) {
      const t = toIntOrNull_(row[idxTemp]);
      const jo = toIntOrNull_(row[idxJor]);
      const id = String(row[idxId] || "").trim();

      const m1 = row[idxM1];
      const m2 = row[idxM2];
      const rep = row[idxRep];

      // Saltar filas totalmente vacías
      const any = row.some(v => v !== "" && v !== null && typeof v !== "undefined");
      if (!any) continue;

      existentes.push({
        temporada: t,
        jornada: jo,
        id_partido: id,
        marcadorp1: m1,
        marcadorp2: m2,
        replay: rep
      });
    }
  }

  // 2) Indexar resultados manuales existentes de la temporada activa por id_partido
  const manualPorId = new Map();
  for (const e of existentes) {
    if (e.temporada === temporadaActiva && e.id_partido) {
      manualPorId.set(e.id_partido, {
        marcadorp1: e.marcadorp1,
        marcadorp2: e.marcadorp2,
        replay: e.replay
      });
    }
  }

  // 3) Conservar histórico de otras temporadas
  const historico = existentes.filter(e => e.temporada !== temporadaActiva);

  // 4) Construir lista “correcta” para la temporada activa desde jornadas
  const jornadasRows = leerTablaPorCabeceras_(shJor, [
    "temporada", "jornada", "id_partido"
  ]);

  const temporadaNueva = [];
  for (const j of jornadasRows) {
    const t = toIntOrNull_(j.temporada);
    const jo = toIntOrNull_(j.jornada);
    const id = String(j.id_partido || "").trim();
    if (!t || !jo || !id) continue;
    if (t !== temporadaActiva) continue;

    const keep = manualPorId.get(id);

    temporadaNueva.push({
      temporada: t,
      jornada: jo,
      id_partido: id,
      marcadorp1: keep ? keep.marcadorp1 : "",
      marcadorp2: keep ? keep.marcadorp2 : "",
      replay: keep ? keep.replay : ""
    });
  }

  // Orden estable dentro de la temporada (jornada -> id_partido)
  temporadaNueva.sort((a, b) => {
    const j = (a.jornada - b.jornada);
    if (j !== 0) return j;
    return String(a.id_partido).localeCompare(String(b.id_partido));
  });

  // 5) Unir histórico + temporada reconstruida (sin duplicados)
  const total = historico.concat(temporadaNueva);

  // 6) Volcar tabla completa (sin fórmulas en resultados)
  shRes.getRange(2, 1, shRes.getMaxRows() - 1, headers.length).clearContent();

  const out = total.map(r => {
    const row = new Array(headers.length).fill("");
    row[idxTemp] = r.temporada || "";
    row[idxJor] = r.jornada || "";
    row[idxId] = r.id_partido || "";
    row[idxM1] = r.marcadorp1 === null || typeof r.marcadorp1 === "undefined" ? "" : r.marcadorp1;
    row[idxM2] = r.marcadorp2 === null || typeof r.marcadorp2 === "undefined" ? "" : r.marcadorp2;
    row[idxRep] = r.replay === null || typeof r.replay === "undefined" ? "" : r.replay;
    return row;
  });

  if (out.length > 0) {
    shRes.getRange(2, 1, out.length, headers.length).setValues(out);
  }

  shRes.setFrozenRows(1);

  uiAlert_(
    `Resultados sincronizados (sin duplicados).\n\n` +
    `Temporada activa: ${temporadaActiva}\n` +
    `Filas temporada: ${temporadaNueva.length}\n` +
    `Filas totales: ${out.length}`
  );
}

/** Asegura cabeceras en "resultados" si está vacía. */
function asegurarCabecerasResultados_(shRes) {
  const headersEsperados = ["temporada", "jornada", "id_partido", "marcadorp1", "marcadorp2", "replay"];
  const rng = shRes.getRange(1, 1, 1, headersEsperados.length);
  const current = rng.getValues()[0];

  const vacias = current.every(x => String(x || "").trim() === "");
  if (vacias) rng.setValues([headersEsperados]);

  shRes.setFrozenRows(1);
}

/**
 * Genera/actualiza la hoja "calendario" (técnica) haciendo join:
 * - jornadas + resultados por (temporada + id_partido)
 *
 * Salida "calendario" (columnas exactas):
 * temporada | jornada | fecha_inicio | fecha_fin | id_partido | p1 | p2 | marcadorp1 | marcadorp2 | replay
 */
function actualizarCalendario() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const shJor = ss.getSheetByName(CFG.HOJA_JORNADAS);
  if (!shJor) throw new Error(`No existe la hoja "${CFG.HOJA_JORNADAS}".`);

  const shRes = ss.getSheetByName(CFG.HOJA_RESULTADOS);
  if (!shRes) throw new Error(`No existe la hoja "${CFG.HOJA_RESULTADOS}".`);

  // Crear (si no existe) "calendario"
  let shCal = ss.getSheetByName(CFG.HOJA_CALENDARIO);
  if (!shCal) shCal = ss.insertSheet(CFG.HOJA_CALENDARIO);

  // Intentar colocar "calendario" justo después de "resultados"
  try {
    const idxResultados = shRes.getIndex();
    shCal.setIndex(idxResultados + 1);
  } catch (e) {
    // Si no se puede por alguna razón, no pasa nada funcionalmente.
  }

  // Leer tablas por cabeceras
  const jornadasRows = leerTablaPorCabeceras_(shJor, [
    "temporada", "jornada", "fecha_inicio", "fecha_fin", "id_partido", "p1", "p2"
  ]);

  const resultadosRows = leerTablaPorCabeceras_(shRes, [
    "temporada", "jornada", "id_partido", "marcadorp1", "marcadorp2", "replay"
  ]);

  // Indexar resultados por clave (temporada|id_partido)
  const idxRes = new Map();
  for (const r of resultadosRows) {
    const temporada = toIntOrNull_(r.temporada);
    const id = String(r.id_partido || "").trim();
    if (!temporada || !id) continue;
    idxRes.set(`${temporada}|${id}`, r);
  }

  // Construir salida plana
  const out = [];
  for (const j of jornadasRows) {
    const temporada = toIntOrNull_(j.temporada);
    const jornada = toIntOrNull_(j.jornada);
    const id = String(j.id_partido || "").trim();
    if (!temporada || !jornada || !id) continue;

    const key = `${temporada}|${id}`;
    const r = idxRes.get(key) || null;

    // Marcadores: vacío => "" (no jugado)
    const m1 = r ? normalizarMarcador_(r.marcadorp1) : "";
    const m2 = r ? normalizarMarcador_(r.marcadorp2) : "";
    const replay = r ? String(r.replay || "").trim() : "";

    out.push([
      temporada,
      jornada,
      normalizarFechaParaSheet_(j.fecha_inicio),
      normalizarFechaParaSheet_(j.fecha_fin),
      id,
      String(j.p1 || "").trim(),
      String(j.p2 || "").trim(),
      m1,
      m2,
      replay
    ]);
  }

  // Escribir en "calendario"
  shCal.clearContents();

  const headers = [
    "temporada", "jornada", "fecha_inicio", "fecha_fin",
    "id_partido", "p1", "p2",
    "marcadorp1", "marcadorp2", "replay"
  ];

  shCal.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (out.length > 0) {
    shCal.getRange(2, 1, out.length, headers.length).setValues(out);
  }

  shCal.setFrozenRows(1);

  uiAlert_(
    `Calendario actualizado.\n\n` +
    `Filas generadas: ${out.length}\n` +
    `Hoja: "${CFG.HOJA_CALENDARIO}"`
  );
}

/** ===== TEMPORADA ACTIVA ===== */

function leerTemporadaActiva_(shJor, a1) {
  const v = shJor.getRange(a1).getValue();
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Temporada activa inválida en ${CFG.HOJA_JORNADAS}!${a1}. ` +
      `Pon un número (ej. 2026).`
    );
  }
  return Math.trunc(n);
}

/** ===== LECTURA DE JUGADORES ===== */

function leerJugadoresActivos_(sheetJugadores) {
  const lastRow = sheetJugadores.getLastRow();
  const lastCol = sheetJugadores.getLastColumn();
  if (lastRow < 2) return [];

  const headers = sheetJugadores.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const idxJugador = headers.indexOf("jugador");
  const idxActivo = headers.indexOf("activo");

  if (idxJugador === -1) throw new Error('En "jugadores" falta la columna "jugador".');
  if (idxActivo === -1) throw new Error('En "jugadores" falta la columna "activo".');

  const data = sheetJugadores.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const res = [];
  for (const row of data) {
    const jugador = (row[idxJugador] || "").toString().trim();
    if (!jugador) continue;

    const activo = row[idxActivo];
    const esActivo =
      (activo === true) ||
      (String(activo).toUpperCase() === "TRUE") ||
      (activo === 1);

    if (esActivo) res.push(jugador);
  }

  const seen = new Set();
  return res.filter(j => {
    if (seen.has(j)) return false;
    seen.add(j);
    return true;
  });
}

/** ===== ROUND ROBIN BASE ===== */

function generarRoundRobinPorJornadas_(jugadoresOriginal) {
  let jugadores = jugadoresOriginal.slice();

  const BYE = "__BYE__";
  if (jugadores.length % 2 === 1) jugadores.push(BYE);

  const n = jugadores.length;
  const rondas = n - 1;
  const partidosPorRonda = n / 2;

  let arr = jugadores.slice(); // arr[0] fijo

  const jornadas = [];

  for (let r = 0; r < rondas; r++) {
    const partidos = [];

    for (let i = 0; i < partidosPorRonda; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      partidos.push({ a, b });
    }

    jornadas.push(partidos);
    arr = rotarCircleMethod_(arr);
  }

  return jornadas;
}

function rotarCircleMethod_(arr) {
  const fijo = arr[0];
  const resto = arr.slice(1);
  resto.unshift(resto.pop());
  return [fijo].concat(resto);
}

/** ===== ORIENTACIÓN PARA ALTERNANCIA ===== */

function orientarJornadasParaAlternancia_(jornadasBase) {
  const lastRole = new Map(); // jugador -> "P1"|"P2"
  const jornadasOrientadas = [];

  for (let j = 0; j < jornadasBase.length; j++) {
    const partidos = jornadasBase[j];
    const orientados = [];

    for (let i = 0; i < partidos.length; i++) {
      const a = partidos[i].a;
      const b = partidos[i].b;

      const score1 = scoreOrientacion_(a, b, lastRole, "aP1", j, i);
      const score2 = scoreOrientacion_(a, b, lastRole, "bP1", j, i);

      let p1, p2;
      if (score1 < score2) { p1 = a; p2 = b; }
      else if (score2 < score1) { p1 = b; p2 = a; }
      else {
        const parity = (j + i) % 2;
        if (parity === 0) { p1 = a; p2 = b; }
        else { p1 = b; p2 = a; }
      }

      orientados.push({ p1, p2 });

      lastRole.set(p1, "P1");
      lastRole.set(p2, "P2");
    }

    jornadasOrientadas.push(orientados);
  }

  return jornadasOrientadas;
}

function scoreOrientacion_(a, b, lastRole, mode, jornadaIndex0, partidoIndex0) {
  let p1, p2;
  if (mode === "aP1") { p1 = a; p2 = b; }
  else { p1 = b; p2 = a; }

  let score = 0;

  const lr1 = lastRole.get(p1) || "";
  const lr2 = lastRole.get(p2) || "";

  if (lr1 === "P1") score += 2;
  if (lr2 === "P2") score += 2;
  if (lr1 === "P1" && lr2 === "P2") score += 1;

  const parity = (jornadaIndex0 + partidoIndex0) % 2;
  if (parity === 0 && mode === "aP1") score += 0.1;
  if (parity === 1 && mode === "bP1") score += 0.1;

  return score;
}

/** ===== CONSTRUIR SALIDA DE JORNADAS ===== */

function construirFilasSalida_(temporada, jornadasFinal) {
  const out = [];
  for (let j = 0; j < jornadasFinal.length; j++) {
    const jornadaNum = j + 1;
    const partidos = jornadasFinal[j];

    for (let k = 0; k < partidos.length; k++) {
      const partidoIndex = k + 1;
      const p1 = partidos[k].p1;
      const p2 = partidos[k].p2;

      const idPartido = construirIdPartido_(temporada, jornadaNum, partidoIndex, p1, p2);

      out.push({
        temporada,
        jornada: jornadaNum,
        id_partido: idPartido,
        p1,
        p2
      });
    }
  }
  return out;
}

function construirIdPartido_(temporada, jornada, partidoIndex, p1, p2) {
  const j = String(jornada).padStart(2, "0");
  const p = String(partidoIndex).padStart(2, "0");
  const s1 = slug_(p1);
  const s2 = slug_(p2);
  return `${temporada}-J${j}-P${p}-${s1}-vs-${s2}`;
}

function slug_(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20);
}

/** ===== ESCRITURA EN "jornadas" (MULTITEMPORADA) SIN TOCAR FECHAS =====
 *
 * - Conserva histórico de TODAS las temporadas
 * - Reemplaza SOLO la temporada activa
 * - Preserva fechas C/D existentes usando id_partido
 */
function escribirSalidaSinTocarFechas_(shJor, filas) {
  asegurarCabecerasJornadas_(shJor);

  if (!filas || filas.length === 0) return;

  const temporadaActiva = filas[0].temporada;

  const lastRow = shJor.getLastRow();

  let existentes = [];
  if (lastRow >= 2) {
    const values = shJor.getRange(2, 1, lastRow - 1, 7).getValues(); // A:G
    for (const row of values) {
      const temporada = toIntOrNull_(row[0]);
      const jornada = toIntOrNull_(row[1]);
      const fechaIni = row[2];
      const fechaFin = row[3];
      const id = String(row[4] || "").trim();
      const p1 = String(row[5] || "").trim();
      const p2 = String(row[6] || "").trim();

      if (!temporada && !jornada && !id && !p1 && !p2 && !fechaIni && !fechaFin) continue;

      existentes.push({
        temporada,
        jornada,
        fecha_inicio: fechaIni,
        fecha_fin: fechaFin,
        id_partido: id,
        p1,
        p2
      });
    }
  }

  const fechasPorId = new Map();
  for (const e of existentes) {
    if (e.temporada === temporadaActiva && e.id_partido) {
      fechasPorId.set(e.id_partido, {
        fecha_inicio: e.fecha_inicio,
        fecha_fin: e.fecha_fin
      });
    }
  }

  const historico = existentes.filter(e => e.temporada !== temporadaActiva);

  const nuevas = filas.map(r => {
    const keep = fechasPorId.get(r.id_partido);
    return {
      temporada: r.temporada,
      jornada: r.jornada,
      fecha_inicio: keep ? keep.fecha_inicio : "",
      fecha_fin: keep ? keep.fecha_fin : "",
      id_partido: r.id_partido,
      p1: r.p1,
      p2: r.p2
    };
  });

  const total = historico.concat(nuevas);

  shJor.getRange(2, 1, shJor.getMaxRows() - 1, 7).clearContent();

  const out = total.map(r => ([
    r.temporada,
    r.jornada,
    r.fecha_inicio,
    r.fecha_fin,
    r.id_partido,
    r.p1,
    r.p2
  ]));

  if (out.length > 0) {
    shJor.getRange(2, 1, out.length, 7).setValues(out);
  }

  shJor.setFrozenRows(1);
}

function asegurarCabecerasJornadas_(shJor) {
  const headersEsperados = ["temporada", "jornada", "fecha_inicio", "fecha_fin", "id_partido", "p1", "p2"];
  const rng = shJor.getRange(1, 1, 1, 7);
  const current = rng.getValues()[0];

  const vacias = current.every(x => String(x || "").trim() === "");
  if (vacias) rng.setValues([headersEsperados]);
}

/** ===== UTIL: LEER TABLA POR CABECERAS ===== */

function leerTablaPorCabeceras_(sheet, headersNecesarios) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const idx = {};
  for (const h of headersNecesarios) {
    const pos = headers.indexOf(h);
    if (pos === -1) throw new Error(`En "${sheet.getName()}" falta la columna "${h}".`);
    idx[h] = pos;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const out = [];
  for (const row of data) {
    const obj = {};
    for (const h of headersNecesarios) obj[h] = row[idx[h]];
    out.push(obj);
  }
  return out;
}

/** ===== UTIL: NORMALIZACIONES ===== */

function toIntOrNull_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizarMarcador_(v) {
  // Si vacío / null => ""
  if (v === "" || v === null || typeof v === "undefined") return "";
  // Si es número válido => número
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  // Si es texto no convertible => "" (evitamos que "0-0" o basura marque como jugado)
  return "";
}

function normalizarFechaParaSheet_(v) {
  // En "jornadas" puede ser Date real, número (serial), o texto.
  // Para "calendario" dejamos el valor tal cual si es Date o número; si es texto, lo dejamos.
  // (El exportador/JSON convertirá a YYYY-MM-DD cuando toque.)
  return v;
}

/**
 * Trigger automático (desactivado):
 * - Cuando se edita la hoja "resultados"
 * - Y solo si se editan columnas D, E o F
 *   (marcadorp1, marcadorp2, replay)
 * → Se actualiza automáticamente la hoja "calendario"
 */
// function onEdit(e) {
  // try {
    // if (!e || !e.range) return;

    // const sh = e.range.getSheet();
    // if (sh.getName() !== CFG.HOJA_RESULTADOS) return;

    // const col = e.range.getColumn();

    // // Columnas que disparan actualización:
    // // D = 4 (marcadorp1)
    // // E = 5 (marcadorp2)
    // // F = 6 (replay)
    // if (col < 4 || col > 6) return;

    // // Evitar disparos por edición de cabeceras
    // if (e.range.getRow() === 1) return;

    // // Actualizar calendario automáticamente
    // actualizarCalendario();

  // } catch (err) {
    // // Silencioso: no interrumpimos la edición del usuario
    // console.error("Error en onEdit:", err);
  // }
// }

/**
 * Proceso completo de publicación:
 * 1) actualizarCalendario()
 * 2) publicarClasificacionTemporadaActiva()
 * 3) publicarWebGitHubPages()
 */
function procesoCompletoPublicacionWeb() {
  actualizarCalendario();
  publicarClasificacionTemporadaActiva();
  publicarWebGitHubPages();
}

/** =====================================================================
 *  NUEVO BLOQUE: WEBAPP JSON + EXPORT DRIVE
 *  ===================================================================== */

/**
 * WebApp: /exec?tipo=jugadores|calendario|clasificacion
 * - clasificacion => exporta la hoja "clasificacion_ordenada"
 * - calendario y clasificacion llevan _meta temporada_activa (Opción A)
 */
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};

  function nowIso_() {
    try {
      const tz = Session.getScriptTimeZone();
      return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss");
    } catch (err) {
      return new Date().toISOString();
    }
  }

  function leerTemporadaActivaSafe_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shJor = ss.getSheetByName(CFG.HOJA_JORNADAS);
    if (!shJor) return null;
    try {
      return leerTemporadaActiva_(shJor, CFG.CELDA_TEMPORADA_ACTIVA);
    } catch (err) {
      return null;
    }
  }

  function contarFilasConDatos_(sheetName) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return 0;
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return 0;
    return lastRow - 1; // excluye cabecera
  }

  function contarFilasClasifHistTemporada_(temporada) {
    if (!temporada) return 0;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(CFG.HOJA_CLASIF_HIST);
    if (!sh) return 0;

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return 0;

    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
    const idxTemp = headers.indexOf("temporada");
    if (idxTemp === -1) return 0;

    const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

    let count = 0;
    for (const row of data) {
      const any = row.some(v => v !== "" && v !== null && typeof v !== "undefined");
      if (!any) continue;

      const t = toIntOrNull_(row[idxTemp]);
      if (t === temporada) count++;
    }
    return count;
  }

  function respuestaAccionOk_(accion, mensaje, detallesExtra) {
    const temporada = leerTemporadaActivaSafe_();
    const out = {
      ok: true,
      accion: accion,
      mensaje: mensaje,
      timestamp: nowIso_(),
      temporada_activa: temporada,
      filas_calendario: contarFilasConDatos_(CFG.HOJA_CALENDARIO),
      filas_clasificacion_hist_temporada: contarFilasClasifHistTemporada_(temporada)
    };

    if (detallesExtra && typeof detallesExtra === "object") {
      for (const k in detallesExtra) out[k] = detallesExtra[k];
    }

    return ContentService
      .createTextOutput(JSON.stringify(out, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  function respuestaAccionError_(accion, mensaje, err) {
    const out = {
      ok: false,
      accion: accion,
      mensaje: mensaje,
      timestamp: nowIso_(),
      error: String(err && err.message ? err.message : err)
    };
    return ContentService
      .createTextOutput(JSON.stringify(out, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ============================
  // MODO ACCIÓN (móvil / URL)
  // ============================
  const accion = params.accion ? String(params.accion).trim() : "";
  const token = params.token ? String(params.token).trim() : "";

  if (accion !== "") {
    // Seguridad: TRIGGER_TOKEN obligatorio
    if (!CFG.TRIGGER_TOKEN || String(CFG.TRIGGER_TOKEN).trim() === "") {
      const out = {
        ok: false,
        accion: accion,
        mensaje: "Acciones por URL deshabilitadas. Configura CFG.TRIGGER_TOKEN (no vacío).",
        timestamp: nowIso_()
      };
      return ContentService
        .createTextOutput(JSON.stringify(out, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (token !== String(CFG.TRIGGER_TOKEN)) {
      const out = {
        ok: false,
        accion: accion,
        mensaje: "Token inválido.",
        timestamp: nowIso_()
      };
      return ContentService
        .createTextOutput(JSON.stringify(out, null, 2))
        .setMimeType(ContentService.MimeType.JSON);
    }

    SUPPRESS_UI_ALERTS = true;

    try {
      if (accion === "publicar") {
        procesoCompletoPublicacionWeb();
        return respuestaAccionOk_(
          "publicar",
          "OK: publicar (calendario + clasificacion + GitHub Pages)",
          {
            github_paths: [
              "data/jugadores.json",
              "data/calendario.json",
              "data/clasificacion_ordenada.json"
            ]
          }
        );
      }

      if (accion === "calendario") {
        actualizarCalendario();
        return respuestaAccionOk_("calendario", "OK: calendario actualizado");
      }

      if (accion === "clasificacion") {
        publicarClasificacionTemporadaActiva();
        return respuestaAccionOk_("clasificacion", "OK: clasificacion publicada");
      }

      if (accion === "web") {
        publicarWebGitHubPages();
        return respuestaAccionOk_(
          "web",
          "OK: JSON publicados en GitHub Pages",
          {
            github_paths: [
              "data/jugadores.json",
              "data/calendario.json",
              "data/clasificacion_ordenada.json"
            ]
          }
        );
      }

      const out = {
        ok: false,
        accion: accion,
        mensaje: 'Acción no válida. Usa: accion=publicar | calendario | clasificacion | web',
        timestamp: nowIso_()
      };
      return ContentService
        .createTextOutput(JSON.stringify(out, null, 2))
        .setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
      return respuestaAccionError_(accion, "Error ejecutando acción.", err);

    } finally {
      SUPPRESS_UI_ALERTS = false;
    }
  }

  // ============================
  // MODO JSON (actual)
  // ============================
  const tipo = params.tipo ? String(params.tipo).trim() : "jugadores";

  let payload;

  if (tipo === "jugadores") {
    payload = buildJugadoresJson_();
  } else if (tipo === "calendario") {
    payload = buildCalendarioJson_();
  } else if (tipo === "clasificacion") {
    payload = buildClasificacionOrdenadaJson_();
  } else {
    payload = {
      ok: false,
      mensaje: 'Tipo no válido. Usa "jugadores", "calendario" o "clasificacion".',
      tipo_recibido: tipo
    };
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

// (Eliminado) Exportación a Drive: exportarJSONParaWeb()
// Motivo: el flujo oficial de publicación es publicarWebGitHubPages().

/**
 * Publica los 3 JSON directamente en GitHub Pages (repo 2XFT5League.github.io),
 * sobrescribiendo siempre:
 * - data/jugadores.json
 * - data/calendario.json
 * - data/clasificacion_ordenada.json
 *
 * Requiere Script Properties:
 * - GITHUB_TOKEN
 * - GITHUB_OWNER
 * - GITHUB_REPO
 * - GITHUB_BRANCH
 */
function publicarWebGitHubPages() {
  const owner = getScriptPropRequired_("GITHUB_OWNER");
  const repo = getScriptPropRequired_("GITHUB_REPO");
  const branch = getScriptPropRequired_("GITHUB_BRANCH");
  const token = getScriptPropRequired_("GITHUB_TOKEN");

  const jugadores = buildJugadoresJson_();
  const calendario = buildCalendarioJson_();
  const clasifOrd = buildClasificacionOrdenadaJson_();

  const files = [
    { path: "data/jugadores.json", filename: "jugadores.json", obj: jugadores },
    { path: "data/calendario.json", filename: "calendario.json", obj: calendario },
    { path: "data/clasificacion_ordenada.json", filename: "clasificacion_ordenada.json", obj: clasifOrd }
  ];

  const results = [];

  for (const f of files) {
    const json = JSON.stringify(f.obj, null, 2) + "\n";
    const sha = githubGetFileShaOrNull_(owner, repo, f.path, branch, token);

    githubUpsertFile_({
      owner,
      repo,
      branch,
      token,
      path: f.path,
      contentText: json,
      sha: sha,
      message: `Publicar ${f.filename}`
    });

    results.push(`- ${f.path}`);
  }

  uiAlert_(
    `Web publicada en GitHub Pages.\n\n` +
    `Repo: ${owner}/${repo}\n` +
    `Branch: ${branch}\n\n` +
    `Archivos actualizados:\n` +
    results.join("\n")
  );
}

function getScriptPropRequired_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (v === null || typeof v === "undefined" || String(v).trim() === "") {
    throw new Error(`Falta Script Property "${key}".`);
  }
  return String(v).trim();
}

/**
 * Devuelve el SHA del fichero en GitHub si existe; si no existe, devuelve null.
 */
function githubGetFileShaOrNull_(owner, repo, path, branch, token) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;

  const resp = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json"
    }
  });

  const code = resp.getResponseCode();

  if (code === 200) {
    const data = JSON.parse(resp.getContentText());
    return data && data.sha ? String(data.sha) : null;
  }

  if (code === 404) return null;

  throw new Error(`Error consultando SHA en GitHub (${code}): ${resp.getContentText()}`);
}

/**
 * Crea o actualiza un fichero en GitHub (Contents API).
 * - Si sha es null => crea
 * - Si sha existe => actualiza
 */
function githubUpsertFile_(args) {
  const owner = args.owner;
  const repo = args.repo;
  const branch = args.branch;
  const token = args.token;
  const path = args.path;
  const contentText = args.contentText;
  const sha = args.sha;
  const message = args.message;

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;

  const payload = {
    message: message,
    content: Utilities.base64Encode(contentText, Utilities.Charset.UTF_8),
    branch: branch
  };

  if (sha) payload.sha = sha;

  const resp = UrlFetchApp.fetch(url, {
    method: "put",
    muteHttpExceptions: true,
    contentType: "application/json",
    payload: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json"
    }
  });

  const code = resp.getResponseCode();

  if (code === 200 || code === 201) return;

  throw new Error(`Error publicando en GitHub (${code}): ${resp.getContentText()}`);
}

/** ===== BUILDERS JSON ===== */

function buildJugadoresJson_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.HOJA_JUGADORES);
  if (!sh) throw new Error(`No existe la hoja "${CFG.HOJA_JUGADORES}".`);

  // Exporta TODAS las columnas por cabecera. Requiere "jugador" no vacío.
  const rows = sheetToObjectsPorCabecera_(sh, "jugador");

  // Normalización mínima: boolean "activo"
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(r, "activo")) {
      if (r.activo === "" || r.activo === null || typeof r.activo === "undefined") r.activo = false;
      if (String(r.activo).toUpperCase() === "TRUE") r.activo = true;
      if (String(r.activo).toUpperCase() === "FALSE") r.activo = false;
    }
  }

  return rows;
}

function buildCalendarioJson_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shCal = ss.getSheetByName(CFG.HOJA_CALENDARIO);
  if (!shCal) throw new Error(`No existe la hoja "${CFG.HOJA_CALENDARIO}".`);

  const shJor = ss.getSheetByName(CFG.HOJA_JORNADAS);
  if (!shJor) throw new Error(`No existe la hoja "${CFG.HOJA_JORNADAS}".`);

  const temporadaActiva = leerTemporadaActiva_(shJor, CFG.CELDA_TEMPORADA_ACTIVA);
  const meta = { _meta: "temporada_activa", valor: temporadaActiva };

  // Requiere id_partido no vacío
  const rows = sheetToObjectsPorCabecera_(shCal, "id_partido");

  // Normalizar fechas a YYYY-MM-DD si son Date/serial; marcadores vacíos como ""
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(r, "fecha_inicio")) {
      r.fecha_inicio = normalizeToYMD_(r.fecha_inicio);
    }
    if (Object.prototype.hasOwnProperty.call(r, "fecha_fin")) {
      r.fecha_fin = normalizeToYMD_(r.fecha_fin);
    }

    if (Object.prototype.hasOwnProperty.call(r, "marcadorp1")) {
      r.marcadorp1 = normalizarMarcador_(r.marcadorp1);
    }
    if (Object.prototype.hasOwnProperty.call(r, "marcadorp2")) {
      r.marcadorp2 = normalizarMarcador_(r.marcadorp2);
    }
    if (Object.prototype.hasOwnProperty.call(r, "replay")) {
      r.replay = (r.replay === null || typeof r.replay === "undefined") ? "" : String(r.replay).trim();
    }
  }

  return [meta].concat(rows);
}

function buildClasificacionOrdenadaJson_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // JSON de clasificación sale del HISTÓRICO PUBLICADO
  const shHist = ss.getSheetByName(CFG.HOJA_CLASIF_HIST);
  if (!shHist) throw new Error(`No existe la hoja "${CFG.HOJA_CLASIF_HIST}". Publica una vez la clasificación.`);

  const shJor = ss.getSheetByName(CFG.HOJA_JORNADAS);
  if (!shJor) throw new Error(`No existe la hoja "${CFG.HOJA_JORNADAS}".`);

  const temporadaActiva = leerTemporadaActiva_(shJor, CFG.CELDA_TEMPORADA_ACTIVA);
  const meta = { _meta: "temporada_activa", valor: temporadaActiva };

  // Requiere jugador no vacío
  const rows = sheetToObjectsPorCabecera_(shHist, "jugador");

  return [meta].concat(rows);
}

/** ===== HELPERS EXPORT/JSON ===== */

/**
 * Convierte una hoja (cabecera en fila 1) en array de objetos.
 * - requiredKey: si se indica, solo incluye filas donde requiredKey no sea vacío.
 * - Exporta EXACTAMENTE las cabeceras existentes (no inventa campos).
 */
function sheetToObjectsPorCabecera_(sheet, requiredKey) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const out = [];

  for (const row of data) {
    const obj = {};
    let any = false;

    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;

      let v = row[c];
      if (v === null || typeof v === "undefined") v = "";

      if (typeof v === "string") v = v.trim();

      obj[key] = v;
      if (v !== "") any = true;
    }

    if (!any) continue;

    if (requiredKey) {
      if (!Object.prototype.hasOwnProperty.call(obj, requiredKey)) continue;
      if (obj[requiredKey] === "") continue;
    }

    out.push(obj);
  }

  return out;
}

/**
 * Normaliza fechas para JSON:
 * - Date => "YYYY-MM-DD"
 * - Serial numérico => "YYYY-MM-DD"
 * - String => trim (si ya viene "YYYY-MM-DD" o "DD/MM", lo deja)
 */
function normalizeToYMD_(v) {
  if (v === "" || v === null || typeof v === "undefined") return "";

  // Date real
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  }

  // Serial de Sheets (número) => Date
  if (typeof v === "number" && Number.isFinite(v)) {
    // Sheets serial: días desde 1899-12-30
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(d, tz, "yyyy-MM-dd");
  }

  // Texto: lo dejamos (solo limpiamos)
  return String(v).trim();
}

// (Eliminados) Helpers de Drive: getOrCreateOutputFolder_(), writeJsonFile_()
// Motivo: ya no se exporta JSON a Drive.

/**
 * Publica (persiste) la clasificación ordenada de la temporada activa en el histórico.
 *
 * - Fuente: hoja CFG.HOJA_CLASIF_ORD (vista activa calculada)
 * - Destino: hoja CFG.HOJA_CLASIF_HIST (histórico publicado, multitemporada)
 *
 * Comportamiento:
 * - Elimina del histórico cualquier fila de esa temporada
 * - Inserta la clasificación actual de esa temporada
 * - No toca otras temporadas
 */
function publicarClasificacionTemporadaActiva() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const shOrd = ss.getSheetByName(CFG.HOJA_CLASIF_ORD);
  if (!shOrd) throw new Error(`No existe la hoja "${CFG.HOJA_CLASIF_ORD}".`);

  const shJor = ss.getSheetByName(CFG.HOJA_JORNADAS);
  if (!shJor) throw new Error(`No existe la hoja "${CFG.HOJA_JORNADAS}".`);

  const temporadaActiva = leerTemporadaActiva_(shJor, CFG.CELDA_TEMPORADA_ACTIVA);

  let shHist = ss.getSheetByName(CFG.HOJA_CLASIF_HIST);
  if (!shHist) {
    shHist = ss.insertSheet(CFG.HOJA_CLASIF_HIST);
  }

  // Copiar cabeceras desde clasificacion_ordenada si el histórico está vacío
  asegurarCabecerasDesdeOtraHoja_(shHist, shOrd);

  // Leer cabeceras e índices
  const lastColHist = shHist.getLastColumn();
  const headersHist = shHist.getRange(1, 1, 1, Math.max(1, lastColHist)).getValues()[0].map(h => String(h || "").trim());
  const idxTempHist = headersHist.indexOf("temporada");

  if (idxTempHist === -1) {
    throw new Error(`En "${CFG.HOJA_CLASIF_HIST}" falta la columna "temporada".`);
  }

  // Leer histórico completo (como filas)
  const lastRowHist = shHist.getLastRow();
  let historico = [];
  if (lastRowHist >= 2) {
    const dataHist = shHist.getRange(2, 1, lastRowHist - 1, headersHist.length).getValues();
    for (const row of dataHist) {
      const any = row.some(v => v !== "" && v !== null && typeof v !== "undefined");
      if (!any) continue;
      historico.push(row);
    }
  }

  // Filtrar: conservar solo temporadas != activa
  const historicoFiltrado = historico.filter(row => {
    const t = toIntOrNull_(row[idxTempHist]);
    return t !== temporadaActiva;
  });

  // Leer la vista activa actual (clasificacion_ordenada) como filas (mismas cabeceras)
  const lastColOrd = shOrd.getLastColumn();
  const headersOrd = shOrd.getRange(1, 1, 1, Math.max(1, lastColOrd)).getValues()[0].map(h => String(h || "").trim());
  const idxTempOrd = headersOrd.indexOf("temporada");

  if (idxTempOrd === -1) {
    throw new Error(`En "${CFG.HOJA_CLASIF_ORD}" falta la columna "temporada".`);
  }

  const lastRowOrd = shOrd.getLastRow();
  let temporadaActualFilas = [];
  if (lastRowOrd >= 2) {
    const dataOrd = shOrd.getRange(2, 1, lastRowOrd - 1, headersOrd.length).getValues();

    for (const row of dataOrd) {
      const any = row.some(v => v !== "" && v !== null && typeof v !== "undefined");
      if (!any) continue;

      const t = toIntOrNull_(row[idxTempOrd]);
      if (t !== temporadaActiva) continue;

      // Convertir la fila al formato de columnas del histórico por nombre de cabecera
      const mapped = mapRowByHeaders_(row, headersOrd, headersHist);
      temporadaActualFilas.push(mapped);
    }
  }

  // Reescribir histórico completo
  shHist.getRange(2, 1, shHist.getMaxRows() - 1, headersHist.length).clearContent();

  const total = historicoFiltrado.concat(temporadaActualFilas);

  if (total.length > 0) {
    shHist.getRange(2, 1, total.length, headersHist.length).setValues(total);
  }

  shHist.setFrozenRows(1);

  uiAlert_(
    `Clasificación publicada.\n\n` +
    `Temporada activa: ${temporadaActiva}\n` +
    `Filas publicadas de la temporada: ${temporadaActualFilas.length}\n` +
    `Filas totales en histórico: ${total.length}`
  );
}

/**
 * Si la hoja destino está vacía (cabecera vacía), copia cabeceras desde otra hoja.
 */
function asegurarCabecerasDesdeOtraHoja_(shDestino, shOrigen) {
  const lastColOrigen = shOrigen.getLastColumn();
  const headersOrigen = shOrigen.getRange(1, 1, 1, Math.max(1, lastColOrigen)).getValues()[0].map(h => String(h || "").trim());

  const rngDest = shDestino.getRange(1, 1, 1, Math.max(1, headersOrigen.length));
  const cur = rngDest.getValues()[0];

  const vacias = cur.every(x => String(x || "").trim() === "");
  if (vacias) {
    shDestino.getRange(1, 1, 1, headersOrigen.length).setValues([headersOrigen]);
  }

  shDestino.setFrozenRows(1);
}

/**
 * Reordena/mappea una fila según cabeceras (origen -> destino).
 * Si una cabecera destino no existe en origen, se deja "".
 */
function mapRowByHeaders_(rowOrigen, headersOrigen, headersDestino) {
  const idxOrigen = {};
  for (let i = 0; i < headersOrigen.length; i++) {
    const h = String(headersOrigen[i] || "").trim();
    if (h) idxOrigen[h] = i;
  }

  const out = new Array(headersDestino.length).fill("");
  for (let j = 0; j < headersDestino.length; j++) {
    const h = String(headersDestino[j] || "").trim();
    if (!h) continue;

    const i = Object.prototype.hasOwnProperty.call(idxOrigen, h) ? idxOrigen[h] : -1;
    if (i === -1) continue;

    const v = rowOrigen[i];
    out[j] = (v === null || typeof v === "undefined") ? "" : v;
  }

  return out;
}
