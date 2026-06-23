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
    const media = await SpiderApi.query(
      `SELECT * FROM request_media WHERE request_id = ${reqId}`
    );

    res.render('request_detail', {
      request: reqs[0],
      history: history || [],
      media: media || []
    });
  } catch (err) {
    console.error('Request detail error:', err);
    res.status(500).send('Error al cargar la solicitud.');
  }
});

// Acción cliente: aceptar o rechazar diagnóstico
app.post('/client/request/:id/action', requireAuth, async (req, res) => {
  try {
    const { action } = req.body;
    const reqId = req.params.id;
    const newStatus = action === 'accept' ? 'reparacion_aceptada' : 'en_proceso_de_devolucion';
    const notes = action === 'accept' ? 'El cliente aceptó el presupuesto.' : 'El cliente rechazó el presupuesto.';

    await SpiderApi.query(`UPDATE requests SET status = '${newStatus}' WHERE id = ${reqId} AND client_id = ${req.session.user.id}`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, '${newStatus}', '${notes}')`);

    res.redirect('/client/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar la solicitud.');
  }
});

// ================= Tech Routes =================

app.get('/tech/dashboard', requireTech, async (req, res) => {
  try {
    const requests = await SpiderApi.query(`
      SELECT r.*, u.username as client_name
      FROM requests r
      JOIN users u ON r.client_id = u.id
      ORDER BY r.created_at DESC
    `);

    // Obtener media para cada solicitud
    const requestsWithMedia = await Promise.all((requests || []).map(async r => {
      try {
        const media = await SpiderApi.query(`SELECT * FROM request_media WHERE request_id = ${r.id}`);
        return { ...r, media: media || [] };
      } catch { return { ...r, media: [] }; }
    }));

    res.render('tech_dashboard', { requests: requestsWithMedia });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el panel técnico.');
  }
});

app.post('/tech/request/:id/status', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { status, diagnosis, price, notes } = req.body;

    let updates = `status = '${status}'`;
    if (diagnosis) updates += `, diagnosis = '${diagnosis.replace(/'/g,"''")}'`;
    if (price) updates += `, price = ${parseFloat(price)}`;

    await SpiderApi.query(`UPDATE requests SET ${updates} WHERE id = ${reqId}`);
    await SpiderApi.query(
      `INSERT INTO history (request_id, status, notes) VALUES (${reqId}, '${status}', '${(notes||'Estado actualizado por el técnico').replace(/'/g,"''")}')`
    );

    res.redirect('/tech/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar el estado.');
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
