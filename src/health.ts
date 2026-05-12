// Docker HEALTHCHECK entry point — exits 0 if config loads cleanly.
import { loadConfig } from './config/env.js';
try {
  loadConfig();
  process.exit(0);
} catch {
  process.exit(1);
}
