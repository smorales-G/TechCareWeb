require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const multer = require('multer');
const SpiderApi = require('./spiderApi');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer — almacenamiento en memoria para subir a SpiderAPI Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB por archivo
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|webm|avi/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (allowed.test(ext)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido'));
  }
});

// Setup Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'techcare-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 días
}));

// ================= Middleware auth =================
const requireAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

const requireTech = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'technician') return next();
  res.status(403).send('Acceso denegado: solo técnicos');
};

const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).send('Acceso denegado: solo administradores');
};

// Pasar user a todas las vistas
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ================= Helpers =================
async function uploadFileToStorage(buffer, originalName) {
  try {
    const url = await SpiderApi.uploadFile(buffer, originalName);
    return url;
  } catch (err) {
    console.error('Error al subir archivo:', err.message);
    return null;
  }
}

// ================= Routes =================

// Index
app.get('/', (req, res) => res.render('index'));

// Auth Routes
app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register', { error: null }));

// Registro con foto de perfil opcional
app.post('/register', upload.single('profile_picture'), async (req, res) => {
  try {
    const { username, email, password, tech_code } = req.body;

    if (!username || !email || !password) {
      return res.render('register', { error: 'Todos los campos son obligatorios.' });
    }

    const existing = await SpiderApi.query(`SELECT id FROM users WHERE email = '${email.replace(/'/g, "''")}'`);
    if (existing && existing.length > 0) {
      return res.render('register', { error: 'El email ya está registrado.' });
    }

    const hashed = await bcrypt.hash(password, 10);
    let role = 'client';
    if (tech_code === 'TECHCARE2026') role = 'technician';
    else if (tech_code === 'ADMIN2026') role = 'admin';

    // Subir foto de perfil si existe
    let profilePicUrl = null;
    if (req.file) {
      const uploaded = await SpiderApi.uploadFile(req.file.buffer, req.file.originalname);
      if (uploaded && uploaded.url) profilePicUrl = uploaded.url;
    }

    const profilePicSql = profilePicUrl ? `'${profilePicUrl}'` : 'NULL';
    await SpiderApi.query(
      `INSERT INTO users (username, password, email, role, profile_picture) VALUES ('${username.replace(/'/g,"''")}', '${hashed}', '${email.replace(/'/g,"''")}', '${role}', ${profilePicSql})`
    );
    res.redirect('/login');
  } catch (err) {
    console.error('Register error:', err);
    res.render('register', { error: 'Ocurrió un error durante el registro.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = await SpiderApi.query(`SELECT * FROM users WHERE email = '${email.replace(/'/g,"''")}'`);
    if (!users || users.length === 0) return res.render('login', { error: 'Credenciales inválidas.' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render('login', { error: 'Credenciales inválidas.' });

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      profile_picture: user.profile_picture || null
    };

    if (user.role === 'admin') res.redirect('/admin/dashboard');
    else if (user.role === 'technician') res.redirect('/tech/dashboard');
    else res.redirect('/client/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'Ocurrió un error al iniciar sesión.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ================= Client Routes =================

app.get('/client/dashboard', requireAuth, async (req, res) => {
  if (req.session.user.role === 'technician') return res.redirect('/tech/dashboard');
  if (req.session.user.role === 'admin') return res.redirect('/admin/dashboard');
  try {
    const requests = await SpiderApi.query(
      `SELECT * FROM requests WHERE client_id = ${req.session.user.id} ORDER BY created_at DESC`
    );
    res.render('client_dashboard', { requests: requests || [] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el dashboard.');
  }
});

app.get('/client/request/new', requireAuth, (req, res) => {
  if (req.session.user.role !== 'client') return res.redirect('/client/dashboard');
  res.render('new_request');
});

// Nueva solicitud con subida de fotos/videos
app.post('/client/request/new', requireAuth, upload.array('media', 5), async (req, res) => {
  try {
    const { title, description, additional_info } = req.body;
    const clientId = req.session.user.id;

    await SpiderApi.query(
      `INSERT INTO requests (client_id, title, description, additional_info, status) VALUES (${clientId}, '${title.replace(/'/g,"''")}', '${description.replace(/'/g,"''")}', '${(additional_info||'').replace(/'/g,"''")}', 'pendiente')`
    );

    const lastReq = await SpiderApi.query(
      `SELECT id FROM requests WHERE client_id = ${clientId} ORDER BY created_at DESC LIMIT 1`
    );
    if (!lastReq || lastReq.length === 0) return res.redirect('/client/dashboard');

    const reqId = lastReq[0].id;

    // Historial inicial
    await SpiderApi.query(
      `INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'pendiente', 'Solicitud creada por el cliente.')`
    );

    // Subir archivos adjuntos
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const uploaded = await SpiderApi.uploadFile(file.buffer, file.originalname);
          if (uploaded && uploaded.url) {
            await SpiderApi.query(
              `INSERT INTO request_media (request_id, media_url) VALUES (${reqId}, '${uploaded.url}')`
            );
          }
        } catch (fileErr) {
          console.error('Error subiendo archivo:', fileErr.message);
        }
      }
    }

    res.redirect('/client/dashboard');
  } catch (err) {
    console.error('New request error:', err);
    res.status(500).send('Error al crear la solicitud.');
  }
});

