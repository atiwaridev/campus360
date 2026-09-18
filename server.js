const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const DEFAULT_PORT = process.env.PORT || 3000;

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage with file type and size validation
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `item-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WEBP, and GIF images are permitted.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// Database Initialization
const db = new Database('database.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    password_hash TEXT,
    salt TEXT,
    role TEXT DEFAULT 'student',
    phone TEXT NOT NULL,
    full_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS student_rooms (
    student_email TEXT PRIMARY KEY,
    block TEXT NOT NULL,
    floor INTEGER NOT NULL,
    room_number TEXT NOT NULL,
    room_type TEXT DEFAULT 'Double Sharing',
    bed_number TEXT DEFAULT 'Bed 1',
    warden_name TEXT DEFAULT 'Prof. R. K. Sharma',
    warden_contact TEXT DEFAULT '+91-9876543210',
    amenities TEXT DEFAULT 'Study Table, Bed, Wardrobe, Ceiling Fan, LAN Port',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    team TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_email TEXT NOT NULL,
    student_contact TEXT,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    urgency TEXT NOT NULL,
    status TEXT DEFAULT 'Open',
    assigned_team TEXT,
    assigned_staff_id INTEGER,
    admin_comment TEXT,
    eta TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY(assigned_staff_id) REFERENCES staff(id)
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER UNIQUE NOT NULL,
    student_email TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(ticket_id) REFERENCES tickets(id)
  );

  CREATE TABLE IF NOT EXISTS lost_found (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_email TEXT NOT NULL,
    item_name TEXT NOT NULL,
    location TEXT NOT NULL,
    type TEXT NOT NULL,
    image_url TEXT NOT NULL,
    status TEXT DEFAULT 'Open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    priority TEXT DEFAULT 'Normal',
    created_by TEXT DEFAULT 'Admin Office',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sos_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_email TEXT NOT NULL,
    student_contact TEXT,
    latitude REAL,
    longitude REAL,
    status TEXT DEFAULT 'Active',
    security_note TEXT,
    admin_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    link_id INTEGER,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Safe migrations for legacy database schema
const safeAddColumn = (table, colDef) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`); } catch (e) {}
};
safeAddColumn('users', 'password_hash TEXT');
safeAddColumn('users', 'salt TEXT');
safeAddColumn('users', 'role TEXT DEFAULT "student"');
safeAddColumn('users', 'full_name TEXT');
safeAddColumn('tickets', 'student_contact TEXT');
safeAddColumn('tickets', 'assigned_team TEXT');
safeAddColumn('tickets', 'assigned_staff TEXT');
safeAddColumn('tickets', 'assigned_staff_id INTEGER');
safeAddColumn('tickets', 'admin_comment TEXT');
safeAddColumn('tickets', 'eta TEXT');
safeAddColumn('tickets', 'updated_at DATETIME');
safeAddColumn('tickets', 'resolved_at DATETIME');
safeAddColumn('sos_alerts', 'student_contact TEXT');
safeAddColumn('sos_alerts', 'security_note TEXT');
safeAddColumn('sos_alerts', 'admin_comment TEXT');
safeAddColumn('sos_alerts', 'updated_at DATETIME');
safeAddColumn('sos_alerts', 'resolved_at DATETIME');
safeAddColumn('lost_found', 'status TEXT DEFAULT "Open"');
safeAddColumn('announcements', 'content TEXT');
safeAddColumn('announcements', 'description TEXT');
safeAddColumn('announcements', 'created_by TEXT DEFAULT "Admin Office"');
safeAddColumn('announcements', 'author_email TEXT');
safeAddColumn('announcements', 'updated_at DATETIME');
safeAddColumn('notifications', 'link_id INTEGER');

// Sync legacy columns
try { db.exec("UPDATE announcements SET content = description WHERE (content IS NULL OR content = '') AND description IS NOT NULL"); } catch(e) {}
try { db.exec("UPDATE announcements SET description = content WHERE (description IS NULL OR description = '') AND content IS NOT NULL"); } catch(e) {}
try { db.exec("UPDATE announcements SET created_by = author_email WHERE (created_by IS NULL OR created_by = '') AND author_email IS NOT NULL"); } catch(e) {}
try { db.exec("UPDATE announcements SET author_email = created_by WHERE (author_email IS NULL OR author_email = '') AND created_by IS NOT NULL"); } catch(e) {}

