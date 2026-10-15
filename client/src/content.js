// All learning content lives here. Add or edit lessons and the app picks them up.
// lesson: { id, title, analogy, points: [], lang, code }

export const DBS = [
  {
    key: 'postgresql',
    name: 'PostgreSQL',
    color: '#336791',
    blurb: 'Open-source relational database: MVCC, WAL, rich SQL and extensions. Also the engine behind Aurora PostgreSQL.',
    lessons: [
      {
        id: 'pg-architecture',
        title: 'Architecture: processes, memory, WAL, MVCC',
        analogy: 'A restaurant: the postmaster is the manager, each connection gets its own waiter (backend process), shared_buffers is the kitchen counter, and the WAL is the order book written before any dish is cooked.',
        points: [
          'One OS process per connection, so use a pooler (PgBouncer, RDS Proxy) at scale.',
          'shared_buffers caches pages; WAL records every change before it hits data files.',
          'MVCC: updates create new row versions; old ones are cleaned by VACUUM.',
          'Background processes: checkpointer, background writer, WAL writer, autovacuum launcher.',
        ],
        lang: 'sql',
        code: `SHOW shared_buffers;
SELECT pid, usename, state, query FROM pg_stat_activity;
SELECT pg_current_wal_lsn();`,
      },
      {
        id: 'pg-config',
        title: 'Configuration: postgresql.conf and pg_hba.conf',
        analogy: 'postgresql.conf is the house rules; pg_hba.conf is the security guard checking who may enter from where.',
        points: [
          'Key memory settings: shared_buffers, work_mem, maintenance_work_mem, effective_cache_size.',
          'pg_hba.conf is read top to bottom, first match wins.',
          'Reload with pg_reload_conf(); some settings need a restart (check pending_restart).',
          'On Aurora/RDS use parameter groups instead of editing files.',
        ],
        lang: 'sql',
        code: `ALTER SYSTEM SET work_mem = '64MB';
SELECT pg_reload_conf();
SELECT name, setting, pending_restart FROM pg_settings WHERE pending_restart;`,
      },
      {
        id: 'pg-security',
        title: 'Roles, privileges and security',
        analogy: 'Roles are staff badges. Groups are badge templates, and GRANT decides which doors each badge opens.',
        points: [
          'Users and groups are both roles; LOGIN makes a role a user.',
          'Grant to group roles, then add people to the group.',
          'Use ALTER DEFAULT PRIVILEGES so new tables are covered.',
          'Enforce TLS and scram-sha-256; never use trust over the network.',
        ],
        lang: 'sql',
        code: `CREATE ROLE app_ro NOLOGIN;
GRANT USAGE ON SCHEMA public TO app_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_ro;
CREATE ROLE alice LOGIN PASSWORD 'change-me' IN ROLE app_ro;`,
      },
      {
        id: 'pg-backup',
        title: 'Backup, restore and PITR',
        analogy: 'pg_dump is photocopying chapters of a book; a base backup plus archived WAL is a full photo of the library plus a CCTV recording you can rewind to any minute.',
        points: [
          'Logical: pg_dump / pg_restore (portable, per database).',
          'Physical: pg_basebackup or pgBackRest (whole cluster, fast restore).',
          'PITR needs a base backup plus continuous WAL archiving.',
          'On Aurora: automated backups and cluster restore to a point in time.',
        ],
        lang: 'bash',
        code: `pg_dump -Fc -d mydb -f mydb.dump
pg_restore -d mydb_new -j 4 mydb.dump
pg_basebackup -D /backup/base -Ft -z -P`,
      },
      {
        id: 'pg-replication',
        title: 'Replication and high availability',
        analogy: 'A primary is the lead writer; streaming replicas are scribes copying the order book line by line, ready to take over if the writer leaves.',
        points: [
          'Streaming replication ships WAL; synchronous mode trades latency for zero data loss.',
          'Logical replication replicates selected tables (upgrades, migrations).',
          'Failover tools: Patroni, repmgr; on AWS use Aurora or RDS Multi-AZ.',
          'Monitor replay lag from pg_stat_replication.',
        ],
        lang: 'sql',
        code: `SELECT client_addr, state, sent_lsn, replay_lsn,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes
FROM pg_stat_replication;`,
      },
      {
        id: 'pg-performance',
        title: 'Performance tuning',
        analogy: 'EXPLAIN is the GPS route preview; pg_stat_statements is the trip log showing which routes burn the most fuel.',
        points: [
          'Start with pg_stat_statements to find the top queries by total time.',
          'Read EXPLAIN (ANALYZE, BUFFERS): compare estimated vs actual rows.',
          'Index for the filter and join columns; consider partial and covering indexes.',
          'Keep statistics fresh with ANALYZE.',
        ],
        lang: 'sql',
        code: `SELECT query, calls, total_exec_time, mean_exec_time
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;

EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE customer_id = 42;`,
      },
      {
        id: 'pg-vacuum',
        title: 'VACUUM, bloat and maintenance',
        analogy: 'MVCC leaves old paper copies on the desk; VACUUM is the cleaner who removes them so the desk does not overflow.',
        points: [
          'Autovacuum should stay ON; tune per table for hot tables.',
          'Dead tuples and bloat slow scans and waste disk.',
          'Transaction ID wraparound is the one failure to never ignore.',
          'REINDEX CONCURRENTLY and pg_repack fix bloat with little locking.',
        ],
        lang: 'sql',
        code: `SELECT relname, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;

ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02);
VACUUM (VERBOSE, ANALYZE) orders;`,
      },
    ],
  },
  {
    key: 'mysql',
    name: 'MySQL',
    color: '#00758f',
    blurb: 'The most widely deployed open-source relational database. InnoDB, binlog replication and a huge ecosystem.',
    lessons: [
      {
        id: 'my-architecture',
        title: 'Architecture: InnoDB, buffer pool, redo, undo, binlog',
        analogy: 'Same restaurant as PostgreSQL, but threads instead of processes. The buffer pool is the counter, the redo log is the order book, undo is the eraser, and the binlog is the copy sent to branches.',
        points: [
          'One thread per connection, with a pluggable storage engine layer; InnoDB is the default.',
          'Buffer pool caches data and index pages (often 60-75% of RAM on a dedicated server).',
          'Redo log gives crash recovery; undo log gives rollback and MVCC.',
          'Binary log (binlog) drives replication and point-in-time recovery.',
        ],
        lang: 'sql',
        code: `SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
SHOW ENGINE INNODB STATUS\\G
SHOW BINARY LOGS;`,
      },
      {
        id: 'my-config',
        title: 'Configuration: my.cnf and variables',
        analogy: 'my.cnf is the settings file read at startup; SET GLOBAL is changing a setting while the shop is open.',
        points: [
          'Key settings: innodb_buffer_pool_size, innodb_log_file_size, max_connections, sync_binlog.',
          'SET PERSIST (8.0+) saves runtime changes across restarts.',
          'Set character set to utf8mb4 everywhere.',
          'On RDS/Aurora MySQL use parameter groups.',
        ],
        lang: 'sql',
        code: `SET PERSIST max_connections = 500;
SHOW VARIABLES LIKE 'character_set%';
SELECT @@version, @@sql_mode;`,
      },
      {
        id: 'my-security',
        title: 'Users, privileges and security',
        analogy: 'In MySQL the badge includes where you come from: user@host. alice@10.0.% and alice@localhost are two different people.',
        points: [
          'Accounts are user@host pairs; always scope the host.',
          'Roles exist from 8.0: create a role, grant to it, assign it.',
          'Default auth is caching_sha2_password in 8.0.',
          'Require TLS and remove anonymous or test accounts.',
        ],
        lang: 'sql',
        code: `CREATE ROLE 'app_ro';
GRANT SELECT ON shop.* TO 'app_ro';
CREATE USER 'alice'@'10.0.%' IDENTIFIED BY 'change-me' REQUIRE SSL;
GRANT 'app_ro' TO 'alice'@'10.0.%';
SET DEFAULT ROLE 'app_ro' TO 'alice'@'10.0.%';`,
      },
      {
        id: 'my-backup',
        title: 'Backup, restore and PITR',
        analogy: 'mysqldump rewrites the whole book as instructions; XtraBackup copies the pages directly; binlogs let you replay changes up to the exact minute.',
        points: [
          'Logical: mysqldump / mysqlpump / MySQL Shell dump utilities.',
          'Physical hot backup: Percona XtraBackup (or MySQL Enterprise Backup).',
          'PITR = restore full backup, then replay binlogs with mysqlbinlog.',
          'Use --single-transaction for consistent InnoDB dumps without locking.',
        ],
        lang: 'bash',
        code: `mysqldump --single-transaction --routines --triggers -u root -p shop > shop.sql
mysql -u root -p shop_new < shop.sql
mysqlbinlog --start-datetime="2026-10-10 10:00:00" binlog.000123 | mysql -u root -p`,
      },
      {
        id: 'my-replication',
        title: 'Replication and high availability',
        analogy: 'The primary writes, replicas read the binlog like a transcript and replay it. GTIDs number each transaction so everyone agrees where they are.',
        points: [
          'Use GTID-based asynchronous replication as the baseline.',
          'Semi-sync reduces data-loss risk; Group Replication / InnoDB Cluster gives automatic failover.',
          'Replicas can lag: watch Seconds_Behind_Source and replication worker status.',
          'On AWS use Aurora MySQL or RDS Multi-AZ.',
        ],
        lang: 'sql',
        code: `CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='10.0.0.10', SOURCE_USER='repl', SOURCE_PASSWORD='***',
  SOURCE_AUTO_POSITION=1;
START REPLICA;
SHOW REPLICA STATUS\\G`,
      },
      {
        id: 'my-performance',
        title: 'Performance tuning',
        analogy: 'The slow query log is the complaints box; EXPLAIN is the route preview; performance_schema is the CCTV of everything the server does.',
        points: [
          'Turn on the slow query log and review with pt-query-digest.',
          'EXPLAIN ANALYZE (8.0.18+) shows real timings.',
          'Composite index order matters: equality columns first, then range.',
          'Check the buffer pool hit ratio and avoid SELECT * on wide tables.',
        ],
        lang: 'sql',
        code: `SET GLOBAL slow_query_log = 1;
SET GLOBAL long_query_time = 1;
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;
SELECT * FROM sys.statement_analysis ORDER BY total_latency DESC LIMIT 10;`,
      },
      {
        id: 'my-maintenance',
        title: 'Maintenance and online schema changes',
        analogy: 'ANALYZE refreshes the shop inventory list the planner relies on; online DDL is rearranging shelves while customers keep shopping.',
        points: [
          'ANALYZE TABLE updates statistics; OPTIMIZE TABLE rebuilds and reclaims space.',
          'InnoDB online DDL supports many ALTERs with ALGORITHM=INPLACE or INSTANT.',
          'For huge tables use gh-ost or pt-online-schema-change.',
          'Watch long transactions: they hold undo and block purge.',
        ],
        lang: 'sql',
        code: `ALTER TABLE orders ADD COLUMN note VARCHAR(200), ALGORITHM=INSTANT;
ANALYZE TABLE orders;
SELECT trx_id, trx_started, trx_query FROM information_schema.innodb_trx;`,
      },
    ],
  },
  {
    key: 'mongodb',
    name: 'MongoDB',
    color: '#13aa52',
    blurb: 'Document database with flexible schema, replica sets and sharding for horizontal scale.',
    lessons: [
      {
        id: 'mo-architecture',
        title: 'Architecture: documents, WiredTiger, journal',
        analogy: 'Instead of rows in a spreadsheet, each record is a folder with its own nested papers (a JSON-like document). WiredTiger is the filing cabinet, the journal is the receipt book.',
        points: [
          'Data is BSON documents grouped in collections inside databases.',
          'WiredTiger engine: document-level concurrency, compression, cache (default ~50% of RAM).',
          'Journal plus checkpoints provide durability.',
          'No fixed schema, but you still design one around your queries.',
        ],
        lang: 'javascript',
        code: `db.serverStatus().wiredTiger.cache
db.stats()
db.orders.insertOne({ customer: "Asha", items: [{ sku: "A1", qty: 2 }] })`,
      },
      {
        id: 'mo-crud',
        title: 'CRUD and schema design',
        analogy: 'Embed what you read together (an order with its items in one folder); reference what is shared and large (customers) like a library card number.',
        points: [
          'Design for access patterns: embed for one-to-few, reference for one-to-many/unbounded.',
          'Updates use operators: $set, $inc, $push.',
          'Aggregation pipeline replaces most joins ($match, $group, $lookup).',
          'Documents max 16 MB; avoid unbounded arrays.',
        ],
        lang: 'javascript',
        code: `db.orders.find({ "items.sku": "A1" }).limit(5)
db.orders.updateOne({ _id: id }, { $inc: { total: 100 }, $push: { items: { sku: "B2", qty: 1 } } })
db.orders.aggregate([{ $match: { status: "paid" } }, { $group: { _id: "$customer", spent: { $sum: "$total" } } }])`,
      },
      {
        id: 'mo-security',
        title: 'Authentication, roles and security',
        analogy: 'Role-based badges again, but a role is a list of allowed actions on named databases or collections.',
        points: [
          'Enable authorization (security.authorization: enabled) and keystore/TLS.',
          'Built-in roles: read, readWrite, dbAdmin, clusterAdmin, backup.',
          'Create the first admin before enabling auth, then least-privilege app users.',
          'Bind to private IPs only and use a firewall; never expose 27017 publicly.',
        ],
        lang: 'javascript',
        code: `use admin
db.createUser({ user: "appuser", pwd: passwordPrompt(), roles: [{ role: "readWrite", db: "shop" }] })
db.getUsers()`,
      },
      {
        id: 'mo-backup',
        title: 'Backup and restore',
        analogy: 'mongodump is a paper copy of your folders; a filesystem snapshot is a photo of the entire cabinet; the oplog is the diary for point-in-time.',
        points: [
          'mongodump / mongorestore for small to medium data.',
          'Filesystem or cloud snapshots for large data (with journaling on the same volume).',
          'PITR uses snapshots plus the oplog (Ops Manager, Cloud Manager or Atlas).',
          'Always test a restore, not just the backup.',
        ],
        lang: 'bash',
        code: `mongodump --uri="mongodb://localhost:27017/shop" --gzip --out=/backup/shop
mongorestore --uri="mongodb://localhost:27017" --gzip /backup/shop`,
      },
      {
        id: 'mo-replication',
        title: 'Replica sets and sharding',
        analogy: 'A replica set is a primary plus copying secondaries that vote for a new leader if the primary goes down. Sharding splits the library across several buildings by a shard key.',
        points: [
          'Replica set: 3+ members (odd number) for automatic failover and elections.',
          'Read preference and write concern tune consistency vs latency.',
          'Sharding: mongos routers, config servers and shards; choosing the shard key is the critical decision.',
          'Monitor oplog window and replication lag.',
        ],
        lang: 'javascript',
        code: `rs.status()
rs.printReplicationInfo()
sh.enableSharding("shop")
sh.shardCollection("shop.orders", { customerId: "hashed" })`,
      },
      {
        id: 'mo-performance',
        title: 'Indexes and performance',
        analogy: 'Without an index MongoDB reads every folder (COLLSCAN); an index is the label system that jumps straight to the right one (IXSCAN).',
        points: [
          'Check explain("executionStats"): look for COLLSCAN and docsExamined vs nReturned.',
          'Compound index order follows the ESR rule: Equality, Sort, Range.',
          'Use the profiler or slow query log to find slow operations.',
          'Working set should fit in RAM.',
        ],
        lang: 'javascript',
        code: `db.orders.createIndex({ customerId: 1, createdAt: -1 })
db.orders.find({ customerId: 42 }).sort({ createdAt: -1 }).explain("executionStats")
db.setProfilingLevel(1, { slowms: 100 })`,
      },
      {
        id: 'mo-monitoring',
        title: 'Monitoring and maintenance',
        analogy: 'serverStatus is the dashboard of your car: connections, memory, opcounters, and cache pressure.',
        points: [
          'Watch connections, opcounters, cache dirty %, page faults and queues.',
          'currentOp and killOp find and stop runaway operations.',
          'Rolling maintenance: step down the primary, upgrade secondaries first.',
          'Use TTL indexes to expire old data automatically.',
        ],
        lang: 'javascript',
        code: `db.serverStatus().connections
db.currentOp({ secs_running: { $gt: 5 } })
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })`,
      },
    ],
  },
];

