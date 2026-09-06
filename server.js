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
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT,password_hash TEXT NOT NULL,verified INTEGER DEFAULT 0,points INTEGER DEFAULT 250,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS otps(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER DEFAULT 0,used INTEGER DEFAULT 0,created_at INTEGER NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,razorpay_order_id TEXT UNIQUE NOT NULL,amount INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT DEFAULT 'created',created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));`);

const allowedOrigins=(process.env.FRONTEND_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(cors({origin:(origin,cb)=>{if(!origin||allowedOrigins.length===0||allowedOrigins.includes(origin))return cb(null,true);cb(new Error('Origin not allowed'));}}));
app.use(express.json({limit:'100kb'}));
app.use(rateLimit({windowMs:15*60*1000,max:300,standardHeaders:true,legacyHeaders:false}));

const mailer=(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS)?nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT||587)===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}):null;
const razorpay=(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET)?new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;

function hashOtp(code){return crypto.createHash('sha256').update(code).digest('hex');}
function tokenFor(user){return jwt.sign({sub:user.id,email:user.email,name:user.name},process.env.JWT_SECRET||'dev-only-secret-change-me',{expiresIn:'7d'});}
function auth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Authentication required'});req.user=jwt.verify(h.slice(7),process.env.JWT_SECRET||'dev-only-secret-change-me');next();}catch{return res.status(401).json({error:'Invalid or expired session'});}}
async function sendOtp(user){const code=String(crypto.randomInt(100000,1000000));db.prepare('UPDATE otps SET used=1 WHERE user_id=? AND used=0').run(user.id);db.prepare('INSERT INTO otps(user_id,code_hash,expires_at,created_at) VALUES(?,?,?,?)').run(user.id,hashOtp(code),Date.now()+10*60*1000,Date.now());if(mailer){await mailer.sendMail({from:process.env.MAIL_FROM,to:user.email,subject:'Your Recyclr verification code',text:`Your Recyclr OTP is ${code}. It expires in 10 minutes.`});}return process.env.NODE_ENV==='production'?undefined:code;}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'recyclr-api',time:new Date().toISOString()}));
app.post('/api/auth/signup',async(req,res)=>{try{const {name,email,phone,password}=req.body||{};if(!name||!email||!password||password.length<8)return res.status(400).json({error:'Name, email and an 8+ character password are required'});const exists=db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase());if(exists)return res.status(409).json({error:'An account with this email already exists'});const user={name:name.trim(),email:email.trim().toLowerCase(),phone:phone?.trim()||null};const info=db.prepare('INSERT INTO users(name,email,phone,password_hash,created_at) VALUES(?,?,?,?,?)').run(user.name,user.email,user.phone,await bcrypt.hash(password,12),new Date().toISOString());user.id=info.lastInsertRowid;const devOtp=await sendOtp(user);res.status(201).json({message:'Account created. Verify your email with the OTP.',token:tokenFor(user),devOtp});}catch(e){res.status(500).json({error:'Unable to create account'});}});
app.post('/api/auth/login',async(req,res)=>{const {email,password}=req.body||{};const user=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').trim().toLowerCase());if(!user||!(await bcrypt.compare(String(password||''),user.password_hash)))return res.status(401).json({error:'Invalid email or password'});res.json({token:tokenFor(user),user:{id:user.id,name:user.name,email:user.email,verified:Boolean(user.verified),points:user.points}});});
app.post('/api/auth/send-otp',auth,async(req,res)=>{const user=db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.user.sub);if(!user)return res.status(404).json({error:'User not found'});const devOtp=await sendOtp(user);res.json({message:'OTP sent',devOtp});});
app.post('/api/auth/verify-otp',auth,(req,res)=>{const {code}=req.body||{};const row=db.prepare('SELECT * FROM otps WHERE user_id=? AND used=0 ORDER BY id DESC LIMIT 1').get(req.user.sub);if(!row||row.expires_at<Date.now()||row.attempts>=5)return res.status(400).json({error:'OTP expired or unavailable'});if(hashOtp(String(code||''))!==row.code_hash){db.prepare('UPDATE otps SET attempts=attempts+1 WHERE id=?').run(row.id);return res.status(400).json({error:'Incorrect OTP'});}db.prepare('UPDATE otps SET used=1 WHERE id=?').run(row.id);db.prepare('UPDATE users SET verified=1 WHERE id=?').run(req.user.sub);res.json({message:'Email verified'});});
app.get('/api/me',auth,(req,res)=>{const u=db.prepare('SELECT id,name,email,phone,verified,points,created_at FROM users WHERE id=?').get(req.user.sub);if(!u)return res.status(404).json({error:'User not found'});res.json({user:{...u,verified:Boolean(u.verified)}});});

app.post('/api/payments/order',auth,async(req,res)=>{try{if(!razorpay)return res.status(503).json({error:'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the backend.'});const amount=Number(req.body?.amount);if(!Number.isInteger(amount)||amount<100)return res.status(400).json({error:'Invalid amount'});const order=await razorpay.orders.create({amount,currency:'INR',receipt:`recyclr_${req.user.sub}_${Date.now()}`,notes:{user_id:String(req.user.sub)}});db.prepare('INSERT INTO orders(user_id,razorpay_order_id,amount,currency,status,created_at) VALUES(?,?,?,?,?,?)').run(req.user.sub,order.id,amount,'INR','created',new Date().toISOString());res.json({orderId:order.id,amount:order.amount,currency:order.currency,keyId:process.env.RAZORPAY_KEY_ID});}catch(e){res.status(500).json({error:'Could not create payment order'});}});
app.post('/api/payments/verify',auth,(req,res)=>{const {razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body||{};const order=db.prepare('SELECT * FROM orders WHERE razorpay_order_id=? AND user_id=?').get(razorpay_order_id,req.user.sub);if(!order)return res.status(404).json({error:'Order not found'});const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(`${order.razorpay_order_id}|${razorpay_payment_id}`).digest('hex');const received=Buffer.from(String(razorpay_signature||''));const expectedBuffer=Buffer.from(expected);if(received.length!==expectedBuffer.length||!crypto.timingSafeEqual(expectedBuffer,received))return res.status(400).json({error:'Payment verification failed'});db.prepare('UPDATE orders SET status=? WHERE id=?').run('paid',order.id);res.json({message:'Payment verified',orderId:order.razorpay_order_id});});

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
app.use(express.static(path.resolve(__dirname,'..'))); // optional local deployment
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Server error'});});
app.listen(PORT,()=>console.log(`Recyclr API running on http://localhost:${PORT}`));