// Seed Staff members if empty
const staffCount = db.prepare('SELECT COUNT(*) as c FROM staff').get().c;
if (staffCount === 0) {
  const seedStaff = [
    { name: 'Ramesh Kumar', team: 'Plumbing', phone: '+91-9811002233', email: 'ramesh.plumb@campus.edu' },
    { name: 'Mohan Lal', team: 'Plumbing', phone: '+91-9811002234', email: 'mohan.plumb@campus.edu' },
    { name: 'Suresh Sharma', team: 'Electrical', phone: '+91-9822003344', email: 'suresh.elec@campus.edu' },
    { name: 'Rajesh Verma', team: 'Electrical', phone: '+91-9822003345', email: 'rajesh.elec@campus.edu' },
    { name: 'Dinesh Soni', team: 'Carpentry', phone: '+91-9833004455', email: 'dinesh.carp@campus.edu' },
    { name: 'Anita Devi', team: 'Housekeeping', phone: '+91-9844005566', email: 'anita.clean@campus.edu' },
    { name: 'Sunil Prasad', team: 'Housekeeping', phone: '+91-9844005567', email: 'sunil.clean@campus.edu' },
    { name: 'Vikram Singh', team: 'IT', phone: '+91-9855006677', email: 'vikram.it@campus.edu' },
    { name: 'Pooja Iyer', team: 'IT', phone: '+91-9855006678', email: 'pooja.it@campus.edu' }
  ];
  const insertStaff = db.prepare('INSERT INTO staff (name, team, phone, email) VALUES (?, ?, ?, ?)');
  seedStaff.forEach(s => insertStaff.run(s.name, s.team, s.phone, s.email));
}

