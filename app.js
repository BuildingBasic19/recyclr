const products = [
  { id: 1, name: 'Recycled Planter', cat: 'Garden', price: 499, points: 1900, emoji: '🪴', material: 'Made from 8 recycled bottles', rating: 4.8 },
  { id: 2, name: 'Eco Chair', cat: 'Furniture', price: 2999, points: 12000, emoji: '🪑', material: 'Made from 32 recycled bottles', rating: 4.7 },
  { id: 3, name: 'Recycled Backpack', cat: 'Clothing', price: 1799, points: 7000, emoji: '🎒', material: 'Made from 20 recycled bottles', rating: 4.6 },
  { id: 4, name: 'Desk Organizer', cat: 'Office', price: 699, points: 3200, emoji: '🗂️', material: 'Made from 5 recycled bottles', rating: 4.9 },
  { id: 5, name: 'Eco Storage Box', cat: 'Home Decor', price: 899, points: 3600, emoji: '📦', material: 'Made from 11 recycled bottles', rating: 4.5 },
  { id: 6, name: 'Recycled Notebook', cat: 'Stationery', price: 299, points: 1200, emoji: '📓', material: 'Made with recycled plastic covers', rating: 4.8 },
  { id: 7, name: 'Garden Stool', cat: 'Garden', price: 1299, points: 5200, emoji: '🪑', material: 'Made from 18 recycled bottles', rating: 4.6 },
  { id: 8, name: 'Kids Building Set', cat: 'Kids Toys', price: 799, points: 3100, emoji: '🧩', material: 'Made from recycled PP plastic', rating: 4.7 }
];

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const API = (window.RECYCLR_CONFIG?.API_BASE_URL || '').replace(/\/$/, '');
const getToken = () => localStorage.getItem('recyclrToken') || '';
const getUser = () => JSON.parse(localStorage.getItem('recyclrUser') || 'null');

// ─── TOAST ───────────────────────────────────────────────────
function toast(msg) {
  let t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toast);
  window._toast = setTimeout(() => t.classList.remove('show'), 2500);
}

// ─── API HELPER ──────────────────────────────────────────────
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  const r = await fetch(`${API}${path}`, { ...options, headers });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── CART ────────────────────────────────────────────────────
function getCart() { return JSON.parse(localStorage.getItem('recyclrCart') || '[]'); }
function saveCart(c) { localStorage.setItem('recyclrCart', JSON.stringify(c)); updateCartCount(); }
function updateCartCount() {
  let n = getCart().reduce((a, b) => a + b.qty, 0);
  $$('[data-cart-count]').forEach(e => e.textContent = n);
}
function addToCart(id) {
  let c = getCart(), x = c.find(i => i.id === id);
  x ? x.qty++ : c.push({ id, qty: 1 });
  saveCart(c);
  toast('Added to cart 🛒');
}

// ─── SHOP ────────────────────────────────────────────────────
function renderProducts(list = products, target = '#products') {
  let el = $(target);
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="card empty-state"><div style="font-size:44px">🔎</div><h3>No products found</h3><p class="muted">Try changing your search or filters.</p></div>';
    return;
  }
  el.innerHTML = list.map(p => `
    <div class="card product-card">
      <div class="product-img">${p.emoji}</div>
      <div class="muted">${p.cat}</div>
      <h3>${p.name}</h3>
      <p class="muted">${p.material}</p>
      <div><span class="stars">★ ${p.rating}</span> <span class="muted">(120+)</span></div>
      <p><b class="price">₹${p.price.toLocaleString('en-IN')}</b> <span class="muted">or ${p.points.toLocaleString()} pts</span></p>
      <button class="btn primary" onclick="addToCart(${p.id})">Add to Cart</button>
    </div>
  `).join('');
}