// Ver detalle de solicitud con historial
app.get('/client/request/:id', requireAuth, async (req, res) => {
  try {
    const reqId = req.params.id;
    const clientId = req.session.user.id;

    const reqs = await SpiderApi.query(
      `SELECT * FROM requests WHERE id = ${reqId} AND client_id = ${clientId}`
    );
    if (!reqs || reqs.length === 0) return res.status(404).send('Solicitud no encontrada.');

    const history = await SpiderApi.query(
      `SELECT * FROM history WHERE request_id = ${reqId} ORDER BY created_at DESC`
    );
    const media = await SpiderApi.query(`SELECT * FROM request_media WHERE request_id = ${reqId}`);
    const messages = await SpiderApi.query(
      `SELECT m.*, u.username as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.request_id = ${reqId} ORDER BY m.created_at ASC`
    );

    res.render('request_detail', {
      request: reqs[0],
      history: history || [],
      media: media || [],
      messages: messages || []
    });
  } catch (err) {
    console.error('Request detail error:', err);
    res.status(500).send('Error al cargar la solicitud.');
  }
});

// Acción cliente: aceptar o rechazar presupuesto (esperando_aprobacion → en_reparacion | cancelado)
app.post('/client/request/:id/action', requireAuth, async (req, res) => {
  try {
    const { action } = req.body;
    const reqId = req.params.id;
    const clientId = req.session.user.id;

    const reqs = await SpiderApi.query(
      `SELECT * FROM requests WHERE id = ${reqId} AND client_id = ${clientId} AND status IN ('esperando_aprobacion','esperando_respuesta_cliente')`
    );
    if (!reqs || reqs.length === 0) return res.status(403).send('Acción no permitida en este estado.');

    const newStatus = action === 'accept' ? 'en_reparacion' : 'cancelado';
    const notes = action === 'accept'
      ? 'El cliente aceptó el presupuesto. Dispositivo en reparación.'
      : 'El cliente rechazó el presupuesto. Solicitud cancelada.';

    await SpiderApi.query(`UPDATE requests SET status = '${newStatus}' WHERE id = ${reqId}`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, '${newStatus}', '${notes}')`);
    await SpiderApi.query(`INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${clientId}, 'client', '${notes}')`);

    res.redirect('/client/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar la solicitud.');
  }
});

// ================= Tech Routes =================

// Estados activos y cerrados del flujo optimizado v2
const ACTIVE_STATUSES = `'pendiente','en_revision','en_coordinacion','en_recepcion','en_diagnostico','esperando_aprobacion','en_reparacion','esperando_repuestos','listo_para_retiro'`;
const CLOSED_STATUSES = `'completado','cancelado','cancelado_por_tecnico','producto_no_recibido','finalizado'`;

// Tiempos estimados por estado
const ESTIMATED_TIMES = {
  pendiente: 'Inmediato',
  en_revision: '1 a 4 horas laborables',
  en_coordinacion: '12 a 24 horas',
  en_recepcion: '15 a 30 minutos',
  en_diagnostico: '24 a 48 horas',
  esperando_aprobacion: '1 a 3 días',
  en_reparacion: '1 a 5 días',
  esperando_repuestos: 'Variable (pendiente de componentes)',
  listo_para_retiro: 'Retiro inmediato',
  completado: 'Cerrado',
};

app.get('/tech/dashboard', requireTech, async (req, res) => {
  try {
    const { filter } = req.query;
    let whereClause = '';
    if (filter === 'active') whereClause = `WHERE r.status IN (${ACTIVE_STATUSES})`;
    else if (filter === 'closed') whereClause = `WHERE r.status IN (${CLOSED_STATUSES})`;

    const requests = await SpiderApi.query(`
      SELECT r.*, u.username as client_name, u.email as client_email
      FROM requests r
      JOIN users u ON r.client_id = u.id
      ${whereClause}
      ORDER BY FIELD(r.status,'pendiente','en_revision','en_coordinacion','en_recepcion','en_diagnostico','esperando_aprobacion','en_reparacion','esperando_repuestos','listo_para_retiro'), r.created_at DESC
    `);

    const requestsWithMedia = await Promise.all((requests || []).map(async r => {
      try {
        const media = await SpiderApi.query(`SELECT * FROM request_media WHERE request_id = ${r.id}`);
        const lastMsg = await SpiderApi.query(`SELECT * FROM messages WHERE request_id = ${r.id} ORDER BY created_at DESC LIMIT 1`);
        return { ...r, media: media || [], lastMsg: lastMsg?.[0] || null, estimatedTime: ESTIMATED_TIMES[r.status] || '' };
      } catch { return { ...r, media: [], lastMsg: null, estimatedTime: '' }; }
    }));

    res.render('tech_dashboard', { requests: requestsWithMedia, filter: filter || 'all', ESTIMATED_TIMES });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el panel técnico.');
  }
});

// ESTADO 2: Técnico acepta → en_revision (pendiente → en_revision)
app.post('/tech/request/:id/accept', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { tech_response } = req.body;
    const techId = req.session.user.id;
    const response = (tech_response || '').replace(/'/g, "''");
    if (!response) return res.status(400).send('El mensaje es obligatorio.');

    await SpiderApi.query(
      `UPDATE requests SET status = 'en_revision', tech_response = '${response}', assigned_tech_id = ${techId} WHERE id = ${reqId} AND status = 'pendiente'`
    );
    await SpiderApi.query(
      `INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'en_revision', 'Técnico inició revisión: ${response}')`
    );
    // Mensaje automático en el chat
    await SpiderApi.query(
      `INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${techId}, 'technician', '${response}')`
    );
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

// ESTADO 2b: Técnico cancela (pendiente → cancelado)
app.post('/tech/request/:id/cancel', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { tech_response } = req.body;
    const techId = req.session.user.id;
    const response = (tech_response || 'La solicitud no puede ser atendida en este momento.').replace(/'/g, "''");

    await SpiderApi.query(
      `UPDATE requests SET status = 'cancelado', tech_response = '${response}' WHERE id = ${reqId} AND status = 'pendiente'`
    );
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'cancelado', 'Solicitud cancelada: ${response}')`);
    await SpiderApi.query(`INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${techId}, 'technician', 'Lamentamos informarte que tu solicitud fue cancelada: ${response}')`);
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

