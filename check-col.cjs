const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query(`SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='midtrans_transaction_id'`)
  .then(r => { console.log('Column exists:', r.rows.length > 0); p.end(); })
  .catch(e => { console.error(e.message); p.end(); });
