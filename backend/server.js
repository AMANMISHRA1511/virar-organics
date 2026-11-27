import { createServer } from 'node:http';
import { BRAND_NAME } from './src/branding.js';
import { config, validateConfig } from './src/config.js';
import { createApp } from './src/app.js';
import { db } from './src/db.js';
import { connectRedis, initSockets, closeInfra } from './src/infra.js';
import { verifySession, validCsrf } from './src/auth.js';
import { startNotifications, closeNotifications } from './src/notifications.js';
validateConfig();const [migrations]=await db.query('SELECT version FROM schema_migrations WHERE version=7');if(!migrations.length)throw new Error('Database migration v7 is required. Run npm run migrate before starting.');await connectRedis();
const app=await createApp(),server=createServer(app);await initSockets(server,verifySession,validCsrf);startNotifications();
server.requestTimeout=30000;server.headersTimeout=15000;server.listen(config.port,config.host,()=>console.log(JSON.stringify({level:'info',message:BRAND_NAME+' API ready',host:config.host,port:config.port,payment:config.paymentMode,notifications:config.notificationMode})));
let closing=false;async function shutdown(){if(closing)return;closing=true;const timeout=setTimeout(()=>process.exit(1),15000);timeout.unref();await closeNotifications();await closeInfra();await new Promise(resolve=>server.close(resolve));await db.end();clearTimeout(timeout);process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