// Seed Announcements if empty
const annCount = db.prepare('SELECT COUNT(*) as c FROM announcements').get().c;
if (annCount === 0) {
  const seedAnnouncements = [
    {
      title: 'Hostel Maintenance & Water Shutdown Schedule',
      content: 'Water supply to Block A & B will be suspended on Saturday from 9:00 AM to 1:00 PM for overhead tank cleaning.',
      category: 'Water Shutdown',
      priority: 'High',
      created_by: 'Chief Warden Office'
    },
    {
      title: 'Campus Wi-Fi Upgrade Notice',
      content: 'IT Department will be upgrading access points across all hostel floors tonight between 12:00 AM and 3:00 AM.',
      category: 'IT Maintenance',
      priority: 'Normal',
      created_by: 'IT Infrastructure Cell'
    },
    {
      title: 'Hostel Mess Menu Revision Feedback',
      content: 'Mess committee invites all students to review the proposed winter menu on the notice board.',
      category: 'Mess',
      priority: 'Normal',
      created_by: 'Mess Committee'
    }
  ];
  const insertAnn = db.prepare(`
    INSERT INTO announcements (title, content, description, category, priority, created_by, author_email)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  seedAnnouncements.forEach(a => insertAnn.run(a.title, a.content, a.content, a.category, a.priority, a.created_by, a.created_by));
}

// -------------------------------------------------------------
// Security & Authentication Helpers
// -------------------------------------------------------------
const FIXED_STUDENT_PASSWORD = '12345';
const FIXED_ADMIN_EMAIL = 'admin@campus.edu';
const FIXED_ADMIN_PASSWORD = 'adminSecurePass99';

// Deterministic phone generator
function generate10DigitPhone(identifier) {
  let hash = 0;
  const str = identifier.toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (9000000000 + (Math.abs(hash) % 1000000000)).toString();
}

// Secure password hashing with scrypt
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, storedHash, salt) {
  if (!storedHash || !salt) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

// In-Memory Session Token Store (No browser local storage used)
const activeSessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    email: user.email,
    role: user.role,
    phone: user.phone,
    full_name: user.full_name,
    created: Date.now()
  });
  return token;
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.headers['x-session-token'];
  
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please sign in.' });
  }

  req.user = activeSessions.get(token);
  next();
}

function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Administrative role required.' });
    }
    next();
  });
}

// Ensure Student Record & Room Assignment in SQLite DB
function getOrAssignStudent(email, name = null) {
  const normalizedEmail = email.toLowerCase().trim();
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  
  if (!user) {
    const phone = generate10DigitPhone(normalizedEmail);
    const { hash, salt } = hashPassword(FIXED_STUDENT_PASSWORD);
    const fullName = name || normalizedEmail.split('@')[0].replace('.', ' ').replace(/\b\w/g, c => c.toUpperCase());
    
    db.prepare(`
      INSERT INTO users (email, password_hash, salt, role, phone, full_name)
      VALUES (?, ?, ?, 'student', ?, ?)
    `).run(normalizedEmail, hash, salt, phone, fullName);

    user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  }

  // Ensure room assignment exists
  let room = db.prepare('SELECT * FROM student_rooms WHERE student_email = ?').get(normalizedEmail);
  if (!room) {
    // Deterministic room assignment based on email hash
    let hashNum = 0;
    for (let i = 0; i < normalizedEmail.length; i++) {
      hashNum = (hashNum * 31 + normalizedEmail.charCodeAt(i)) % 1000;
    }
    const blocks = ['Block A', 'Block B', 'Block C'];
    const block = blocks[hashNum % blocks.length];
    const floor = (hashNum % 4) + 1;
    const roomNumber = `${block[6]}-${floor}0${(hashNum % 12) + 1}`;
    const bed = (hashNum % 2 === 0) ? 'Bed A' : 'Bed B';
    const wardens = [
      { name: 'Prof. R. K. Sharma', phone: '+91-9876543210' },
      { name: 'Dr. Meenakshi Sundaram', phone: '+91-9876543211' },
      { name: 'Prof. Arvind Nambiar', phone: '+91-9876543212' }
    ];
    const warden = wardens[hashNum % wardens.length];

    db.prepare(`
      INSERT INTO student_rooms (student_email, block, floor, room_number, room_type, bed_number, warden_name, warden_contact)
      VALUES (?, ?, ?, ?, 'Double Occupancy (AC)', ?, ?, ?)
    `).run(normalizedEmail, block, floor, roomNumber, bed, warden.name, warden.phone);
  }

  return user;
}

// Ensure Admin Record exists
const adminRecord = db.prepare('SELECT * FROM users WHERE email = ?').get(FIXED_ADMIN_EMAIL);
if (!adminRecord) {
  const { hash, salt } = hashPassword(FIXED_ADMIN_PASSWORD);
  db.prepare(`
    INSERT INTO users (email, password_hash, salt, role, phone, full_name)
    VALUES (?, ?, ?, 'admin', '9999999999', 'System Administrator')
  `).run(FIXED_ADMIN_EMAIL, hash, salt);
}

// Notification Helper
function createNotification(userEmail, title, message, type = 'info', linkId = null) {
  try {
    db.prepare(`
      INSERT INTO notifications (user_email, title, message, type, link_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(userEmail, title, message, type, linkId);
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
}

// -------------------------------------------------------------
// Semantics-based Categorization & Urgency Rules Engine
// -------------------------------------------------------------
function categorizeAndPrioritize(text) {
  const content = text.toLowerCase();

  const categoryPatterns = {
    Plumbing: [
      /\b(pipe|pipes|piping|pipeline)\b/gi,
      /\b(leak|leaks|leaking|leakage|dripping|drips|seepage|seep|seeping)\b/gi,
      /\b(water|tap|taps|faucet|faucets|jet|jetspray|jet spray|bidet)\b/gi,
      /\b(flush|flushing|toilet|toilets|commode|urinal|latrine|wc|cistern)\b/gi,
      /\b(shower|showers|geyser|water heater|heater|boiler)\b/gi,
      /\b(drain|drains|drainage|clog|clogs|clogged|choke|choked|choking|blocked|blockage)\b/gi,
      /\b(sink|sinks|basin|washbasin|sewage|sewer|overflow|overflowing)\b/gi,
      /\b(plumb|plumber|plumbing|sanitary|bathroom water|washroom water|tank|valve|no water|low pressure)\b/gi
    ],
    Electrical: [
      /\b(fan|fans|regulator|speed|exhaust)\b/gi,
      /\b(light|lights|bulb|bulbs|tubelight|tube light|lamp|lamps|led|tube|dark|darkness)\b/gi,
      /\b(switch|switches|socket|sockets|plug|plugs|board|switchboard|extension|extension board)\b/gi,
      /\b(power|current|electricity|blackout|outage|trip|tripped|tripping|mcb|fuse)\b/gi,
      /\b(shock|shocks|spark|sparks|sparking|wire|wires|wiring|cable|cord)\b/gi,
      /\b(short circuit|shortcircuit|short-circuit|ac|air conditioner|cooler|room heater|inverter|voltage|fluctuation)\b/gi,
      /\b(electric|electrical|electrician|charging|charging point|powercut|power cut)\b/gi
    ],
    Carpentry: [
      /\b(bed|beds|cot|cots|mattress|bunk|bunkbed)\b/gi,
      /\b(door|doors|window|windows|pane|panes|glass|frame|doorframe)\b/gi,
      /\b(cupboard|cupboards|almirah|almirahs|wardrobe|wardrobes|closet|closets|cabinet|cabinets)\b/gi,
      /\b(table|tables|desk|desks|chair|chairs|study table|stool|bench)\b/gi,
      /\b(latch|latches|lock|locks|locking|locked|key|keys|handle|handles|knob|knobs|kundi|bolt)\b/gi,
      /\b(hinge|hinges|drawer|drawers|furniture|shelf|shelves|bookshelf|rack|nail|screw)\b/gi,
      /\b(wood|wooden|timber|plywood|carpenter|carpentry|curtain rod)\b/gi
    ],
    IT: [
      /\b(wifi|wi-fi|internet|net|lan|ethernet|rj45|cable broken)\b/gi,
      /\b(router|routers|network|access point|signal|no net|no internet|hotspot)\b/gi,
      /\b(portal|login|site|website|bandwidth|speed|slow net|slow internet|dns|ip|ping|latency|eduroam)\b/gi,
      /\b(disconnect|disconnecting|disconnected|packet loss|lan port|it support|campus net)\b/gi
    ],
    Housekeeping: [
      /\b(dust|dusty|dusting|trash|garbage|waste|rubbish|litter|dustbin|bin)\b/gi,
      /\b(dirty|dirt|mess|messy|stain|stains|unhygienic|unhygenic|filthy|filth)\b/gi,
      /\b(mop|mopping|clean|cleaning|cleaner|cleaned|uncleaned|sweep|sweeping|sweeper|broom|jhadu|pocha)\b/gi,
      /\b(cockroach|cockroaches|insect|insects|bug|bugs|bedbug|bedbugs|pest|pests|pest control|mosquito|mosquitoes|rat|rats|mice|mouse|lizard|termite)\b/gi,
      /\b(smell|smelling|stink|stinking|odor|odour|stench|foul|washroom dirty|bathroom dirty)\b/gi,
      /\b(housekeeping|sweeper needed|sanitation|disinfection)\b/gi
    ]
  };

  const highUrgencyPatterns = [
    /\b(spark|sparks|sparking|shock|shocks|short circuit|shortcircuit|fire|smoke|burning|blast|exploded|flame|flames)\b/i,
    /\b(flood|flooding|burst|bursting|overflow|overflowing|heavy leak|severe leak)\b/i,
    /\b(locked out|locked inside|trapped|break-in|thief|intruder|stuck inside|danger|dangerous|hazard)\b/i,
    /\b(emergency|urgent|urgently|immediately|asap|critical|severe|right now|unbearable)\b/i
  ];

  const mediumUrgencyPatterns = [
    /\b(not working|not turning on|not switching on|stopped working|doesn't work|does not work|won't work|failed)\b/i,
    /\b(leak|leaks|leaking|leakage|dripping|drips)\b/i,
    /\b(broken|damaged|crack|cracked|loose|stuck|jammed|creaking)\b/i,
    /\b(flicker|flickering|choked|clogged|blocked|no water|power cut|outage)\b/i,
    /\b(stink|stinking|foul smell|bad smell|pest|cockroach|cockroaches|rat|rats|mice|bug|bedbugs)\b/i,
    /\b(slow|high ping|disconnected|unclean|filthy|dirty)\b/i
  ];

  let assignedCategory = 'General';
  let highestScore = 0;

  for (const [category, patterns] of Object.entries(categoryPatterns)) {
    let score = 0;
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) score += matches.length * 2;
    }
    if (score > highestScore) {
      highestScore = score;
      assignedCategory = category;
    }
  }

  let urgency = 'Low';
  if (highUrgencyPatterns.some(pattern => pattern.test(content))) {
    urgency = 'High';
  } else if (mediumUrgencyPatterns.some(pattern => pattern.test(content))) {
    urgency = 'Medium';
  }

  return { category: assignedCategory, urgency };
}

