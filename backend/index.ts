import { createApp } from './app.js';
import { config } from '../shared/config.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`jobmatch backend listening on http://localhost:${config.port}`);
});
