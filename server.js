require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const SpiderApi = require('./spiderApi');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: 'techcare-secret-key-2026',
  resave: false,
  saveUninitialized: false
}));

// Middleware to protect routes
const requireAuth = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
};

const requireTech = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'technician') {
    next();
  } else {
    res.status(403).send('Forbidden: Technicians only');
  }
};

const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    next();
  } else {
    res.status(403).send('Forbidden: Admins only');
  }
};

// Pass user to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ================= Routes =================

// Index
app.get('/', (req, res) => {
  res.render('index');
});

// Auth Routes
app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
  try {
    const { username, email, password, tech_code } = req.body;
    
    // Check if user exists
    const existing = await SpiderApi.query(`SELECT * FROM users WHERE email = '${email}'`);
    if (existing && existing.length > 0) {
      return res.render('register', { error: 'Email already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);
    let role = 'client';
    if (tech_code === 'TECHCARE2026') role = 'technician';
    else if (tech_code === 'ADMIN2026') role = 'admin';

    await SpiderApi.query(`INSERT INTO users (username, password, email, role) VALUES ('${username}', '${hashed}', '${email}', '${role}')`);
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.render('register', { error: 'An error occurred during registration.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = await SpiderApi.query(`SELECT * FROM users WHERE email = '${email}'`);
    if (!users || users.length === 0) return res.render('login', { error: 'Invalid credentials' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render('login', { error: 'Invalid credentials' });

    req.session.user = { id: user.id, username: user.username, role: user.role };
    
    if (user.role === 'admin') res.redirect('/admin/dashboard');
    else if (user.role === 'technician') res.redirect('/tech/dashboard');
    else res.redirect('/client/dashboard');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'An error occurred during login.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Client Routes
app.get('/client/dashboard', requireAuth, async (req, res) => {
  if (req.session.user.role === 'technician') return res.redirect('/tech/dashboard');
  try {
    const requests = await SpiderApi.query(`SELECT * FROM requests WHERE client_id = ${req.session.user.id} ORDER BY created_at DESC`);
    res.render('client_dashboard', { requests });
  } catch (err) {
    res.status(500).send('Error loading dashboard');
  }
});

app.get('/client/request/new', requireAuth, (req, res) => {
  res.render('new_request');
});

app.post('/client/request/new', requireAuth, async (req, res) => {
  try {
    const { title, description, additional_info } = req.body;
    // For media uploads we would use multer, skipping for basic logic right now
    await SpiderApi.query(`INSERT INTO requests (client_id, title, description, additional_info, status) VALUES (${req.session.user.id}, '${title}', '${description}', '${additional_info || ''}', 'pendiente')`);
    
    // Get last inserted id to insert history
    const lastReq = await SpiderApi.query(`SELECT id FROM requests WHERE client_id = ${req.session.user.id} ORDER BY created_at DESC LIMIT 1`);
    if (lastReq && lastReq.length > 0) {
      await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${lastReq[0].id}, 'pendiente', 'Solicitud creada por el cliente.')`);
    }

    res.redirect('/client/dashboard');
  } catch (err) {
    res.status(500).send('Error creating request');
  }
});

// Action to accept/decline repair
app.post('/client/request/:id/action', requireAuth, async (req, res) => {
  try {
    const { action } = req.body;
    const reqId = req.params.id;
    let newStatus = action === 'accept' ? 'reparacion_aceptada' : 'en_proceso_de_devolucion';
    let notes = action === 'accept' ? 'El cliente aceptó el presupuesto.' : 'El cliente rechazó el presupuesto.';

    await SpiderApi.query(`UPDATE requests SET status = '${newStatus}' WHERE id = ${reqId} AND client_id = ${req.session.user.id}`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, '${newStatus}', '${notes}')`);
    
    res.redirect('/client/dashboard');
  } catch(err) {
    res.status(500).send('Error updating request');
  }
});

// Tech Routes
app.get('/tech/dashboard', requireTech, async (req, res) => {
  try {
    const requests = await SpiderApi.query(`
      SELECT r.*, u.username as client_name 
      FROM requests r 
      JOIN users u ON r.client_id = u.id 
      ORDER BY r.created_at DESC
    `);
    res.render('tech_dashboard', { requests });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading dashboard');
  }
});

app.post('/tech/request/:id/status', requireTech, async (req, res) => {
  try {
    const reqId = req.params.id;
    const { status, diagnosis, price, notes } = req.body;
    
    let updates = `status = '${status}'`;
    if (diagnosis) updates += `, diagnosis = '${diagnosis}'`;
    if (price) updates += `, price = ${price}`;

    await SpiderApi.query(`UPDATE requests SET ${updates} WHERE id = ${reqId}`);
    await SpiderApi.query(`INSERT INTO history (request_id, status, notes) VALUES (${reqId}, '${status}', '${notes || 'Estado actualizado por el técnico'}')`);
    
    res.redirect('/tech/dashboard');
  } catch (err) {
    res.status(500).send('Error updating request');
  }
});

// Admin Routes
app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const users = await SpiderApi.query(`SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC`);
    res.render('admin_dashboard', { users });
  } catch (err) {
    res.status(500).send('Error loading admin dashboard');
  }
});

app.post('/admin/user/:id/role', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;
    await SpiderApi.query(`UPDATE users SET role = '${role}' WHERE id = ${userId}`);
    res.redirect('/admin/dashboard');
  } catch (err) {
    res.status(500).send('Error updating role');
  }
});

// SpiderIA Chatbot Route
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const reply = await SpiderApi.chat(messages);
    res.json(reply);
  } catch (err) {
    console.error('Chat Error:', err);
    res.status(500).json({ error: 'Failed to communicate with IA' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
