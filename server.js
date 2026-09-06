import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import nodemailer from 'nodemailer';
import Razorpay from 'razorpay';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const db = new Database(process.env.DB_FILE || './recyclr.db');
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    points INTEGER DEFAULT 250,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER DEFAULT 0,
    used INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'verify',
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    razorpay_order_id TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT DEFAULT 'created',
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Migration — add purpose column if it doesn't exist yet
const otpColumns = db.prepare('PRAGMA table_info(otps)').all();
if (!otpColumns.some(col => col.name === 'purpose')) {
  db.exec(`ALTER TABLE otps ADD COLUMN purpose TEXT NOT NULL DEFAULT 'verify'`);
}

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Origin not allowed'));
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

const mailer = (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

const razorpay = (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

// ─── HELPERS ────────────────────────────────────────────────

function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET || 'dev-only-secret-change-me',
    { expiresIn: '7d' }
  );
}

function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    req.user = jwt.verify(h.slice(7), process.env.JWT_SECRET || 'dev-only-secret-change-me');
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Unified OTP sender — handles both verify and reset
async function sendOtp(user, purpose = 'verify') {
  const code = String(crypto.randomInt(100000, 1000000));

  // Invalidate previous unused OTPs of same purpose
  db.prepare('UPDATE otps SET used=1 WHERE user_id=? AND purpose=? AND used=0').run(user.id, purpose);

  // Store new hashed OTP
  db.prepare('INSERT INTO otps(user_id,code_hash,expires_at,created_at,purpose) VALUES(?,?,?,?,?)')
    .run(user.id, hashOtp(code), Date.now() + 10 * 60 * 1000, Date.now(), purpose);

  const subject = purpose === 'reset'
    ? 'Your Recyclr password reset OTP'
    : 'Your Recyclr verification code';

  const text = purpose === 'reset'
    ? `Your Recyclr password reset OTP is ${code}. It expires in 10 minutes.`
    : `Your Recyclr OTP is ${code}. It expires in 10 minutes.`;

  if (mailer) {
    try {
      await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: user.email, subject, text });
    } catch (err) {
      // Invalidate OTP if email failed
      db.prepare('UPDATE otps SET used=1 WHERE user_id=? AND purpose=? AND used=0').run(user.id, purpose);
      throw new Error('Unable to send OTP email. Please check SMTP settings.');
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('Email service is not configured on the server');
  }

  // In dev mode return OTP so you can test without SMTP
  return process.env.NODE_ENV === 'production' ? undefined : code;
}

// ─── ROUTES ─────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'recyclr-api', time: new Date().toISOString() }));

// SIGNUP
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body || {};
    if (!name || !email || !password || password.length < 8)
      return res.status(400).json({ error: 'Name, email and an 8+ character password are required' });

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT * FROM users WHERE email=?').get(cleanEmail);

    if (existing && existing.verified)
      return res.status(409).json({ error: 'An account with this email already exists' });

    // Re-send OTP if account exists but not verified
    if (existing && !existing.verified) {
      const passwordHash = await bcrypt.hash(String(password), 12);
      db.prepare('UPDATE users SET name=?,phone=?,password_hash=? WHERE id=?')
        .run(name.trim(), phone?.trim() || null, passwordHash, existing.id);
      const user = { id: existing.id, name: name.trim(), email: cleanEmail };
      try {
        const devOtp = await sendOtp(user, 'verify');
        return res.json({ message: 'Account exists but is not verified. A new OTP has been sent.', token: tokenFor(user), devOtp });
      } catch (err) {
        return res.status(500).json({ error: err.message || 'Unable to send verification OTP' });
      }
    }

    // New account
    const passwordHash = await bcrypt.hash(String(password), 12);
    const info = db.prepare('INSERT INTO users(name,email,phone,password_hash,created_at) VALUES(?,?,?,?,?)')
      .run(name.trim(), cleanEmail, phone?.trim() || null, passwordHash, new Date().toISOString());

    const user = { id: info.lastInsertRowid, name: name.trim(), email: cleanEmail };
    try {
      const devOtp = await sendOtp(user, 'verify');
      return res.status(201).json({ message: 'Account created. Verify your email with the OTP.', token: tokenFor(user), devOtp });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Account created but verification email could not be sent.' });
    }

  } catch (e) {
    console.error('SIGNUP ERROR:', e);
    res.status(500).json({ error: 'Unable to create account' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase());
    if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash)))
      return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, email: user.email, verified: Boolean(user.verified), points: user.points } });
  } catch (e) {
    console.error('LOGIN ERROR:', e);
    res.status(500).json({ error: 'Unable to login' });
  }
});

// SEND VERIFY OTP
app.post('/api/auth/send-otp', auth, async (req, res) => {
  try {
    const user = db.prepare('SELECT id,name,email,verified FROM users WHERE id=?').get(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.verified) return res.status(400).json({ error: 'This email is already verified' });
    const devOtp = await sendOtp(user, 'verify');
    res.json({ message: 'OTP sent', devOtp });
  } catch (e) {
    console.error('SEND OTP ERROR:', e);
    res.status(500).json({ error: e.message || 'Unable to send OTP' });
  }
});

