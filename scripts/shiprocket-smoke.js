#!/usr/bin/env node
/**
 * Read-only production smoke test for Shiprocket & API routes.
 * Never creates orders, assigns couriers, schedules pickups, cancels, or writes to Firestore.
 * Never prints tokens, passwords, or emails.
 *
 * Usage:
 *   npm run smoke:shiprocket -- https://kalyan-covering-store.vercel.app 629001
 */
'use strict';

const rawBase = (process.argv[2] || '').trim().replace(/\/+$/, '');
const pincode = (process.argv[3] || '629001').trim();

if (!/^https?:\/\//i.test(rawBase)) {
  console.error('Usage: npm run smoke:shiprocket -- <base-url> [6-digit-pincode]');
  console.error('Example: npm run smoke:shiprocket -- https://kalyan-covering-store.vercel.app 629001');
  process.exit(1);
}

if (!/^\d{6}$/.test(pincode)) {
  console.error(`Invalid 6-digit pincode argument: ${pincode}`);
  process.exit(1);
}

async function request(method, path, { headers = {}, body } = {}) {
  const url = `${rawBase}${path}`;
  const opts = {
    method,
    headers: {
      'Accept': 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    signal: AbortSignal.timeout(15000)
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }
  return { status: res.status, json };
}

async function run() {
  let failed = 0;

  function report(num, label, ok, detail = '') {
    const tag = ok ? 'PASS' : 'FAIL';
    if (!ok) failed++;
    console.log(`[${tag}] ${num}. ${label}${detail ? ` — ${detail}` : ''}`);
  }

  // 1. POST /api/shipping/pincode-check (valid pincode)
  try {
    const r = await request('POST', '/api/shipping/pincode-check', { body: { pincode } });
    const deliverable = r.status === 200 && r.json && r.json.success === true && r.json.isServiceable !== false;
    const courierInfo = r.json
      ? [
          r.json.courierName ? `courier=${r.json.courierName}` : null,
          r.json.estimatedDays ? `days=${r.json.estimatedDays}` : null,
          r.json.availableCouriersCount !== undefined ? `count=${r.json.availableCouriersCount}` : null
        ].filter(Boolean).join(', ')
      : '';
    report(1, `POST /api/shipping/pincode-check (${pincode})`, deliverable, `HTTP ${r.status}${courierInfo ? ` (${courierInfo})` : ''}`);
  } catch (err) {
    report(1, `POST /api/shipping/pincode-check (${pincode})`, false, err.message);
  }

  // 2. POST /api/shipping/pincode-check (invalid pincode "12")
  try {
    const r = await request('POST', '/api/shipping/pincode-check', { body: { pincode: '12' } });
    report(2, 'POST /api/shipping/pincode-check (invalid "12")', r.status === 400, `HTTP ${r.status}`);
  } catch (err) {
    report(2, 'POST /api/shipping/pincode-check (invalid "12")', false, err.message);
  }

  // 3. POST /api/shipping/webhook (no x-api-key)
  try {
    const r = await request('POST', '/api/shipping/webhook', { body: {} });
    report(3, 'POST /api/shipping/webhook (missing x-api-key)', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  } catch (err) {
    report(3, 'POST /api/shipping/webhook (missing x-api-key)', false, err.message);
  }

  // 4. POST /api/shipping/webhook (wrong x-api-key)
  try {
    const r = await request('POST', '/api/shipping/webhook', {
      headers: { 'x-api-key': 'wrong-token-123' },
      body: { awb: 'TEST' }
    });
    report(4, 'POST /api/shipping/webhook (wrong x-api-key)', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  } catch (err) {
    report(4, 'POST /api/shipping/webhook (wrong x-api-key)', false, err.message);
  }

  // 5. POST /api/shipping/create-shipment (no Authorization)
  try {
    const r = await request('POST', '/api/shipping/create-shipment', { body: {} });
    report(5, 'POST /api/shipping/create-shipment (no Auth)', r.status === 401, `HTTP ${r.status}`);
  } catch (err) {
    report(5, 'POST /api/shipping/create-shipment (no Auth)', false, err.message);
  }

  // 6. POST /api/shipping/track (no Authorization)
  try {
    const r = await request('POST', '/api/shipping/track', { body: {} });
    report(6, 'POST /api/shipping/track (no Auth)', r.status === 401, `HTTP ${r.status}`);
  } catch (err) {
    report(6, 'POST /api/shipping/track (no Auth)', false, err.message);
  }

  // 7. GET /api/payments/webhook (expect 404/405 JSON)
  try {
    const r = await request('GET', '/api/payments/webhook');
    const ok = (r.status === 404 || r.status === 405) && r.json !== null;
    report(7, 'GET /api/payments/webhook (route alive)', ok, `HTTP ${r.status}${r.json ? ' (JSON)' : ' (non-JSON)'}`);
  } catch (err) {
    report(7, 'GET /api/payments/webhook (route alive)', false, err.message);
  }

  process.exit(failed > 0 ? 1 : 0);
}

run();
