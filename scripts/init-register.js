'use strict';
require('dotenv').config();
const { updateRegister } = require('../src/register');

updateRegister()
  .then(r => { console.log(`Register loaded: ${r.total} organisations, ${r.skilledWorker} hold a Skilled Worker licence.`); process.exit(0); })
  .catch(e => { console.error('Register update failed:', e.message); console.error('Tip: download the CSV manually from gov.uk and set REGISTER_CSV=/path/to/file.csv'); process.exit(1); });
