// Content for the Practice lab. The sample data is the same shop in all three engines.
// SQL engines: customers, products, orders, order_items.  MongoDB: customers, products, orders (items embedded).

const SQL_TABLES = [
  { name: 'customers', cols: ['id', 'name', 'email', 'city', 'signup_date'], note: '200 rows' },
  { name: 'products', cols: ['id', 'name', 'category', 'price'], note: '40 rows, 5 categories' },
  { name: 'orders', cols: ['id', 'customer_id', 'status', 'total', 'created_at'], note: '5,000 rows' },
  { name: 'order_items', cols: ['id', 'order_id', 'product_id', 'qty', 'unit_price'], note: '~12,600 rows' },
];

const MONGO_TABLES = [
  { name: 'customers', cols: ['_id', 'name', 'email', 'city', 'signup_date'], note: '200 docs' },
  { name: 'products', cols: ['_id', 'name', 'category', 'price'], note: '40 docs' },
  { name: 'orders', cols: ['_id', 'customer_id', 'status', 'total', 'created_at', 'items[ {product_id, qty, unit_price} ]'], note: '5,000 docs, items embedded' },
];

export const LAB_LIMITS = 'Each run: 5 s limit, first 200 rows shown. Your sandbox is private to you and resets to the sample data if it grows past 128 MB.';