function initShop() {
  if (!$('#products') || !$('#search')) return;
  const apply = () => {
    const q = $('#search').value.trim().toLowerCase();
    const cat = $('#category')?.value || 'All';
    const price = Number($('#priceFilter')?.value || 0);
    const rating = Number($('#ratingFilter')?.value || 0);
    const sort = $('#sortFilter')?.value || 'featured';
    let list = products.filter(p =>
      (!q || (p.name + ' ' + p.cat + ' ' + p.material).toLowerCase().includes(q)) &&
      (cat === 'All' || p.cat === cat) &&
      (!price || p.price <= price) &&
      (!rating || p.rating >= rating)
    );
    if (sort === 'newest') list.sort((a, b) => b.id - a.id);
    if (sort === 'rating') list.sort((a, b) => b.rating - a.rating || a.price - b.price);
    if (sort === 'price-low') list.sort((a, b) => a.price - b.price);
    if (sort === 'price-high') list.sort((a, b) => b.price - a.price);
    renderProducts(list);
    if ($('#filterCount')) $('#filterCount').textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
  };
  ['search', 'category', 'priceFilter', 'ratingFilter', 'sortFilter'].forEach(id => {
    const el = $('#' + id);
    if (el) { el.addEventListener('input', apply); el.addEventListener('change', apply); }
  });
  $('#clearFilters')?.addEventListener('click', () => {
    ['search'].forEach(id => { if ($('#' + id)) $('#' + id).value = ''; });
    [['category', 'All'], ['priceFilter', '0'], ['ratingFilter', '0'], ['sortFilter', 'featured']]
      .forEach(([id, val]) => { if ($('#' + id)) $('#' + id).value = val; });
    apply();
  });
  apply();
}

// ─── CART PAGE ───────────────────────────────────────────────
function renderCart() {
  let el = $('#cartItems');
  if (!el) return;
  let c = getCart();
  if (!c.length) {
    el.innerHTML = '<div class="card" style="text-align:center;padding:50px"><div style="font-size:55px">🛍️</div><h2>Your cart is empty</h2><p class="muted">Find something made from recycled plastic.</p><a class="btn primary" href="shop.html">Start Shopping</a></div>';
    if ($('#subtotal')) $('#subtotal').textContent = '₹0';
    return;
  }
  let total = 0;
  el.innerHTML = c.map(i => {
    let p = products.find(x => x.id === i.id);
    if (!p) return '';
    let sum = p.price * i.qty;
    total += sum;
    return `
      <div class="cart-row">
        <div class="cart-thumb">${p.emoji}</div>
        <div><b>${p.name}</b><div class="muted">₹${p.price.toLocaleString('en-IN')}</div></div>
        <div class="qty">
          <button onclick="changeQty(${p.id},-1)">−</button>
          <b>${i.qty}</b>
          <button onclick="changeQty(${p.id},1)">+</button>
        </div>
        <b>₹${sum.toLocaleString('en-IN')}</b>
      </div>
    `;
  }).join('');
  if ($('#subtotal')) $('#subtotal').textContent = '₹' + total.toLocaleString('en-IN');
  if ($('#checkoutAmount')) $('#checkoutAmount').textContent = '₹' + total.toLocaleString('en-IN');
}

function changeQty(id, d) {
  let c = getCart(), x = c.find(i => i.id === id);
  if (!x) return;
  x.qty += d;
  if (x.qty <= 0) c = c.filter(i => i.id !== id);
  saveCart(c);
  renderCart();
}

// ─── RECYCLE / PICKUP ────────────────────────────────────────
function initRecycle() {
  let w = $('#weight'), pts = $('#estimatedPoints'), type = $('#plasticType');
  function calc() {
    let rate = { PET: 50, HDPE: 45, PVC: 35, LDPE: 30, PP: 40, PS: 25 }[type?.value || 'PET'];
    if (pts) pts.textContent = Math.round((w?.value || 5) * rate) + ' pts';
  }
  w?.addEventListener('input', () => {
    if ($('#weightValue')) $('#weightValue').textContent = w.value + ' kg';
    calc();
  });
  type?.addEventListener('change', calc);
  $('#recycleForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    let kg = Number(w?.value || 5);
    let points = Number((pts?.textContent || '0').replace(/\D/g, ''));
    const f = e.currentTarget;
    const date = f.querySelector('input[type=date]')?.value;
    const time = f.querySelector('input[type=time]')?.value;
    const address = f.querySelector('textarea')?.value.trim();
    if (!date || !time || !address) return toast('Please enter pickup date, time and address');
    const payload = { plasticType: type?.value || 'PET', weightKg: kg, pickupDate: date, pickupTime: time, address, points };

    // Save locally since /api/pickups is not yet built on backend
    localStorage.setItem('lastPickup', JSON.stringify({
      ...payload,
      status: 'Scheduled',
      scheduledAt: new Date().toLocaleDateString()
    }));
    toast(`Pickup scheduled! +${points} points estimated 🎉`);
    setTimeout(() => location.href = 'tracking.html', 700);
  });
  calc();
}

