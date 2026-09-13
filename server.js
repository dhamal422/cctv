import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Path to data store
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Helper to read DB
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading DB:', err);
    return { admins: [], site_settings: {}, service_areas: [], services: [], leads_bookings: [], testimonials: [] };
  }
}

// Helper to write DB
function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing DB:', err);
    return false;
  }
}

// Auth Middleware
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Admin token required.' });
  }

  const db = readDB();
  const admin = (db.admins || []).find(a => a.token === token);
  if (!admin) {
    return res.status(403).json({ error: 'Forbidden. Invalid session.' });
  }

  req.admin = admin;
  next();
}

// ==================== API ROUTES ==================== //

// 1. PUBLIC SITE SETTINGS & AREAS
app.get('/api/settings', (req, res) => {
  const db = readDB();
  res.json({
    settings: db.site_settings || {},
    areas: db.service_areas || []
  });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const db = readDB();
  const updates = req.body;
  db.site_settings = { ...db.site_settings, ...updates };
  writeDB(db);
  res.json({ success: true, settings: db.site_settings });
});

// 2. PUBLIC SERVICES CATALOG
app.get('/api/services', (req, res) => {
  const db = readDB();
  res.json(db.services || []);
});

// 3. CMS: SERVICES CRUD (Admin)
app.post('/api/services', requireAdmin, (req, res) => {
  const db = readDB();
  const { category, title, description, price, unit_label, image, features, meta_title, meta_desc } = req.body;

  if (!category || !title || !price) {
    return res.status(400).json({ error: 'Category, title, and price are required.' });
  }

  const newService = {
    id: Date.now(),
    category: category.toUpperCase(),
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    description: description || '',
    price: parseFloat(price) || 0,
    unit_label: unit_label || 'unit',
    image: image || 'https://images.unsplash.com/photo-1557597774-9d273605dfa9?q=80&w=600',
    features: Array.isArray(features) ? features : (features ? features.split('\n').filter(Boolean) : []),
    meta_title: meta_title || `${title} Service Delhi NCR`,
    meta_desc: meta_desc || description || '',
    display_order: (db.services.length || 0) + 1
  };

  db.services.push(newService);
  writeDB(db);
  res.status(201).json({ success: true, service: newService });
});

app.put('/api/services/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id, 10);
  const idx = db.services.findIndex(s => s.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Service not found.' });
  }

  const current = db.services[idx];
  const updated = {
    ...current,
    ...req.body,
    id: current.id // preserve id
  };

  if (req.body.price) updated.price = parseFloat(req.body.price);
  if (typeof req.body.features === 'string') {
    updated.features = req.body.features.split('\n').map(s => s.trim()).filter(Boolean);
  }

  db.services[idx] = updated;
  writeDB(db);
  res.json({ success: true, service: updated });
});

app.delete('/api/services/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id, 10);
  db.services = db.services.filter(s => s.id !== id);
  writeDB(db);
  res.json({ success: true, message: 'Service removed.' });
});

// 4. TESTIMONIALS & BEFORE/AFTER
app.get('/api/testimonials', (req, res) => {
  const db = readDB();
  res.json(db.testimonials || []);
});

app.post('/api/testimonials', requireAdmin, (req, res) => {
  const db = readDB();
  const { client_name, locality, service_category, review, rating, is_featured } = req.body;
  
  if (!client_name || !review) {
    return res.status(400).json({ error: 'Client name and review are required.' });
  }

  const newTestimonial = {
    id: Date.now(),
    client_name,
    locality: locality || 'Delhi NCR',
    service_category: service_category || 'CCTV',
    review,
    rating: parseInt(rating, 10) || 5,
    status: 'approved',
    is_featured: is_featured === true || is_featured === 'true'
  };

  db.testimonials.unshift(newTestimonial);
  writeDB(db);
  res.status(201).json({ success: true, testimonial: newTestimonial });
});

// 5. LIVE LEAD CAPTURE (AJAX from frontend)
app.post('/api/leads', (req, res) => {
  const db = readDB();
  const { customer_name, phone, email, service_type, sub_service, address, area, estimated_amount, notes, utm_source } = req.body;

  if (!customer_name || !phone) {
    return res.status(400).json({ error: 'Customer name and phone number are required.' });
  }

  const cleanPhone = String(phone).replace(/[^0-9]/g, '');
  if (cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit phone number.' });
  }

  const refNumber = 'SC-' + Math.floor(1000 + Math.random() * 9000);
  const newLead = {
    id: 'lead_' + Date.now(),
    lead_ref: refNumber,
    customer_name: customer_name.trim(),
    phone: cleanPhone,
    email: (email || '').trim(),
    service_type: service_type || 'CCTV',
    sub_service: sub_service || 'General Inquiry',
    address: (address || 'Pending Doorstep Confirmation').trim(),
    area: area || (db.site_settings.target_city || 'Delhi NCR'),
    status: 'new_lead',
    estimated_amount: parseFloat(estimated_amount) || 0,
    assigned_technician: 'Unassigned',
    notes: (notes || '').trim(),
    utm_source: utm_source || 'Website Direct',
    created_at: new Date().toISOString()
  };

  db.leads_bookings.unshift(newLead);
  writeDB(db);

  res.status(201).json({
    success: true,
    message: 'Booking received! Our supervisor will call you within 5 minutes.',
    lead: newLead
  });
});