export const LAB = {
  postgresql: {
    name: 'PostgreSQL',
    color: '#336791',
    kind: 'SQL',
    starter: 'SELECT city, COUNT(*) AS customers\nFROM customers\nGROUP BY city\nORDER BY customers DESC;',
    tips: ['Run several statements at once, separated by ;', 'Meta-commands: \\dt (tables), \\d orders (columns and indexes), \\di (indexes)', 'One run is one session, so BEGIN ... COMMIT / ROLLBACK works inside a single run'],
    tables: SQL_TABLES,
    examples: [
      { title: 'Customers per city', code: 'SELECT city, COUNT(*) AS customers\nFROM customers\nGROUP BY city\nORDER BY customers DESC;' },
      { title: 'Orders by status', code: "SELECT status, COUNT(*) AS orders, ROUND(AVG(total), 2) AS avg_total\nFROM orders\nGROUP BY status\nORDER BY orders DESC;" },
      { title: 'Join: order lines with product names', code: 'SELECT o.id AS order_id, p.name, i.qty, i.unit_price\nFROM orders o\nJOIN order_items i ON i.order_id = o.id\nJOIN products p ON p.id = i.product_id\nWHERE o.id <= 3\nORDER BY o.id;' },
      { title: 'Window function: rank orders per customer', code: 'SELECT customer_id, id, total,\n       RANK() OVER (PARTITION BY customer_id ORDER BY total DESC) AS rnk\nFROM orders\nWHERE customer_id <= 3\nORDER BY customer_id, rnk;' },
      { title: 'See how a query runs', code: 'EXPLAIN (ANALYZE, BUFFERS)\nSELECT * FROM orders WHERE customer_id = 42;' },
      { title: 'List tables and indexes', code: '\\dt\n' },
    ],
    exercises: [
      {
        title: 'Filter and sort',
        task: 'List the name, email and signup date of customers from Hyderabad who signed up after 1 Oct 2024, newest first.',
        hint: 'WHERE with two conditions, then ORDER BY signup_date DESC.',
        solution: "SELECT name, email, signup_date\nFROM customers\nWHERE city = 'Hyderabad' AND signup_date > '2024-10-01'\nORDER BY signup_date DESC;",
      },
      {
        title: 'Group by month',
        task: 'Revenue per month from delivered orders in 2025.',
        hint: "date_trunc('month', created_at) turns a timestamp into its month.",
        solution: "SELECT date_trunc('month', created_at)::date AS month, SUM(total) AS revenue\nFROM orders\nWHERE status = 'delivered'\n  AND created_at >= '2025-01-01' AND created_at < '2026-01-01'\nGROUP BY 1\nORDER BY 1;",
      },
      {
        title: 'Join and aggregate',
        task: 'Top 5 customers by total spend, ignoring cancelled orders. Show name and spend.',
        hint: 'Join customers to orders, filter, GROUP BY the customer, ORDER BY the sum, LIMIT 5.',
        solution: "SELECT c.name, ROUND(SUM(o.total), 2) AS spent\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE o.status <> 'cancelled'\nGROUP BY c.id, c.name\nORDER BY spent DESC\nLIMIT 5;",
      },
      {
        title: 'Best seller per category',
        task: 'For each product category, show the product with the most units sold.',
        hint: 'Sum qty per product, then pick the first row per category with a window function or DISTINCT ON.',
        solution: 'SELECT category, name, units FROM (\n  SELECT p.category, p.name, SUM(i.qty) AS units,\n         ROW_NUMBER() OVER (PARTITION BY p.category ORDER BY SUM(i.qty) DESC) AS rn\n  FROM products p\n  JOIN order_items i ON i.product_id = p.id\n  GROUP BY p.category, p.id, p.name\n) t\nWHERE rn = 1;',
      },
      {
        title: 'Make a slow query fast',
        task: 'Run EXPLAIN ANALYZE for orders of customer 42, add an index that helps, then run it again. What changed in the plan and the timing?',
        hint: 'The first plan is a Seq Scan on orders. Index the column you filter on.',
        solution: 'EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;\nCREATE INDEX idx_orders_customer ON orders (customer_id);\nANALYZE orders;\nEXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;',
      },
      {
        title: 'Transactions',
        task: 'In one run: start a transaction, cancel order 1, show its status, roll back, show its status again.',
        hint: 'BEGIN; UPDATE ...; SELECT ...; ROLLBACK; SELECT ...;',
        solution: "BEGIN;\nUPDATE orders SET status = 'cancelled' WHERE id = 1;\nSELECT id, status FROM orders WHERE id = 1;\nROLLBACK;\nSELECT id, status FROM orders WHERE id = 1;",
      },
    ],
  },

  mysql: {
    name: 'MySQL',
    color: '#00758f',
    kind: 'SQL',
    starter: 'SELECT city, COUNT(*) AS customers\nFROM customers\nGROUP BY city\nORDER BY customers DESC;',
    tips: ['Run several statements at once, separated by ;', 'SHOW TABLES, DESCRIBE orders, SHOW INDEX FROM orders', 'One run is one session, so START TRANSACTION ... COMMIT / ROLLBACK works inside a single run'],
    tables: SQL_TABLES,
    examples: [
      { title: 'Customers per city', code: 'SELECT city, COUNT(*) AS customers\nFROM customers\nGROUP BY city\nORDER BY customers DESC;' },
      { title: 'Orders by status', code: 'SELECT status, COUNT(*) AS orders, ROUND(AVG(total), 2) AS avg_total\nFROM orders\nGROUP BY status\nORDER BY orders DESC;' },
      { title: 'Join: order lines with product names', code: 'SELECT o.id AS order_id, p.name, i.qty, i.unit_price\nFROM orders o\nJOIN order_items i ON i.order_id = o.id\nJOIN products p ON p.id = i.product_id\nWHERE o.id <= 3\nORDER BY o.id;' },
      { title: 'Window function: rank orders per customer', code: 'SELECT customer_id, id, total,\n       RANK() OVER (PARTITION BY customer_id ORDER BY total DESC) AS rnk\nFROM orders\nWHERE customer_id <= 3\nORDER BY customer_id, rnk;' },
      { title: 'See how a query runs', code: 'EXPLAIN ANALYZE\nSELECT * FROM orders WHERE customer_id = 42;' },
      { title: 'Tables, columns, indexes', code: 'SHOW TABLES;\nDESCRIBE orders;\nSHOW INDEX FROM orders;' },
    ],
    exercises: [
      {
        title: 'Filter and sort',
        task: 'List the name, email and signup date of customers from Hyderabad who signed up after 1 Oct 2024, newest first.',
        hint: 'WHERE with two conditions, then ORDER BY signup_date DESC.',
        solution: "SELECT name, email, signup_date\nFROM customers\nWHERE city = 'Hyderabad' AND signup_date > '2024-10-01'\nORDER BY signup_date DESC;",
      },
      {
        title: 'Group by month',
        task: 'Revenue per month from delivered orders in 2025.',
        hint: "DATE_FORMAT(created_at, '%Y-%m') gives a year-month label.",
        solution: "SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(total) AS revenue\nFROM orders\nWHERE status = 'delivered'\n  AND created_at >= '2025-01-01' AND created_at < '2026-01-01'\nGROUP BY month\nORDER BY month;",
      },
      {
        title: 'Join and aggregate',
        task: 'Top 5 customers by total spend, ignoring cancelled orders. Show name and spend.',
        hint: 'Join customers to orders, filter, GROUP BY the customer, ORDER BY the sum, LIMIT 5.',
        solution: "SELECT c.name, ROUND(SUM(o.total), 2) AS spent\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE o.status <> 'cancelled'\nGROUP BY c.id, c.name\nORDER BY spent DESC\nLIMIT 5;",
      },
      {
        title: 'Best seller per category',
        task: 'For each product category, show the product with the most units sold.',
        hint: 'Sum qty per product, then pick the first row per category with ROW_NUMBER().',
        solution: 'SELECT category, name, units FROM (\n  SELECT p.category, p.name, SUM(i.qty) AS units,\n         ROW_NUMBER() OVER (PARTITION BY p.category ORDER BY SUM(i.qty) DESC) AS rn\n  FROM products p\n  JOIN order_items i ON i.product_id = p.id\n  GROUP BY p.category, p.id, p.name\n) t\nWHERE rn = 1;',
      },
      {
        title: 'Make a slow query fast',
        task: 'Run EXPLAIN ANALYZE for orders of customer 42, add an index that helps, then run it again. What changed?',
        hint: 'The first plan scans the whole table. Index the column you filter on.',
        solution: 'EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;\nCREATE INDEX idx_orders_customer ON orders (customer_id);\nEXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;',
      },
      {
        title: 'Transactions',
        task: 'In one run: start a transaction, cancel order 1, show its status, roll back, show its status again.',
        hint: 'START TRANSACTION; UPDATE ...; SELECT ...; ROLLBACK; SELECT ...;',
        solution: "START TRANSACTION;\nUPDATE orders SET status = 'cancelled' WHERE id = 1;\nSELECT id, status FROM orders WHERE id = 1;\nROLLBACK;\nSELECT id, status FROM orders WHERE id = 1;",
      },
    ],
  },

  mongodb: {
    name: 'MongoDB',
    color: '#13aa52',
    kind: 'mongosh',
    starter: 'db.customers.find({ city: "Hyderabad" }).sort({ signup_date: -1 }).limit(5)',
    tips: ['Type help to see every supported command', 'One command per line; multi-line pipelines are fine inside [ ]', 'Arguments are JSON-style; ISODate("2025-01-31") works'],
    tables: MONGO_TABLES,
    examples: [
      { title: 'Find with filter, sort, limit', code: 'db.customers.find({ city: "Hyderabad" }).sort({ signup_date: -1 }).limit(5)' },
      { title: 'Count by status', code: 'db.orders.aggregate([\n  { $group: { _id: "$status", orders: { $sum: 1 }, avg_total: { $avg: "$total" } } },\n  { $sort: { orders: -1 } }\n])' },
      { title: 'Query inside embedded items', code: 'db.orders.find({ "items.product_id": 7 }, { total: 1, status: 1 }).limit(5)' },
      { title: 'Join with $lookup', code: 'db.orders.aggregate([\n  { $match: { _id: { $lte: 3 } } },\n  { $lookup: { from: "customers", localField: "customer_id", foreignField: "_id", as: "customer" } },\n  { $project: { total: 1, customer: { $first: "$customer.name" } } }\n])' },
      { title: 'Explain a query', code: 'db.orders.explain("executionStats").find({ customer_id: 42 })' },
      { title: 'Collections and help', code: 'show collections\nhelp' },
    ],
    exercises: [
      {
        title: 'Filter and sort',
        task: 'Customers from Hyderabad who signed up after 1 Oct 2024, newest first.',
        hint: 'signup_date is stored as an ISO string, so $gt works on it. Add .sort({ signup_date: -1 }).',
        solution: 'db.customers.find({ city: "Hyderabad", signup_date: { $gt: "2024-10-01" } }).sort({ signup_date: -1 })',
      },
      {
        title: 'Group by month',
        task: 'Revenue per month from delivered orders in 2025.',
        hint: '$match first, then $group on $dateToString of created_at.',
        solution: 'db.orders.aggregate([\n  { $match: { status: "delivered", created_at: { $gte: ISODate("2025-01-01"), $lt: ISODate("2026-01-01") } } },\n  { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$created_at" } }, revenue: { $sum: "$total" } } },\n  { $sort: { _id: 1 } }\n])',
      },
      {
        title: 'Aggregate and join',
        task: 'Top 5 customers by total spend, ignoring cancelled orders. Show the customer name and spend.',
        hint: '$group by customer_id, $sort, $limit 5, then $lookup into customers.',
        solution: 'db.orders.aggregate([\n  { $match: { status: { $ne: "cancelled" } } },\n  { $group: { _id: "$customer_id", spent: { $sum: "$total" } } },\n  { $sort: { spent: -1 } },\n  { $limit: 5 },\n  { $lookup: { from: "customers", localField: "_id", foreignField: "_id", as: "customer" } },\n  { $project: { spent: 1, name: { $first: "$customer.name" } } }\n])',
      },
      {
        title: 'Best seller per category',
        task: 'For each product category, show the product with the most units sold.',
        hint: '$unwind the items, $group by product, $lookup the product, sort by units, then $group by category with $first.',
        solution: 'db.orders.aggregate([\n  { $unwind: "$items" },\n  { $group: { _id: "$items.product_id", units: { $sum: "$items.qty" } } },\n  { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "p" } },\n  { $unwind: "$p" },\n  { $sort: { units: -1 } },\n  { $group: { _id: "$p.category", product: { $first: "$p.name" }, units: { $first: "$units" } } },\n  { $sort: { _id: 1 } }\n])',
      },
      {
        title: 'Make a slow query fast',
        task: 'Explain the query for orders of customer 42, add an index, explain again. What changed (COLLSCAN vs IXSCAN, docs examined)?',
        hint: 'Use .explain("executionStats"), then createIndex on customer_id.',
        solution: 'db.orders.explain("executionStats").find({ customer_id: 42 })\ndb.orders.createIndex({ customer_id: 1 })\ndb.orders.explain("executionStats").find({ customer_id: 42 })',
      },
      {
        title: 'Update and verify',
        task: 'Cancel every pending order created before 1 Mar 2025, then count the cancelled orders.',
        hint: 'updateMany with a filter and $set, then countDocuments.',
        solution: 'db.orders.updateMany({ status: "pending", created_at: { $lt: ISODate("2025-03-01") } }, { $set: { status: "cancelled" } })\ndb.orders.countDocuments({ status: "cancelled" })',
      },
    ],
  },
};