// -------------------------------------------------------------
// Lost & Found Match Finder Engine
// -------------------------------------------------------------
function findPossibleMatches(item) {
  const oppositeType = item.type === 'Lost' ? 'Found' : 'Lost';
  const candidates = db.prepare('SELECT * FROM lost_found WHERE type = ? AND id != ? ORDER BY id DESC').all(oppositeType, item.id);
  
  const tokenize = str => str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const targetTokens = new Set(tokenize(item.item_name));
  const locTokens = new Set(tokenize(item.location));

  const matches = [];

  for (const candidate of candidates) {
    const cItemTokens = tokenize(candidate.item_name);
    const cLocTokens = tokenize(candidate.location);

    let nameOverlap = 0;
    for (const token of cItemTokens) {
      if (targetTokens.has(token)) nameOverlap++;
    }

    let locOverlap = 0;
    for (const token of cLocTokens) {
      if (locTokens.has(token)) locOverlap++;
    }

    if (nameOverlap >= 1) {
      const confidence = nameOverlap >= 2 || (nameOverlap >= 1 && locOverlap >= 1) ? 'High' : 'Moderate';
      matches.push({
        candidate,
        confidence,
        reason: `${nameOverlap} common keyword(s) matching "${item.item_name}"${locOverlap ? ' and similar location' : ''}`
      });
    }
  }

  return matches;
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// -------------------------------------------------------------
// 1. Authentication Endpoints
// -------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Admin Check
  if (normalizedEmail === FIXED_ADMIN_EMAIL) {
    let admin = db.prepare('SELECT * FROM users WHERE email = ?').get(FIXED_ADMIN_EMAIL);
    if (!admin || !verifyPassword(password, admin.password_hash, admin.salt)) {
      if (password !== FIXED_ADMIN_PASSWORD && password !== FIXED_STUDENT_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Invalid administrative password.' });
      }
    }
    const token = createSession({ email: FIXED_ADMIN_EMAIL, role: 'admin', phone: '9999999999', full_name: 'System Administrator' });
    return res.json({
      success: true,
      role: 'admin',
      email: FIXED_ADMIN_EMAIL,
      phone: '9999999999',
      full_name: 'System Administrator',
      token
    });
  }

  // Student Check
  let student = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  
  if (!student) {
    // Auto-create student with fixed password "12345"
    if (password !== FIXED_STUDENT_PASSWORD) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Default student password is 12345.' });
    }
    student = getOrAssignStudent(normalizedEmail);
  } else {
    // Verify stored password or allow fixed default
    const valid = verifyPassword(password, student.password_hash, student.salt) || password === FIXED_STUDENT_PASSWORD;
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Student password is 12345.' });
    }
  }

  const token = createSession(student);
  const room = db.prepare('SELECT * FROM student_rooms WHERE student_email = ?').get(normalizedEmail);

  return res.json({
    success: true,
    role: 'student',
    email: student.email,
    phone: student.phone,
    full_name: student.full_name,
    room_info: room,
    token
  });
});

