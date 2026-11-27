import { validateConfig } from './src/config.js';
import { db } from './src/db.js';
import { connectRedis, closeInfra } from './src/infra.js';
import { startNotifications, closeNotifications } from './src/notifications.js';
validateConfig();await db.query('SELECT 1');await connectRedis();startNotifications({runWorker:true});console.log('Notification worker running. Simulated mode never sends real messages.');
let closing=false;async function stop(){if(closing)return;closing=true;await closeNotifications();await closeInfra();await db.end();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
