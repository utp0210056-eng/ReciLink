/* db.js - implementación con localStorage para ReciLink
   API pública:
   - DB.openDB() -> Promise
   - validarAdmin(usuario, pass) -> Promise<boolean>
   - ReciLinkDB.listarPrecios(), listarHistorialPrecios(), cambiarPrecio(...)
   - ReciLinkDB.registrarReciclaje(material,kilos,nota)
   - ReciLinkDB.listarRegistros(), obtenerRegistro(id), eliminarRegistro(id)
   - ReciLinkDB.calcularEstadisticas(), ReciLinkDB.exportCSV()
   - ReciLinkDB.obtenerRegistrosPorFecha(inicio,fin)
   - ReciLinkDB.obtenerTotales(registros)
   - ReciLinkDB.exportarRegistrosCSV(registros, filename)
*/

(function () {
  // Keys
  const K_ADM = "ReciLink_admins";
  const K_PRE = "ReciLink_precios";
  const K_PH = "ReciLink_precioHistorial";
  const K_REG = "ReciLink_registros";
  const K_CNT = "ReciLink_counters";

  // Helpers
  function read(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : (fallback === undefined ? null : fallback);
    } catch (e) {
      console.error("LS read error", e);
      return fallback === undefined ? null : fallback;
    }
  }
  function write(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.error("LS write error", e);
      return false;
    }
  }

  function ensureCounters() {
    const c = read(K_CNT, null) || { registroId: 1, precioHistId: 1 };
    write(K_CNT, c);
    return c;
  }
  function nextRegistroId() {
    const c = ensureCounters();
    const id = c.registroId++;
    write(K_CNT, c);
    return id;
  }
  function nextPrecioHistId() {
    const c = ensureCounters();
    const id = c.precioHistId++;
    write(K_CNT, c);
    return id;
  }

  // Seed: admin y precios
  (function seed() {
    // admin
    let admins = read(K_ADM, null);
    if (!admins) {
      admins = [{ usuario: "ReciLink", nombre: "Administrador Principal", correo: "", carrera: "", password: "ChalupasLocas24", rol: "admin", totalReciclado: 0 }];
      write(K_ADM, admins);
      console.log("Seed: admin creado");
    }

    // precios
    let precios = read(K_PRE, null);
    const now = new Date().toISOString();
    if (!precios) {
      precios = [
        { material: "PET", precioActual: 4.0, fechaActualizacion: now },
        { material: "Aluminio", precioActual: 37.0, fechaActualizacion: now },
        { material: "Carton", precioActual: 2.0, fechaActualizacion: now }
      ];
      write(K_PRE, precios);
      // seed historial
      const ph = precios.map(p => ({ id: nextPrecioHistId(), material: p.material, precioAnterior: 0, precioActual: p.precioActual, fechaCambio: now }));
      write(K_PH, ph);
      console.log("Seed: precios creados");
    }
    // registros array
    let regs = read(K_REG, null);
    if (!regs) {
      write(K_REG, []);
    }
  })();

  // Expose a minimal DB object for compatibility
  window.DB = {
    openDB: function () { return Promise.resolve(true); } // no-op but kept for compatibility
  };

  // validarAdmin(usuario,password)
  async function validarAdmin(usuario, password) {
    return new Promise((res) => {
      const admins = read(K_ADM, []);
      const a = admins.find(x => x.usuario === usuario);
      if (!a) return res(false);
      return res(a.password === password);
    });
  }

  // Precios
  async function listarPrecios() {
    return Promise.resolve(read(K_PRE, []));
  }
  async function listarHistorialPrecios() {
    return Promise.resolve(read(K_PH, []));
  }
  async function cambiarPrecio(material, nuevoPrecio) {
    return new Promise((res, rej) => {
      try {
        const precios = read(K_PRE, []);
        const p = precios.find(x => x.material === material);
        if (!p) return rej("Material no encontrado");
        const anterior = p.precioActual;
        p.precioActual = Number(nuevoPrecio);
        p.fechaActualizacion = new Date().toISOString();
        write(K_PRE, precios);

        // agregar al historial (al inicio)
        const ph = read(K_PH, []);
        ph.unshift({ id: nextPrecioHistId(), material, precioAnterior: anterior, precioActual: Number(nuevoPrecio), fechaCambio: new Date().toISOString() });
        write(K_PH, ph);
        res(true);
      } catch (e) { rej(e.message || e); }
    });
  }

  // Registros (reciclaje)
  async function registrarReciclaje(material, kilos, nota = "") {
    return new Promise((res, rej) => {
      try {
        if (!["PET", "Aluminio", "Carton"].includes(material)) return rej("Material inválido");
        kilos = Number(kilos);
        if (isNaN(kilos) || kilos <= 0) return rej("Kilos inválidos");

        const precios = read(K_PRE, []);
        const p = precios.find(x => x.material === material);
        const precioPorKg = p ? Number(p.precioActual) : 0;
        const total = Number((kilos * precioPorKg).toFixed(2));
        const regs = read(K_REG, []);
        const id = nextRegistroId();
        const item = { id, fecha: new Date().toISOString(), material, kilos: Number(kilos), precioPorKg, total, nota };
        regs.push(item);
        write(K_REG, regs);

        // actualizar totalReciclado en admin (opcional)
        const admins = read(K_ADM, []);
        const admin = admins.find(a => a.usuario === "ReciLink");
        if (admin) {
          admin.totalReciclado = (admin.totalReciclado || 0) + Number(total);
          write(K_ADM, admins);
        }

        res(Object.assign({ id }, item));
      } catch (e) { rej(e.message || e); }
    });
  }

  async function listarRegistros() {
    return Promise.resolve(read(K_REG, []).slice());
  }

  async function obtenerRegistro(id) {
    return new Promise((res) => {
      const regs = read(K_REG, []);
      res(regs.find(r => Number(r.id) === Number(id)) || null);
    });
  }

  async function eliminarRegistro(id) {
    return new Promise((res, rej) => {
      try {
        let regs = read(K_REG, []);
        regs = regs.filter(r => Number(r.id) !== Number(id));
        write(K_REG, regs);
        res(true);
      } catch (e) { rej(e.message || e); }
    });
  }

  async function calcularEstadisticas() {
    return new Promise((res) => {
      const regs = read(K_REG, []);
      const totals = { PET: 0, Aluminio: 0, Carton: 0, totalKg: 0, totalGasto: 0 };
      regs.forEach(r => {
        if (r.material === "PET") totals.PET += Number(r.kilos);
        else if (r.material === "Aluminio") totals.Aluminio += Number(r.kilos);
        else if (r.material === "Carton") totals.Carton += Number(r.kilos);
        totals.totalKg += Number(r.kilos);
        totals.totalGasto += Number(r.total || 0);
      });
      for (const k of ["PET", "Aluminio", "Carton", "totalKg", "totalGasto"]) totals[k] = Number((totals[k] || 0).toFixed(2));
      res(totals);
    });
  }

  // Export CSV (todos los registros)
  async function exportCSV(filename = "reporte_recilink.csv") {
    return new Promise((res, rej) => {
      try {
        const regs = read(K_REG, []);
        let csv = "id,fecha,material,kilos,precioPorKg,total,nota\n";
        regs.forEach(r => {
          const note = (r.nota || "").toString().replace(/"/g, '""');
          csv += `${r.id},"${r.fecha}",${r.material},${r.kilos},${r.precioPorKg},${r.total},"${note}"\n`;
        });
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        res(true);
      } catch (e) { rej(e.message || e); }
    });
  }

  // Obtener registros entre dos fechas (inicio, fin) - acepta ISO strings o Date
  async function obtenerRegistrosPorFecha(inicio, fin) {
    return new Promise((res) => {
      const lista = read(K_REG, []);
      const a = new Date(inicio);
      const b = new Date(fin);
      // normalize times (if both dates have no time component, keep as is)
      const filtrados = lista.filter(r => {
        const f = new Date(r.fecha);
        return f >= a && f <= b;
      });
      res(filtrados);
    });
  }

  // Obtener totales a partir de un array de registros
  function obtenerTotales(registros) {
    const t = { PET:0, Aluminio:0, Carton:0, totalKg:0, total$:0 };

    registros.forEach(r => {
      if (r.material === "PET") t.PET += Number(r.kilos);
      else if (r.material === "Aluminio") t.Aluminio += Number(r.kilos);
      else if (r.material === "Carton") t.Carton += Number(r.kilos);
      t.totalKg += Number(r.kilos);
      t.total$ += Number(r.total || 0);
    });

    return {
      PET: Number(t.PET.toFixed(2)),
      Aluminio: Number(t.Aluminio.toFixed(2)),
      Carton: Number(t.Carton.toFixed(2)),
      totalKg: Number(t.totalKg.toFixed(2)),
      total$: Number(t.total$.toFixed(2))
    };
  }

  // Exportar registros filtrados a CSV
  function exportarRegistrosCSV(registros, filename = "reporte_filtrado.csv") {
    try {
      let csv = "id,fecha,material,kilos,precioPorKg,total,nota\n";
      registros.forEach(r => {
        const note = (r.nota || "").toString().replace(/"/g, '""');
        csv += `${r.id},"${r.fecha}",${r.material},${r.kilos},${r.precioPorKg},${r.total},"${note}"\n`;
      });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.error("exportarRegistrosCSV error", e);
      return false;
    }
  }

  // Expose API similar to previous design
  window.validarAdmin = validarAdmin;

  window.ReciLinkDB = {
    openDB: () => Promise.resolve(true),
    // precios
    listarPrecios,
    listarHistorialPrecios,
    cambiarPrecio,
    // registros
    registrarReciclaje,
    listarRegistros,
    obtenerRegistro,
    eliminarRegistro,
    // stats & export
    calcularEstadisticas,
    exportCSV,
    // reportes / filtros
    obtenerRegistrosPorFecha,
    obtenerTotales,
    exportarRegistrosCSV
  };

  // Backwards-compatible alias (if any script expects DB or ReciLinkDB)
  window.DB = window.DB || { openDB: () => Promise.resolve(true) };

  console.log("db.js (localStorage) cargado - ReciLink listo.");
})();