// ─── AUTH ────────────────────────────────────────────────────
async function initAuth() {
  // Redirect logged-in users away from login/signup
  const onAuthPage = window.location.pathname.includes('login') || window.location.pathname.includes('signup');
  if (onAuthPage && getToken() && getUser()?.verified) {
    location.href = 'dashboard.html';
    return;
  }

  const login = $('#loginForm');
  const signup = $('#signupForm');

  if (login) {
    login.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const d = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: login.elements.email.value,
            password: login.elements.password.value
          })
        });
        localStorage.setItem('recyclrToken', d.token);
        localStorage.setItem('recyclrUser', JSON.stringify(d.user));
        toast('Welcome back! 👋');
        setTimeout(() => location.href = d.user.verified ? 'dashboard.html' : 'otp.html', 500);
      } catch (err) {
        toast(err.message);
      }
    });
  }

  if (signup) {
    signup.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const d = await api('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            name: signup.elements.name.value,
            email: signup.elements.email.value,
            phone: signup.elements.phone.value,
            password: signup.elements.password.value
          })
        });
        localStorage.setItem('recyclrToken', d.token);
        localStorage.setItem('recyclrUser', JSON.stringify({
          name: signup.elements.name.value,
          email: signup.elements.email.value,
          verified: false
        }));
        if (d.devOtp) localStorage.setItem('recyclrDevOtp', d.devOtp);
        toast('Account created! Check your email for OTP 📧');
        setTimeout(() => location.href = 'otp.html', 500);
      } catch (err) {
        toast(err.message);
      }
    });
  }
}

// ─── OTP ─────────────────────────────────────────────────────
async function initOtp() {
  const f = $('#otpForm');
  if (!f) return;

  // Redirect if already verified
  if (getUser()?.verified) { location.href = 'dashboard.html'; return; }
  // Redirect if not logged in
  if (!getToken()) { location.href = 'login.html'; return; }

  const send = async () => {
    try {
      const d = await api('/api/auth/send-otp', { method: 'POST' });
      if (d.devOtp) {
        localStorage.setItem('recyclrDevOtp', d.devOtp);
        if ($('#devOtp')) $('#devOtp').textContent = `Dev OTP: ${d.devOtp}`;
      }
      toast('OTP sent ✓');
    } catch (err) {
      toast(err.message);
    }
  };

  await send();

  f.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ code: f.elements.code.value })
      });
      const u = getUser();
      if (u) { u.verified = true; localStorage.setItem('recyclrUser', JSON.stringify(u)); }
      localStorage.removeItem('recyclrDevOtp');
      toast('Email verified! Welcome to Recyclr 🎉');
      setTimeout(() => location.href = 'dashboard.html', 500);
    } catch (err) {
      toast(err.message);
    }
  });

  $('#resendOtp')?.addEventListener('click', send);

  const devOtp = localStorage.getItem('recyclrDevOtp');
  if (devOtp && $('#devOtp')) $('#devOtp').textContent = `Dev OTP: ${devOtp}`;
}

