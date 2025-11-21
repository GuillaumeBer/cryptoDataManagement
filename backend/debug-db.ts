import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  console.log('Connecting to:', process.env.DATABASE_URL);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('Connected!');
    const res = await client.query('SELECT NOW()');
    console.log('Time:', res.rows[0]);
    await client.end();
  } catch (err) {
    console.error('Connection error:', err);
  }
}

main();