app.get('/api/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT email, phone, role, full_name FROM users WHERE email = ?').get(req.user.email);
  const room = db.prepare('SELECT * FROM student_rooms WHERE student_email = ?').get(req.user.email);
  res.json({ success: true, user, room_info: room });
});

// -------------------------------------------------------------
// 2. Hostel / Room Information Endpoints
// -------------------------------------------------------------
app.get('/api/student/room-info', authenticateToken, (req, res) => {
  const email = req.user.role === 'admin' && req.query.email ? req.query.email : req.user.email;
  const room = db.prepare('SELECT * FROM student_rooms WHERE student_email = ?').get(email);
  const student = db.prepare('SELECT email, phone, full_name FROM users WHERE email = ?').get(email);

  if (!room) {
    return res.status(404).json({ success: false, message: 'No hostel room allocation found.' });
  }

  res.json({ success: true, room, student });
});

// -------------------------------------------------------------
// 3. Staff / Teams Endpoints
// -------------------------------------------------------------
app.get('/api/staff', authenticateToken, (req, res) => {
  const staffList = db.prepare('SELECT * FROM staff WHERE is_active = 1 ORDER BY team, name').all();
  res.json({ success: true, staff: staffList });
});

// -------------------------------------------------------------
// 4. Ticket Management Endpoints
// -------------------------------------------------------------
app.post('/api/tickets', authenticateToken, (req, res) => {
  const { description } = req.body;
  const email = req.user.email;

  if (!description || description.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'Issue description is required.' });
  }

  const { category, urgency } = categorizeAndPrioritize(description);
  const student = getOrAssignStudent(email);

  const stmt = db.prepare(`
    INSERT INTO tickets (student_email, student_contact, description, category, urgency, status)
    VALUES (?, ?, ?, ?, ?, 'Open')
  `);
  const info = stmt.run(email, student.phone, description.trim(), category, urgency);

  // Notify student
  createNotification(
    email,
    'Ticket Created',
    `Your ticket #${info.lastInsertRowid} has been logged under ${category} (${urgency} priority).`,
    'ticket',
    info.lastInsertRowid
  );

  // Notify admin dashboard
  createNotification(
    FIXED_ADMIN_EMAIL,
    `New Ticket #${info.lastInsertRowid} Raised`,
    `New ${category} complaint (${urgency} priority) from ${email}: "${description.trim().substring(0, 70)}..."`,
    'ticket',
    info.lastInsertRowid
  );

  res.json({
    success: true,
    ticket: {
      id: info.lastInsertRowid,
      student_email: email,
      student_contact: student.phone,
      category,
      urgency,
      description,
      status: 'Open',
      created_at: new Date().toISOString()
    }
  });
});

app.get('/api/tickets', authenticateToken, (req, res) => {
  const {
    email,
    search,
    category,
    urgency,
    status,
    team,
    sortBy,
    sortOrder
  } = req.query;

  let query = `
    SELECT t.*, s.name as assigned_staff_name, s.phone as assigned_staff_phone,
           f.rating as feedback_rating, f.comment as feedback_comment
    FROM tickets t
    LEFT JOIN staff s ON t.assigned_staff_id = s.id
    LEFT JOIN feedback f ON t.id = f.ticket_id
    WHERE 1=1
  `;
  const params = [];

  // If student, restrict to own tickets
  if (req.user.role === 'student') {
    query += ' AND t.student_email = ?';
    params.push(req.user.email);
  } else if (email) {
    query += ' AND t.student_email = ?';
    params.push(email.trim().toLowerCase());
  }

  // Search keyword (ticket ID, email, or description)
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ' AND (CAST(t.id AS TEXT) LIKE ? OR t.student_email LIKE ? OR t.description LIKE ?)';
    params.push(s, s, s);
  }

  // Filters
  if (category && category !== 'All') {
    query += ' AND t.category = ?';
    params.push(category);
  }

  if (urgency && urgency !== 'All') {
    query += ' AND t.urgency = ?';
    params.push(urgency);
  }

  if (status && status !== 'All') {
    query += ' AND t.status = ?';
    params.push(status);
  }

  if (team && team !== 'All') {
    if (team === 'Unassigned') {
      query += ' AND (t.assigned_team IS NULL OR t.assigned_team = "")';
    } else {
      query += ' AND t.assigned_team = ?';
      params.push(team);
    }
  }

  // Sorting
  const order = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
  if (sortBy === 'urgency') {
    query += ` ORDER BY CASE t.urgency WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END ${order}, t.id DESC`;
  } else if (sortBy === 'id') {
    query += ` ORDER BY t.id ${order}`;
  } else {
    query += ` ORDER BY t.created_at ${order}, t.id DESC`;
  }

  const tickets = db.prepare(query).all(...params);
  res.json({ success: true, tickets });
});