export const ALL_LESSONS = DBS.flatMap(d => d.lessons.map(l => ({ ...l, db: d.key })));

// Same task, three databases
export const COMPARE = [
  {
    task: 'Connect from the command line',
    postgresql: 'psql -h host -U user -d db',
    mysql: 'mysql -h host -u user -p db',
    mongodb: 'mongosh "mongodb://host:27017/db" -u user',
  },
  {
    task: 'List databases',
    postgresql: '\\l   or   SELECT datname FROM pg_database;',
    mysql: 'SHOW DATABASES;',
    mongodb: 'show dbs',
  },
  {
    task: 'List tables / collections',
    postgresql: '\\dt',
    mysql: 'SHOW TABLES;',
    mongodb: 'show collections',
  },
  {
    task: 'Create a user',
    postgresql: "CREATE ROLE alice LOGIN PASSWORD '...';",
    mysql: "CREATE USER 'alice'@'%' IDENTIFIED BY '...';",
    mongodb: 'db.createUser({user:"alice", pwd:"...", roles:["readWrite"]})',
  },
  {
    task: 'See running sessions',
    postgresql: 'SELECT * FROM pg_stat_activity;',
    mysql: 'SHOW FULL PROCESSLIST;',
    mongodb: 'db.currentOp()',
  },
  {
    task: 'Kill a session',
    postgresql: 'SELECT pg_terminate_backend(pid);',
    mysql: 'KILL <id>;',
    mongodb: 'db.killOp(<opid>)',
  },
  {
    task: 'Logical backup',
    postgresql: 'pg_dump -Fc db > db.dump',
    mysql: 'mysqldump --single-transaction db > db.sql',
    mongodb: 'mongodump --db db --gzip',
  },
  {
    task: 'Physical backup',
    postgresql: 'pg_basebackup / pgBackRest',
    mysql: 'Percona XtraBackup',
    mongodb: 'Filesystem snapshot / Ops Manager',
  },
  {
    task: 'Point-in-time recovery uses',
    postgresql: 'Base backup + archived WAL',
    mysql: 'Full backup + binlogs',
    mongodb: 'Snapshot + oplog',
  },
  {
    task: 'Crash recovery log',
    postgresql: 'WAL',
    mysql: 'InnoDB redo log',
    mongodb: 'Journal',
  },
  {
    task: 'Replication model',
    postgresql: 'Streaming (physical) or logical',
    mysql: 'Binlog (async/semi-sync), Group Replication',
    mongodb: 'Replica set (oplog)',
  },
  {
    task: 'Explain a query',
    postgresql: 'EXPLAIN (ANALYZE, BUFFERS) ...',
    mysql: 'EXPLAIN ANALYZE ...',
    mongodb: 'db.col.find(...).explain("executionStats")',
  },
  {
    task: 'Create an index',
    postgresql: 'CREATE INDEX CONCURRENTLY ON t (col);',
    mysql: 'CREATE INDEX idx ON t (col);',
    mongodb: 'db.col.createIndex({col: 1})',
  },
  {
    task: 'Slow query source',
    postgresql: 'pg_stat_statements',
    mysql: 'Slow query log / performance_schema',
    mongodb: 'Profiler (system.profile)',
  },
  {
    task: 'Cleanup of old data versions',
    postgresql: 'VACUUM / autovacuum',
    mysql: 'Undo purge (automatic)',
    mongodb: 'WiredTiger handles it (compact rarely)',
  },
  {
    task: 'Scale reads / writes',
    postgresql: 'Read replicas; partitioning; Citus for sharding',
    mysql: 'Read replicas; partitioning; Vitess for sharding',
    mongodb: 'Secondaries; native sharding',
  },
  {
    task: 'Managed AWS service',
    postgresql: 'RDS PostgreSQL / Aurora PostgreSQL',
    mysql: 'RDS MySQL / Aurora MySQL',
    mongodb: 'DocumentDB (compatible) or Atlas',
  },
];