// ─── DASHBOARD ───────────────────────────────────────────────
async function initDashboard() {
  if (!$('#dashboardPage')) return;

  // Redirect if not logged in
  if (!getToken()) { location.href = 'login.html'; return; }

  // Load fresh user data from backend
  try {
    const d = await api('/api/me');
    const u = d.user;
    localStorage.setItem('recyclrUser', JSON.stringify(u));

    // Update points display
    $$('[data-points]').forEach(e => e.textContent = u.points?.toLocaleString('en-IN') || '250');

    // Update name display
    $$('[data-user]').forEach(e => e.textContent = u.name || 'Recycler');

    // Update verified badge
    if (!u.verified) {
      const banner = document.createElement('div');
      banner.className = 'card';
      banner.style = 'background:#fef3c7;border-color:#f59e0b;margin-bottom:16px';
      banner.innerHTML = '⚠️ Your email is not verified. <a href="otp.html">Verify now</a>';
      document.querySelector('.page')?.prepend(banner);
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
  }

  // Load last pickup for display
  const lastPickup = JSON.parse(localStorage.getItem('lastPickup') || 'null');
  if (lastPickup && $('#lastPickupStatus')) {
    $('#lastPickupStatus').textContent = lastPickup.status || 'Scheduled';
  }
}

// ─── CHECKOUT ────────────────────────────────────────────────
async function initCheckout() {
  const f = $('#checkoutForm');
  if (!f) return;

  if (!getToken()) {
    toast('Please login before checkout');
    setTimeout(() => location.href = 'login.html', 700);
    return;
  }

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const cart = getCart();
    const amount = cart.reduce((sum, i) => sum + (products.find(p => p.id === i.id)?.price || 0) * i.qty, 0);
    if (!amount) return toast('Your cart is empty');

    try {
      const order = await api('/api/payments/order', {
        method: 'POST',
        body: JSON.stringify({ amount: amount * 100 })
      });

      if (!window.Razorpay) throw new Error('Payment checkout is unavailable. Please add Razorpay credentials.');

      const user = getUser();
      const rz = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Recyclr',
        description: 'Recycled products order',
        order_id: order.orderId,
        prefill: {
          name: f.elements.fullName?.value || user?.name || '',
          email: user?.email || '',
          contact: f.elements.phone?.value || ''
        },
        theme: { color: '#15803D' },
        handler: async response => {
          try {
            await api('/api/payments/verify', { method: 'POST', body: JSON.stringify(response) });
            localStorage.removeItem('recyclrCart');
            updateCartCount();
            toast('Payment verified 🎉');
            setTimeout(() => location.href = 'dashboard.html', 700);
          } catch (err) {
            toast(err.message);
          }
        }
      });
      rz.open();
    } catch (err) {
      toast(err.message);
    }
  });
}

// ─── TRACKING ────────────────────────────────────────────────
function initTracking() {
  const pickup = JSON.parse(localStorage.getItem('lastPickup') || 'null');
  if (!pickup) return;

  const steps = ['Scheduled', 'Agent Assigned', 'Picked Up', 'At Plant', 'Verified', 'Points Credited'];
  const currentStep = steps.indexOf(pickup.status || 'Scheduled');

  $$('[data-step]').forEach(el => {
    const step = Number(el.dataset.step);
    if (step <= currentStep) el.classList.add('active');
  });

  if ($('#pickupPlasticType')) $('#pickupPlasticType').textContent = pickup.plasticType || 'PET';
  if ($('#pickupWeight')) $('#pickupWeight').textContent = (pickup.weightKg || 0) + ' kg';
  if ($('#pickupDate')) $('#pickupDate').textContent = pickup.pickupDate || '-';
  if ($('#pickupAddress')) $('#pickupAddress').textContent = pickup.address || '-';
  if ($('#pickupPoints')) $('#pickupPoints').textContent = '+' + (pickup.points || 0) + ' pts estimated';
}

// ─── THEME ───────────────────────────────────────────────────
function initTheme() {
  if (localStorage.getItem('dark') === '1') document.body.classList.add('dark');
  $$('[data-theme]').forEach(b => b.onclick = () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('dark', document.body.classList.contains('dark') ? '1' : '0');
  });
}

// ─── MISC FORMS ──────────────────────────────────────────────
function initForms() {
  $$('form[data-demo]').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    toast('Saved successfully ✓');
  }));

  $('#logout')?.addEventListener('click', () => {
    localStorage.removeItem('recyclrUser');
    localStorage.removeItem('recyclrToken');
    localStorage.removeItem('recyclrDevOtp');
    toast('Logged out. See you soon! 👋');
    setTimeout(() => location.href = 'index.html', 500);
  });

  $('#copyReferral')?.addEventListener('click', () => {
    navigator.clipboard?.writeText('RECYCLE250');
    toast('Referral code copied!');
  });
}

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateCartCount();
  initTheme();
  initForms();
  initShop();
  renderCart();
  initRecycle();
  initAuth();
  initOtp();
  initDashboard();
  initCheckout();
  initTracking();

  $$('[data-demo-action]').forEach(b => b.onclick = () => toast(b.dataset.demoAction));

  // Update all user name displays
  const u = getUser();
  $$('[data-user]').forEach(e => e.textContent = u?.name || 'Recycler');
});
