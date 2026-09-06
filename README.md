# Recyclr backend

Node/Express API for authentication, email OTP verification and Razorpay payments.

## Local

```bash
cd backend
cp .env.example .env
npm install
npm start
```

For real email OTP, configure SMTP variables. In development only, the API returns `devOtp` to make local testing easy. Never use that shortcut in production.

For real payments, add Razorpay test credentials first. Keep `RAZORPAY_KEY_SECRET` server-side only.

## Production

Deploy this folder to a Node-capable host such as Render, Railway or a VPS. GitHub Pages can host the frontend, but it cannot execute this backend. Set `FRONTEND_ORIGIN` to the exact GitHub Pages origin and configure all secrets in the host's environment variables.