// 6. CRM: GET LEADS (Admin with search & filters)
app.get('/api/leads', requireAdmin, (req, res) => {
  const db = readDB();
  let list = db.leads_bookings || [];

  const { status, search, service_type } = req.query;

  if (status && status !== 'all') {
    list = list.filter(l => l.status === status);
  }

  if (service_type && service_type !== 'all') {
    list = list.filter(l => l.service_type === service_type);
  }

  if (search) {
    const q = search.toLowerCase();
    list = list.filter(l => 
      l.customer_name.toLowerCase().includes(q) ||
      l.phone.includes(q) ||
      l.lead_ref.toLowerCase().includes(q) ||
      (l.address && l.address.toLowerCase().includes(q))
    );
  }

  res.json(list);
});

// 7. CRM: UPDATE LEAD STATUS / DISPATCH TECHNICIAN / EDIT DETAILS
app.patch('/api/leads/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const id = req.params.id;
  const idx = db.leads_bookings.findIndex(l => l.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const current = db.leads_bookings[idx];
  const { 
    status, 
    assigned_technician, 
    notes, 
    estimated_amount,
    customer_name,
    phone,
    area,
    address,
    sub_service,
    service_type
  } = req.body;

  if (status) current.status = status;
  if (customer_name) current.customer_name = customer_name.trim();
  if (phone) current.phone = String(phone).replace(/[^0-9]/g, '');
  if (area !== undefined) current.area = area.trim();
  if (address !== undefined) current.address = address.trim();
  if (sub_service !== undefined) current.sub_service = sub_service.trim();
  if (service_type !== undefined) current.service_type = service_type;
  if (assigned_technician !== undefined) current.assigned_technician = assigned_technician;
  if (notes !== undefined) current.notes = notes;
  if (estimated_amount !== undefined) current.estimated_amount = parseFloat(estimated_amount) || 0;
  current.updated_at = new Date().toISOString();

  db.leads_bookings[idx] = current;
  writeDB(db);
  res.json({ success: true, lead: current });
});

app.delete('/api/leads/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const id = req.params.id;
  db.leads_bookings = db.leads_bookings.filter(l => l.id !== id);
  writeDB(db);
  res.json({ success: true, message: 'Lead deleted.' });
});

// 8. CRM: EXPORT LEADS TO CSV
app.get('/api/leads/export.csv', requireAdmin, (req, res) => {
  const db = readDB();
  const leads = db.leads_bookings || [];

  const headers = ['Ref', 'Date', 'Customer Name', 'Phone', 'Email', 'Service', 'Sub Service', 'Area', 'Address', 'Status', 'Technician', 'Est Amount (INR)', 'Notes'];
  
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = leads.map(l => [
    escapeCsv(l.lead_ref),
    escapeCsv(new Date(l.created_at).toLocaleString()),
    escapeCsv(l.customer_name),
    escapeCsv(l.phone),
    escapeCsv(l.email),
    escapeCsv(l.service_type),
    escapeCsv(l.sub_service),
    escapeCsv(l.area),
    escapeCsv(l.address),
    escapeCsv(l.status),
    escapeCsv(l.assigned_technician),
    escapeCsv(l.estimated_amount),
    escapeCsv(l.notes)
  ].join(','));

  const csvContent = [headers.join(','), ...rows].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="securecool-leads-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csvContent);
});

// 9. AUTH: ADMIN LOGIN & SESSION
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();

  const admin = (db.admins || []).find(a => 
    (a.username.toLowerCase() === (username || '').toLowerCase() || a.email.toLowerCase() === (username || '').toLowerCase()) &&
    a.password === password
  );

  if (!admin) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Issue / verify session token
  const token = admin.token || ('sc_sec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9));
  admin.token = token;
  admin.last_login_at = new Date().toISOString();
  writeDB(db);

  res.json({
    success: true,
    token,
    user: {
      id: admin.id,
      username: admin.username,
      name: admin.name,
      role: admin.role
    }
  });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.admin.id,
      username: req.admin.username,
      name: req.admin.name,
      role: req.admin.role
    }
  });
});

app.post('/api/auth/logout', requireAdmin, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Serve Admin Panel directly
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve static assets
app.use(express.static(__dirname));

// Fallback for localized routes (e.g., /cctv-services-in-noida)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SecureCool server running at http://0.0.0.0:${PORT}`);
});
