'use strict';
const { setGlobalOptions } = require('firebase-functions/v2');

// Keep in sync with the region used by the clients (getFunctions(app, 'asia-southeast1')).
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });

Object.assign(exports, require('./src/twofa'), require('./src/students'), require('./src/counselors'));