// ESTADO 3: Técnico confirma coordinación (en_revision → en_coordinacion)
app.post('/tech/request/:id/coordinate', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { notes } = req.body;
    const techId = req.session.user.id;
    const notesVal = (notes || 'Solicitud aceptada. Coordinemos la entrega del dispositivo.').replace(/'/g, "''");

    await SpiderApi.query(`UPDATE requests SET status = 'en_coordinacion' WHERE id = ${reqId} AND status = 'en_revision'`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'en_coordinacion', '${notesVal}')`);
    await SpiderApi.query(`INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${techId}, 'technician', '${notesVal}')`);
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

// ESTADO 4a: Técnico marca producto como recibido (en_coordinacion → en_recepcion)
app.post('/tech/request/:id/arrived', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { notes } = req.body;
    const techId = req.session.user.id;
    const notesVal = (notes || 'Dispositivo recibido en el taller. Registrando estado físico.').replace(/'/g, "''");

    await SpiderApi.query(`UPDATE requests SET status = 'en_recepcion' WHERE id = ${reqId} AND status = 'en_coordinacion'`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'en_recepcion', '${notesVal}')`);
    // Mensaje automático al cliente
    await SpiderApi.query(`INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${techId}, 'bot', '✅ Hemos recibido tu equipo y está en la fila de diagnóstico. Te notificaremos cuando tengamos el informe.')`);
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

