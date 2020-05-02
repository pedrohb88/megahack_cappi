let {User} = require('./../models/user');
const crypto = require('crypto');

let authenticate = (req, res, next) => {

    if(req.header('x-auth')){
        let token = req.header('x-auth');

        User.findByToken(token).then((user) => {
            //if it is a valid token, but for some reason it can't find the corresponding user
            if(!user)
                return Promise.reject();
            
            req.user = user;
            req.token = token;
            next();
        }).catch((e) => {
            res.status(401).send();
        });

    } else {
        let apiKey = req.headers['x-api-key'] ? req.headers['x-api-key'] : '';

        let hash = crypto
        .createHash("sha256")
        .update(Buffer.from(apiKey, 'utf-8'))
        .digest("base64");

        try{
            if(hash === process.env['API_KEY_HASH']) {
        
                User.findByPhone(req.header('x-phone')).then((user) => {
                    if(!user) throw new Error('authentication error');
                    req.user = user;
                    next();
                }).catch((e) => {
                    res.status(401).send(e.message);
                });
            
            } else throw new Error('authentication error');
        } catch(e) {
            res.status(401).send(e.message);
        }

    }
}

let authenticateServer = (req, res, next) => {
    let apiKey = req.headers['x-api-key'] ? req.headers['x-api-key'] : '';

    let hash = crypto
    .createHash("sha256")
    .update(Buffer.from(apiKey, 'utf-8'))
    .digest("base64");

    try{
        if(hash === process.env['API_KEY_HASH']) {
            next();
        } else throw new Error('authentication error');
    } catch(e) {
        res.status(401).send(e.message);
    }
}

module.exports = {authenticate, authenticateServer};