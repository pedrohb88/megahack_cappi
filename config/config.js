const crypto = require('crypto');

let env = process.env.NODE_ENV || 'development';

if(env === 'development' || env === 'test'){
    let config = require('./config.json'); //automatically parses json
    let envConfig = config[env];

    Object.keys(envConfig).forEach((value) => {
        process.env[value] = envConfig[value];
    });
}


process.env['API_KEY_HASH'] = crypto
  .createHash("sha256")
  .update(Buffer.from(process.env['API_KEY'], 'utf-8'))
  .digest("base64");