// ESTADO 4b: Inicio de diagnóstico (en_recepcion → en_diagnostico)
app.post('/tech/request/:id/start-diagnosis', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { notes } = req.body;
    const notesVal = (notes || 'Dispositivo en diagnóstico técnico.').replace(/'/g, "''");

    await SpiderApi.query(`UPDATE requests SET status = 'en_diagnostico' WHERE id = ${reqId} AND status = 'en_recepcion'`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'en_diagnostico', '${notesVal}')`);
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

// ESTADO 4c: No recibido/cancelado (en_coordinacion → cancelado)
app.post('/tech/request/:id/not-received', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { notes } = req.body;
    const techId = req.session.user.id;
    const notesVal = (notes || 'El cliente no entregó el dispositivo. Solicitud cancelada.').replace(/'/g, "''");

    await SpiderApi.query(`UPDATE requests SET status = 'cancelado' WHERE id = ${reqId} AND status IN ('en_coordinacion','en_recepcion')`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'cancelado', '${notesVal}')`);
    await SpiderApi.query(`INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${techId}, 'technician', '${notesVal}')`);
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

// ESTADO 5: Técnico envía diagnóstico (en_diagnostico → esperando_aprobacion)
app.post('/tech/request/:id/diagnosis', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { diagnosis, price, notes } = req.body;
    const techId = req.session.user.id;
    if (!diagnosis || !price) return res.status(400).send('Diagnóstico y precio son obligatorios.');

    const diagVal = diagnosis.replace(/'/g, "''");
    const notesVal = (notes || `Diagnóstico completo. Presupuesto: $${price}.`).replace(/'/g, "''");

    await SpiderApi.query(
      `UPDATE requests SET status = 'esperando_aprobacion', diagnosis = '${diagVal}', price = ${parseFloat(price)} WHERE id = ${reqId} AND status = 'en_diagnostico'`
    );
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'esperando_aprobacion', '${notesVal}')`);
    const priceFormatted = parseFloat(price).toLocaleString('es-AR');
    await SpiderApi.query(`INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${techId}, 'technician', 'Diagnostico listo: ${diagVal}. Presupuesto: $${priceFormatted}. Acepta continuar con la reparacion?')`);
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error al cargar el diagnóstico.'); }
});

// ESTADO 7: Técnico marca como en reparación (esperando_aprobacion/en_reparacion pueden coexistir)
// Este endpoint lo activa el sistema al aceptar el cliente (ver cliente routes)

// ESTADO 7b: Sub-estado esperando repuestos (en_reparacion → esperando_repuestos)
app.post('/tech/request/:id/waiting-parts', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { notes } = req.body;
    const techId = req.session.user.id;
    const notesVal = (notes || 'En espera de repuestos o componentes para continuar.').replace(/'/g, "''");

    await SpiderApi.query(`UPDATE requests SET status = 'esperando_repuestos' WHERE id = ${reqId} AND status = 'en_reparacion'`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'esperando_repuestos', '${notesVal}')`);
    await SpiderApi.query(`INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${techId}, 'technician', '⏳ Actualización: ${notesVal}')`);
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

// ESTADO 8: Reparación completada, listo para retiro (en_reparacion|esperando_repuestos → listo_para_retiro)
app.post('/tech/request/:id/repaired', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { notes } = req.body;
    const techId = req.session.user.id;
    const notesVal = (notes || 'Reparación completada y testeada. Dispositivo listo para retirar.').replace(/'/g, "''");

    await SpiderApi.query(`UPDATE requests SET status = 'listo_para_retiro' WHERE id = ${reqId} AND status IN ('en_reparacion','esperando_repuestos')`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'listo_para_retiro', '${notesVal}')`);
    await SpiderApi.query(`INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${techId}, 'bot', '🎉 ¡Excelente noticia! Tu dispositivo está reparado y listo para retirar. Coordiná con nosotros el horario y el pago final.')`);
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

// ESTADO 9: Técnico confirma entrega final (listo_para_retiro → completado)
app.post('/tech/request/:id/delivered', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { notes } = req.body;
    const notesVal = (notes || 'Dispositivo entregado al cliente. Servicio completado y cobrado.').replace(/'/g, "''");

    await SpiderApi.query(`UPDATE requests SET status = 'completado' WHERE id = ${reqId} AND status IN ('listo_para_retiro','en_negociacion_devolucion','finalizado','en_devolucion')`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, 'completado', '${notesVal}')`);
    res.redirect('/tech/dashboard');
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

// ================= Chat API =================

// GET: obtener mensajes de una solicitud
app.get('/request/:id/messages', requireAuth, async (req, res) => {
  try {
    const reqId = req.params.id;
    const msgs = await SpiderApi.query(
      `SELECT m.*, u.username as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.request_id = ${reqId} ORDER BY m.created_at ASC`
    );
    res.json(msgs || []);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

// POST: enviar mensaje en el chat de una solicitud
app.post('/request/:id/message', requireAuth, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { content } = req.body;
    const senderId = req.session.user.id;
    const senderRole = req.session.user.role === 'technician' ? 'technician' : 'client';

    if (!content || !content.trim()) return res.status(400).json({ error: 'Mensaje vacío.' });

    const safeContent = content.trim().replace(/'/g, "''");
    await SpiderApi.query(
      `INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (${reqId}, ${senderId}, '${senderRole}', '${safeContent}')`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar mensaje.' });
  }
});

// ================= Admin Routes =================

app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const users = await SpiderApi.query(
      `SELECT id, username, email, role, profile_picture, created_at FROM users ORDER BY created_at DESC`
    );
    res.render('admin_dashboard', { users: users || [] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el panel de administración.');
  }
});

app.post('/admin/user/:id/role', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;
    if (!['client', 'technician', 'admin'].includes(role)) return res.status(400).send('Rol inválido.');
    await SpiderApi.query(`UPDATE users SET role = '${role}' WHERE id = ${userId}`);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar el rol.');
  }
});

// ================= SpiderIA Chatbot =================

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const reply = await SpiderApi.chat(messages);
    res.json(reply);
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Error al comunicarse con la IA.' });
  }
});

// ================= Start =================

app.listen(PORT, () => {
  console.log(`✅ TechCare.mza running → http://localhost:${PORT}`);
});