// VERIFY EMAIL OTP
app.post('/api/auth/verify-otp', auth, (req, res) => {
  try {
    const { code } = req.body || {};
    const row = db.prepare(`SELECT * FROM otps WHERE user_id=? AND purpose='verify' AND used=0 ORDER BY id DESC LIMIT 1`).get(req.user.sub);
    if (!row || row.expires_at < Date.now() || row.attempts >= 5)
      return res.status(400).json({ error: 'OTP expired or unavailable' });
    if (hashOtp(String(code || '')) !== row.code_hash) {
      db.prepare('UPDATE otps SET attempts=attempts+1 WHERE id=?').run(row.id);
      return res.status(400).json({ error: 'Incorrect OTP' });
    }
    db.prepare('UPDATE otps SET used=1 WHERE id=?').run(row.id);
    db.prepare('UPDATE users SET verified=1 WHERE id=?').run(req.user.sub);
    res.json({ message: 'Email verified' });
  } catch (e) {
    console.error('VERIFY OTP ERROR:', e);
    res.status(500).json({ error: 'Unable to verify OTP' });
  }
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!cleanEmail) return res.status(400).json({ error: 'Email address is required' });

    const user = db.prepare('SELECT id,name,email,verified FROM users WHERE email=?').get(cleanEmail);

    // Always return generic message so we don't reveal if account exists
    if (!user || !user.verified) {
      return res.json({ message: 'If an account exists with that email, a reset OTP has been sent.' });
    }

    try {
      const devOtp = await sendOtp(user, 'reset');
      return res.json({ message: 'If an account exists with that email, a reset OTP has been sent.', devOtp });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Unable to send password reset OTP' });
    }

  } catch (e) {
    console.error('FORGOT PASSWORD ERROR:', e);
    res.status(500).json({ error: 'Unable to send password reset OTP' });
  }
});

// RESET PASSWORD
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail || !code || !newPassword)
      return res.status(400).json({ error: 'Email, OTP and new password are required' });

    if (String(newPassword).length < 8)
      return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = db.prepare('SELECT * FROM users WHERE email=?').get(cleanEmail);
    if (!user || !user.verified)
      return res.status(400).json({ error: 'Invalid reset request' });

    const row = db.prepare(`SELECT * FROM otps WHERE user_id=? AND purpose='reset' AND used=0 ORDER BY id DESC LIMIT 1`).get(user.id);
    if (!row || row.expires_at < Date.now() || row.attempts >= 5)
      return res.status(400).json({ error: 'OTP expired or unavailable' });

    if (hashOtp(String(code)) !== row.code_hash) {
      db.prepare('UPDATE otps SET attempts=attempts+1 WHERE id=?').run(row.id);
      return res.status(400).json({ error: 'Incorrect OTP' });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 12);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, user.id);
    db.prepare('UPDATE otps SET used=1 WHERE id=?').run(row.id);

    res.json({ message: 'Password reset successfully' });

  } catch (e) {
    console.error('RESET PASSWORD ERROR:', e);
    res.status(500).json({ error: 'Unable to reset password' });
  }
});

// CURRENT USER
app.get('/api/me', auth, (req, res) => {
  try {
    const u = db.prepare('SELECT id,name,email,phone,verified,points,created_at FROM users WHERE id=?').get(req.user.sub);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { ...u, verified: Boolean(u.verified) } });
  } catch (e) {
    console.error('ME ERROR:', e);
    res.status(500).json({ error: 'Unable to load user' });
  }
});

// RAZORPAY CREATE ORDER
app.post('/api/payments/order', auth, async (req, res) => {
  try {
    if (!razorpay) return res.status(503).json({ error: 'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the backend.' });
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount < 100) return res.status(400).json({ error: 'Invalid amount' });
    const order = await razorpay.orders.create({ amount, currency: 'INR', receipt: `recyclr_${req.user.sub}_${Date.now()}`, notes: { user_id: String(req.user.sub) } });
    db.prepare('INSERT INTO orders(user_id,razorpay_order_id,amount,currency,status,created_at) VALUES(?,?,?,?,?,?)')
      .run(req.user.sub, order.id, amount, 'INR', 'created', new Date().toISOString());
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (e) {
    console.error('RAZORPAY ORDER ERROR:', e);
    res.status(500).json({ error: 'Could not create payment order' });
  }
});

// RAZORPAY VERIFY PAYMENT
app.post('/api/payments/verify', auth, (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    const order = db.prepare('SELECT * FROM orders WHERE razorpay_order_id=? AND user_id=?').get(razorpay_order_id, req.user.sub);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${order.razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    const received = Buffer.from(String(razorpay_signature || ''));
    const expectedBuffer = Buffer.from(expected);
    if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, received))
      return res.status(400).json({ error: 'Payment verification failed' });
    db.prepare('UPDATE orders SET status=? WHERE id=?').run('paid', order.id);
    res.json({ message: 'Payment verified', orderId: order.razorpay_order_id });
  } catch (e) {
    console.error('PAYMENT VERIFY ERROR:', e);
    res.status(500).json({ error: 'Unable to verify payment' });
  }
});

// SERVE FRONTEND
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.resolve(__dirname)));

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Recyclr API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`SMTP configured: ${Boolean(mailer)}`);
  console.log(`Razorpay configured: ${Boolean(razorpay)}`);
});
