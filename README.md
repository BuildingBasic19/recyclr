# Recyclr — original frontend + backend

This package keeps the **original Recyclr HTML/CSS design** and adds a real Node/Express backend for account authentication, OTP verification, and Razorpay payment verification.

## Frontend
- Plain HTML + original `styles.css` + vanilla `app.js`
- GitHub Pages compatible
- Relative links (works for repository/project pages)
- Cart, shop filtering, recycle flow and theme remain client-side

## GitHub Pages + backend
GitHub Pages can host only the frontend. Deploy the repository root to GitHub Pages, then edit `config.js`:

```js
window.RECYCLR_CONFIG = {
  API_BASE_URL: 'https://YOUR-BACKEND.example.com'
};
```

The backend must allow your exact GitHub Pages origin in `FRONTEND_ORIGIN`.

## Backend local setup
```bash
cd backend
cp .env.example .env
npm install
npm start
```

Then open `http://localhost:3000`.

## Real services
- **OTP:** configure SMTP in `.env`. In development, the API returns a development OTP to make testing easy; do not use that shortcut in production.
- **Payments:** configure Razorpay test/live credentials. The Razorpay secret stays on the backend. The server verifies the payment signature before marking the order paid.
- **Database:** SQLite is stored in `backend/recyclr.db` by default.

## Important
Never commit `.env`, Razorpay secret keys, SMTP passwords, JWT secrets, or the SQLite production database to GitHub.