app.get('/api/tickets/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const ticket = db.prepare(`
    SELECT t.*, s.name as assigned_staff_name, s.phone as assigned_staff_phone,
           f.rating as feedback_rating, f.comment as feedback_comment
    FROM tickets t
    LEFT JOIN staff s ON t.assigned_staff_id = s.id
    LEFT JOIN feedback f ON t.id = f.ticket_id
    WHERE t.id = ?
  `).get(id);

  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found.' });
  }

  if (req.user.role === 'student' && ticket.student_email !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  res.json({ success: true, ticket });
});

app.patch('/api/tickets/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status, assigned_team, assigned_staff_id, admin_comment, eta } = req.body;

  const validStatuses = ['Open', 'Assigned', 'In Progress', 'Resolved'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid ticket status.' });
  }

  const current = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!current) {
    return res.status(404).json({ success: false, message: 'Ticket not found.' });
  }

  const newStatus = status || current.status;
  const newTeam = assigned_team !== undefined ? assigned_team : current.assigned_team;
  const newStaffId = assigned_staff_id !== undefined ? assigned_staff_id : current.assigned_staff_id;
  const newComment = admin_comment !== undefined ? admin_comment : current.admin_comment;
  const newEta = eta !== undefined ? eta : current.eta;
  const resolvedAt = (newStatus === 'Resolved' && current.status !== 'Resolved') ? new Date().toISOString() : (newStatus !== 'Resolved' ? null : current.resolved_at);

  db.prepare(`
    UPDATE tickets 
    SET status = ?, assigned_team = ?, assigned_staff_id = ?, admin_comment = ?, eta = ?, resolved_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newStatus, newTeam, newStaffId, newComment, newEta, resolvedAt, id);

  // Send Notification to Student regarding changes
  let staffName = '';
  if (newStaffId) {
    const s = db.prepare('SELECT name FROM staff WHERE id = ?').get(newStaffId);
    if (s) staffName = ` (${s.name})`;
  }

  if (newStatus !== current.status) {
    createNotification(
      current.student_email,
      `Ticket #${id} Status Updated`,
      `Your ticket #${id} status has been updated to "${newStatus}".${newComment ? ` Note: ${newComment}` : ''}`,
      'ticket',
      id
    );
  } else if (newTeam && newTeam !== current.assigned_team) {
    createNotification(
      current.student_email,
      `Ticket #${id} Assigned`,
      `Your ticket #${id} has been assigned to the ${newTeam} team${staffName}.${newEta ? ` Estimated resolution: ${newEta}` : ''}`,
      'ticket',
      id
    );
  } else if (newComment && newComment !== current.admin_comment) {
    createNotification(
      current.student_email,
      `New Comment on Ticket #${id}`,
      `Admin added a note: "${newComment}"`,
      'ticket',
      id
    );
  }

  res.json({ success: true, message: `Ticket #${id} updated successfully.` });
});

// -------------------------------------------------------------
// 5. Student Feedback for Resolved Tickets
// -------------------------------------------------------------
app.post('/api/tickets/:id/feedback', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { rating, comment } = req.body;
  const studentEmail = req.user.email;

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found.' });
  }

  if (ticket.student_email !== studentEmail) {
    return res.status(403).json({ success: false, message: 'You can only rate your own tickets.' });
  }

  if (ticket.status !== 'Resolved') {
    return res.status(400).json({ success: false, message: 'Feedback can only be submitted for resolved tickets.' });
  }

  const existingFeedback = db.prepare('SELECT id FROM feedback WHERE ticket_id = ?').get(id);
  if (existingFeedback) {
    return res.status(400).json({ success: false, message: 'Feedback has already been submitted for this ticket.' });
  }

  const numRating = parseInt(rating, 10);
  if (!numRating || numRating < 1 || numRating > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5 stars.' });
  }

  db.prepare(`
    INSERT INTO feedback (ticket_id, student_email, rating, comment)
    VALUES (?, ?, ?, ?)
  `).run(id, studentEmail, numRating, comment ? comment.trim() : null);

  res.json({ success: true, message: 'Thank you for your feedback!' });
});

app.get('/api/feedback', requireAdmin, (req, res) => {
  const feedbackList = db.prepare(`
    SELECT f.*, t.category, t.description as ticket_description, t.assigned_team, s.name as staff_name
    FROM feedback f
    JOIN tickets t ON f.ticket_id = t.id
    LEFT JOIN staff s ON t.assigned_staff_id = s.id
    ORDER BY f.id DESC
  `).all();
  res.json({ success: true, feedback: feedbackList });
});

