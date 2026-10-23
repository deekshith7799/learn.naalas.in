// Deterministic sample "shop" dataset. Every user gets the same data in all three engines.
const FIRST = ['Asha', 'Ravi', 'Priya', 'Kiran', 'Meena', 'Arjun', 'Sneha', 'Vikram', 'Lakshmi', 'Rahul', 'Divya', 'Suresh', 'Anita', 'Manoj', 'Pooja', 'Naveen', 'Swathi', 'Harish', 'Kavya', 'Deepak'];
const LAST = ['Reddy', 'Sharma', 'Iyer', 'Patel', 'Naidu', 'Gupta', 'Rao', 'Singh', 'Kumar', 'Nair', 'Das', 'Joshi', 'Menon', 'Verma', 'Chowdary'];
const CITIES = ['Hyderabad', 'Bengaluru', 'Mumbai', 'Chennai', 'Pune', 'Delhi', 'Kolkata', 'Ahmedabad'];
const CATALOG = {
  Grocery: { range: [40, 900], items: ['Basmati Rice 5kg', 'Toor Dal 1kg', 'Sunflower Oil 1L', 'Tea Powder 500g', 'Wheat Flour 5kg', 'Sugar 1kg', 'Ghee 500ml', 'Salt 1kg'] },
  Electronics: { range: [150, 4500], items: ['USB Cable', 'Power Bank', 'Earphones', 'Phone Stand', 'LED Bulb Pack', 'Extension Board', 'Webcam', 'Wireless Mouse'] },
  Books: { range: [120, 800], items: ['SQL Basics', 'PostgreSQL Notes', 'Linux Handbook', 'Python Cookbook', 'Cloud Guide', 'DevOps Primer', 'Data Modeling', 'Networking 101'] },
  Home: { range: [100, 2200], items: ['Steel Bottle', 'Lunch Box', 'Bedsheet', 'Door Mat', 'Wall Clock', 'Storage Box', 'Cushion Cover', 'Table Lamp'] },
  Fitness: { range: [150, 3000], items: ['Yoga Mat', 'Dumbbell Pair', 'Skipping Rope', 'Resistance Band', 'Water Jug', 'Gym Gloves', 'Foam Roller', 'Shaker Bottle'] },
};
const STATUS = [['delivered', 0.55], ['paid', 0.13], ['shipped', 0.12], ['pending', 0.1], ['cancelled', 0.1]];

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();
const dateOf = ms => iso(ms).slice(0, 10);
const dateTimeOf = ms => iso(ms).slice(0, 19).replace('T', ' ');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

export const COUNTS = { customers: 200, products: 40, orders: 5000 };

export function buildDataset() {
  const r = rng(20261010);

  const customers = Array.from({ length: COUNTS.customers }, (_, i) => {
    const id = i + 1;
    const f = pick(r, FIRST);
    const l = pick(r, LAST);
    return {
      id,
      name: `${f} ${l}`,
      email: `${f}.${l}${id}@example.com`.toLowerCase(),
      city: pick(r, CITIES),
      signup_date: dateOf(Date.UTC(2024, 6, 1) + Math.floor(r() * 180) * DAY),
    };
  });

  const products = [];
  for (const [category, { range, items }] of Object.entries(CATALOG)) {
    for (const name of items) {
      const price = Math.round((range[0] + r() * (range[1] - range[0])) * 100) / 100;
      products.push({ id: products.length + 1, name, category, price });
    }
  }

  const orders = [];
  const items = [];
  const start = Date.UTC(2025, 0, 1);
  for (let id = 1; id <= COUNTS.orders; id++) {
    const created = start + Math.floor(r() * 638 * DAY) + Math.floor(r() * DAY);
    let total = 0;
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const p = products[Math.floor(r() * products.length)];
      const qty = 1 + Math.floor(r() * 5);
      items.push({ id: items.length + 1, order_id: id, product_id: p.id, qty, unit_price: p.price });
      total += qty * p.price;
    }
    let x = r();
    let status = STATUS[STATUS.length - 1][0];
    for (const [s, w] of STATUS) { if (x < w) { status = s; break; } x -= w; }
    orders.push({
      id,
      customer_id: 1 + Math.floor(Math.pow(r(), 1.6) * COUNTS.customers),
      status,
      total: Math.round(total * 100) / 100,
      created_at: dateTimeOf(created),
    });
  }
  return { customers, products, orders, items };
}

// Mongo-shaped orders: items embedded, created_at as a real Date.
export function toMongo(ds) {
  const byOrder = new Map();
  for (const it of ds.items) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push({ product_id: it.product_id, qty: it.qty, unit_price: it.unit_price });
  }
  return {
    customers: ds.customers.map(({ id, ...c }) => ({ _id: id, ...c })),
    products: ds.products.map(({ id, ...p }) => ({ _id: id, ...p })),
    orders: ds.orders.map(({ id, created_at, ...o }) => ({
      _id: id,
      ...o,
      created_at: new Date(created_at.replace(' ', 'T') + 'Z'),
      items: byOrder.get(id) || [],
    })),
  };
}

export const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
