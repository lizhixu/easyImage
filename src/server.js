import 'dotenv/config';
import app from './app.js';

const startPort = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function listen(port, attemptsLeft = 10) {
  const server = app.listen(port, () => {
    console.log(`Node EasyImage listening on http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && !isProduction && attemptsLeft > 0) {
      console.warn(`Port ${port} is in use, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(error);
    process.exit(1);
  });
}

listen(startPort);