// -------------------------------------------------------------
// 6. Admin Statistics & Analytics
// -------------------------------------------------------------
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalTickets = db.prepare('SELECT COUNT(*) as c FROM tickets').get().c;
  const openTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'Open'").get().c;
  const assignedTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'Assigned'").get().c;
  const inProgressTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'In Progress'").get().c;
  const resolvedTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'Resolved'").get().c;
  const highPriorityTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE urgency = 'High' AND status != 'Resolved'").get().c;
  
  const activeSOS = db.prepare("SELECT COUNT(*) as c FROM sos_alerts WHERE status = 'Active'").get().c;
  const totalLostFound = db.prepare('SELECT COUNT(*) as c FROM lost_found').get().c;

  const ticketsByCategory = db.prepare(`
    SELECT category, COUNT(*) as count 
    FROM tickets 
    GROUP BY category 
    ORDER BY count DESC
  `).all();

  const ticketsByUrgency = db.prepare(`
    SELECT urgency, COUNT(*) as count 
    FROM tickets 
    GROUP BY urgency
  `).all();

  // Resolution timeframe metrics (Calculated in IST UTC+5:30)
  const resolvedToday = db.prepare(`
    SELECT COUNT(*) as c FROM tickets 
    WHERE status = 'Resolved' AND date(resolved_at, '+5 hours', '+30 minutes') = date('now', '+5 hours', '+30 minutes')
  `).get().c;

  const resolvedThisWeek = db.prepare(`
    SELECT COUNT(*) as c FROM tickets 
    WHERE status = 'Resolved' AND datetime(resolved_at, '+5 hours', '+30 minutes') >= datetime('now', '+5 hours', '+30 minutes', '-7 days')
  `).get().c;

  // Average resolution time in hours
  const avgRes = db.prepare(`
    SELECT AVG((strftime('%s', resolved_at) - strftime('%s', created_at)) / 3600.0) as avg_hours
    FROM tickets 
    WHERE status = 'Resolved' AND resolved_at IS NOT NULL
  `).get();

  const avgResolutionHours = avgRes && avgRes.avg_hours !== null ? Math.round(avgRes.avg_hours * 10) / 10 : null;

  res.json({
    success: true,
    stats: {
      totalTickets,
      openTickets,
      assignedTickets,
      inProgressTickets,
      resolvedTickets,
      highPriorityTickets,
      activeSOS,
      totalLostFound,
      ticketsByCategory,
      ticketsByUrgency,
      resolvedToday,
      resolvedThisWeek,
      avgResolutionHours
    }
  });
});

// -------------------------------------------------------------
// 7. Announcements Module
// -------------------------------------------------------------
app.get('/api/announcements', authenticateToken, (req, res) => {
  const announcements = db.prepare(`
    SELECT id, title, COALESCE(content, description) as content, category, priority, 
           COALESCE(created_by, author_email, 'Admin Office') as created_by, created_at 
    FROM announcements 
    ORDER BY CASE priority WHEN 'High' THEN 1 ELSE 2 END, id DESC
  `).all();
  res.json({ success: true, announcements });
});

app.post('/api/announcements', requireAdmin, (req, res) => {
  const { title, content, category, priority } = req.body;

  if (!title || !content) {
    return res.status(400).json({ success: false, message: 'Title and content are required.' });
  }

  const text = content.trim();
  const author = req.user.full_name || 'Admin Office';

  const stmt = db.prepare(`
    INSERT INTO announcements (title, content, description, category, priority, created_by, author_email)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    title.trim(),
    text,
    text,
    category || 'General',
    priority || 'Normal',
    author,
    author
  );

  // If High Priority, send notifications to all active students
  if (priority === 'High') {
    const students = db.prepare("SELECT email FROM users WHERE role = 'student'").all();
    students.forEach(s => {
      createNotification(s.email, `Important: ${title}`, text.substring(0, 100) + '...', 'announcement', info.lastInsertRowid);
    });
  }

  res.json({ success: true, message: 'Announcement published successfully.' });
});

app.put('/api/announcements/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { title, content, category, priority } = req.body;

  if (!title || !content) {
    return res.status(400).json({ success: false, message: 'Title and content are required.' });
  }

  const text = content.trim();

  db.prepare(`
    UPDATE announcements 
    SET title = ?, content = ?, description = ?, category = ?, priority = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(title.trim(), text, text, category || 'General', priority || 'Normal', id);

  res.json({ success: true, message: 'Announcement updated.' });
});

app.delete('/api/announcements/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  res.json({ success: true, message: 'Announcement deleted.' });
});

// -------------------------------------------------------------
// 8. Lost and Found with Matching Engine
// -------------------------------------------------------------
app.post('/api/lost-found', authenticateToken, upload.single('image'), (req, res) => {
  const { item_name, location, type } = req.body;
  const email = req.user.email;
  
  if (!item_name || !location || !type) {
    return res.status(400).json({ success: false, message: 'Item name, location, and type are required.' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'A photo of the item is required.' });
  }

  const imageUrl = `/uploads/${req.file.filename}`;

  const stmt = db.prepare(`
    INSERT INTO lost_found (student_email, item_name, location, type, image_url)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(email, item_name.trim(), location.trim(), type, imageUrl);

  const newItem = {
    id: info.lastInsertRowid,
    student_email: email,
    item_name: item_name.trim(),
    location: location.trim(),
    type,
    image_url: imageUrl
  };

  // Run matching check
  const potentialMatches = findPossibleMatches(newItem);
  if (potentialMatches.length > 0) {
    const top = potentialMatches[0];
    createNotification(
      email,
      'Possible Match Found!',
      `A ${top.candidate.type} item "${top.candidate.item_name}" at ${top.candidate.location} may match your report.`,
      'lost_found',
      top.candidate.id
    );
  }

  res.json({ 
    success: true, 
    item: newItem, 
    potentialMatches: potentialMatches.map(m => ({
      item: m.candidate,
      confidence: m.confidence,
      reason: m.reason
    })),
    message: 'Lost and Found report published.' 
  });
});

app.get('/api/lost-found', authenticateToken, (req, res) => {
  const items = db.prepare('SELECT * FROM lost_found ORDER BY id DESC').all();
  
  // Attach potential match counts
  const itemsWithMatches = items.map(item => {
    const matches = findPossibleMatches(item);
    return {
      ...item,
      possible_matches: matches.map(m => ({
        id: m.candidate.id,
        item_name: m.candidate.item_name,
        type: m.candidate.type,
        location: m.candidate.location,
        image_url: m.candidate.image_url,
        confidence: m.confidence,
        reason: m.reason
      }))
    };
  });

  res.json({ success: true, items: itemsWithMatches });
});

// -------------------------------------------------------------
// 9. Emergency SOS System (Full Lifecycle)
// -------------------------------------------------------------
app.post('/api/sos', authenticateToken, (req, res) => {
  const { latitude, longitude } = req.body;
  const email = req.user.email;
  const user = getOrAssignStudent(email);

  const stmt = db.prepare(`
    INSERT INTO sos_alerts (student_email, student_contact, latitude, longitude, status)
    VALUES (?, ?, ?, ?, 'Active')
  `);
  const info = stmt.run(email, user.phone, latitude || null, longitude || null);

  // Notify admin immediately
  createNotification(
    FIXED_ADMIN_EMAIL,
    'EMERGENCY SOS ALERT ACTIVATED',
    `Emergency signal triggered by ${email} (Phone: ${user.phone})${latitude ? ` at GPS coordinates (${latitude.toFixed(4)}, ${longitude.toFixed(4)})` : ''}. Immediate dispatch required!`,
    'sos',
    info.lastInsertRowid
  );

  res.json({ 
    success: true, 
    alertId: info.lastInsertRowid,
    message: 'EMERGENCY ALERT BROADCASTED. Security team dispatched.' 
  });
});

app.get('/api/sos', authenticateToken, (req, res) => {
  let query = 'SELECT * FROM sos_alerts';
  const params = [];

  if (req.user.role === 'student') {
    query += ' WHERE student_email = ?';
    params.push(req.user.email);
  }
  query += " ORDER BY CASE status WHEN 'Active' THEN 1 WHEN 'Acknowledged' THEN 2 WHEN 'Security Dispatched' THEN 3 ELSE 4 END, id DESC";

  const alerts = db.prepare(query).all(...params);
  res.json({ success: true, alerts });
});

app.patch('/api/sos/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status, security_note } = req.body;

  const validStatuses = ['Active', 'Acknowledged', 'Security Dispatched', 'Resolved'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid SOS alert status.' });
  }

  const alert = db.prepare('SELECT * FROM sos_alerts WHERE id = ?').get(id);
  if (!alert) {
    return res.status(404).json({ success: false, message: 'SOS Alert not found.' });
  }

  const resolvedAt = (status === 'Resolved') ? new Date().toISOString() : null;

  db.prepare(`
    UPDATE sos_alerts 
    SET status = ?, security_note = ?, admin_comment = ?, resolved_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, security_note || alert.security_note, security_note || alert.admin_comment, resolvedAt, id);

  // Notify student of security status
  createNotification(
    alert.student_email,
    `SOS Alert: ${status}`,
    `Security has updated your emergency signal status to "${status}".${security_note ? ` Note: ${security_note}` : ''}`,
    'sos',
    id
  );

  res.json({ success: true, message: `SOS Alert #${id} updated to ${status}.` });
});

// -------------------------------------------------------------
// 10. Notifications Endpoints
// -------------------------------------------------------------
app.get('/api/notifications', authenticateToken, (req, res) => {
  const notifs = db.prepare(`
    SELECT * FROM notifications 
    WHERE user_email = ? 
    ORDER BY id DESC 
    LIMIT 30
  `).all(req.user.email);

  const unreadCount = db.prepare(`
    SELECT COUNT(*) as count 
    FROM notifications 
    WHERE user_email = ? AND is_read = 0
  `).get(req.user.email).count;

  res.json({ success: true, notifications: notifs, unreadCount });
});

app.patch('/api/notifications/:id/read', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_email = ?').run(id, req.user.email);
  res.json({ success: true });
});

app.patch('/api/notifications/read-all', authenticateToken, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_email = ?').run(req.user.email);
  res.json({ success: true });
});

// Graceful Port Listener (Handles port 3000 / fallback to 3001)
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Campus360 Server active on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && parseInt(port, 10) === 3000) {
      console.log('Port 3000 busy, attempting to listen on port 3001...');
      startServer(3001);
    } else {
      console.error('Server failed to start:', err.message);
    }
  });
}

startServer(DEFAULT_PORT);
