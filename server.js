require('./config/config');
const {mongoose} = require('./db/mongoose');
const _ = require('lodash');
const uuid = require('uuid').v4;
const xmlparser = require('express-xml-bodyparser');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const webhooks = require('twilio/lib/webhooks/webhooks');
const axios = require('axios');

let {authenticate, authenticateServer} = require('./middleware/authenticate');
let {User} = require('./models/user');
let {Profile} = require('./models/profile');
let {Transaction} = require('./models/transaction');
let {VerificationToken} = require('./models/verificationToken');

const express = require('express');

let app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({extended: false}));

let userStates = {};

const comandos = [
    {num: 1, label: 'out', text: 'Gastei &num&XX,XX&num& com &label&"origem do gasto"&label&', short: '-&num&XX,XX&num&'},
    {num: 2, label: 'in', text: 'Recebi &num&XX,XX&num& de &label&"origem do ganho"&label&', short: '+&num&XX,XX&num&'},
    {num: 3, label: 'balance', text: 'Ver saldo', short: 'saldo'},
];

let comandosString = function(){
    let str = '';
    comandos.forEach((comando) => {
        let text = comando.text
        .split('&num&').join('')
        .split('&label&').join('');

        let short = comando.short
        .split('&num&').join('');

        str += `${comando.num} - ${text} ou ${short}\n`
    });
    return str;
}

let identifyCommand = function(str){
    str = str.trim();
    
    if(str.indexOf('saldo') !== -1){
        return {type: 'balance'};
    }

    let c = str.charAt(0);
    let type = c == '+' || c == '-' ? c : str.split(' ')[0];
    type = type.toLowerCase();

    if(type == 'gastei' || type == '-'){
        t = 'out';

        if(type == 'gastei'){
            value = str.split(' ')[1];
            label = str.split(' ')[3];

            return {type: t, value, label};
        }else {
            value = str.split('-')[1];
            return {type: t, value};
        }

    }
    else if(type == 'recebi' || type == '+'){
        t = 'in';

        if(type == 'recebi'){
            value = str.split(' ')[1];
            label = str.split(' ')[3];

            return {type: t, value, label};
        }else {
            value = str.split('+')[1];
            return {type: t, value};
        }

    } else {

        return {type: 'unidentified'}
    }
}

app.post('/message', (req, res) => {

    let url = 'https' + '://' + req.get('host') + req.originalUrl;
    let params = req.body;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    let signature = webhooks.getExpectedTwilioSignature(authToken, url, params);
    let twilioSignature = req.headers['x-twilio-signature'];
   
    if(signature === twilioSignature) {

        const apiUrl = process.env['API_URL'];
        
        let phone = params.From.split(':')[1];
        console.log(userStates[phone]);

        User.findByPhone(phone).then((user) => {

            //usuário ainda não cadastrado com esse telefone, iniciar processo de cadastro
            if(!user) {

                 //limpa um estado já expirado
                if(userStates[phone]){
                    let currentState = userStates[phone];

                    let currentTime = new Date().getTime();
                    if(currentState && currentTime > currentState.expires){
                        userStates[phone] = null;
                    }
                }

                if(!userStates[phone]){
                    userStates[phone] = {
                        state: 'waitingName',
                        expires: new Date().getTime() + (3600 * 1000)
                    }
                    let response = new MessagingResponse();
                    response.message('Olá! Seja bem vindo(a) ao Cappi, o seu assistente financeiro :)');
                    response.message('Como você se chama?');
                    res.send(response.toString());

                } else if(userStates[phone].state == 'waitingName') {

                    let name = params.Body.trim();
                    userStates[phone] = {
                        state: 'waitingEmail',
                        expires: new Date().getTime() + (3600 * 1000),
                        data: {name}
                    }

                    let response = new MessagingResponse();
                    response.message(`É um prazer te conhecer, ${name} :)`);
                    response.message('Pra gente começar, eu preciso que digite o seu email: ');
                    res.send(response.toString());

                } else if(userStates[phone].state == 'waitingEmail') {
                    let headers = {
                        'x-api-key': process.env['API_KEY'],
                        'x-phone': phone
                    };

                    let email = params.Body.trim();

                    axios.get(`${apiUrl}/bot/user/verification_code/${email}`, {headers})
                        .then((response) => {
                           
                            let msgResponse = new MessagingResponse();
                            if(response.data.success){
                                userStates[phone] = {
                                    state: 'waitingCode',
                                    expires: new Date().getTime() + (3600 * 1000),
                                    data: {
                                        ...userStates[phone].data,
                                        email
                                    }
                                }

                                msgResponse.message(`Certo. Enviei um código pro email: ${email}. Digita ele aqui pra mim, por favor?`);
                                res.send(msgResponse.toString());
                            } else {
                           
                                msgResponse.message(`Algo deu errado ao tentar enviar o código pro seu email :(`);
                                msgResponse.message(`Pode verificar se é um email válido, e digitar aqui novamente, por favor?`);
                                res.send(msgResponse.toString());
                            }
                            
                        }).catch((e) => {
                            console.log(e);
                            res.status(400).send(e.message);
                        });
                } else if(userStates[phone].state == 'waitingCode') {
                    let headers = {
                        'x-api-key': process.env['API_KEY'],
                        'x-phone': phone
                    };

                    let code = params.Body.trim();
                    let data = userStates[phone].data;
                    let userData = {
                        name: data.name,
                        email: data.email,
                        verificationCode: code,
                        phone
                    }
                    axios.post(`${apiUrl}/bot/user`, userData, {headers})
                    .then((response) => {
                        console.log('eh krai');
                        let result = response.data;
                        console.log(result);
                        if(result.success){
                            console.log('entrou');
                            userStates[phone] = {
                                state: 'started',
                                expires: new Date().getTime() + (3600 * 1000),
                            }

                            let msgResponse = new MessagingResponse();
                            msgResponse.message(`Prontinho, agora você já está registrado :)`);
                            msgResponse.message(`Para começar a usar, digite um dos seguintes comandos: \n${comandosString()}`);
                            res.send(msgResponse.toString());
                        } else {
                            res.status(400).send(result.error);
                        }

                    }).catch((e) => {
                        console.log(e);
                        res.status(400).send(e.message);
                    });
                }

            } else {

                let currentState = userStates[user.phone];

                //limpa um estado já expirado
                let currentTime = new Date().getTime();
                if(currentState && currentTime > currentState.expires){
                    userStates[user.phone] = null;
                }
             
                if(currentState && currentState.state == 'started'){
                    let command = identifyCommand(req.body.Body);
                    let commandType = command.type;
                  
                    if(commandType == 'in'){
                        let data = {
                            value: command.value,
                            label: command.label
                        };

                        let headers = {
                            'x-api-key': process.env['API_KEY'],
                            'x-phone': phone
                        }
                        
                        axios.post(`${apiUrl}/transaction/in`, data, {headers})
                        .then((response) => {
                            let data = response.data;
                            const messagingResponse = new MessagingResponse();
                            let message = messagingResponse.message(`Ganho de R$${data.value} registrado com sucesso`);
                            res.send(message.toString());
                        }).catch((e) => {
                            res.status(400).send(e.message);
                        });

                    }else if(commandType == 'out'){

                        let data = {
                            value: command.value,
                            label: command.label
                        };

                        let headers = {
                            'x-api-key': process.env['API_KEY'],
                            'x-phone': phone
                        }
                        
                        axios.post(`${apiUrl}/transaction/out`, data, {headers})
                        .then((response) => {
                            let data = response.data;
                            const messagingResponse = new MessagingResponse();
                            let message = messagingResponse.message(`Gasto de R$${data.value} registrado com sucesso`);
                            res.send(message.toString());
                        }).catch((e) => {
                            res.status(400).send(e.message);
                        });

                    }else if(commandType == 'balance'){

                        let headers = {
                            'x-api-key': process.env['API_KEY'],
                            'x-phone': phone
                        }
                        
                        axios.get(`${apiUrl}/balance`, {headers})
                        .then((response) => {
                            let val = response.data.toString();
                            const messagingResponse = new MessagingResponse();
                            let message = messagingResponse.message(`Seu saldo atual é de: R$${val}`);
                            res.send(message.toString());
                        }).catch((e) => {
                            console.log(e);
                            res.status(400).send(e.message);
                        });
                    } else {
                        const msgResponse = new MessagingResponse();
                        let message = msgResponse.message('Não entendi seu comando :(');
                        res.send(message.toString());
                    }
                } else {
                    userStates[phone] = {
                        state: 'started',
                        expires: new Date().getTime() + (3600 * 1000)
                    }
                    const response = new MessagingResponse();
                    response.message(`Olá, ${user.name}! Como posso te ajudar?`).toString();
                    response.message(`Digite um dos seguintes comandos: \n${comandosString()}`);
                    res.send(response.toString());
                }
            }
        })
        
    }else {
        console.log('assinatura incorreta');
        res.status(401).send('assinatura incorreta');
    }

});

//envia o código de verificação para o email do usuário
app.get('/bot/user/verification_code/:email', authenticateServer, async (req, res) => {
    let email = req.params.email;
    
    let result = await User.sendVerificationToken(email);
    res.send(result);
});

//verifica o código de verificação e cadastra o usuário
app.post('/bot/user', authenticateServer, (req, res) => {
    let body = _.pick(req.body, ['name', 'email', 'phone']);
   
    let verificationToken = new VerificationToken({
        email: body.email,
        code: req.body.verificationCode,
    });

    User.findOne({email: body.email}).then(async (u) => {
        if(u){
            res.status(400).send({
                success: false,
                error: 'Email já cadastrado'
            })
            return;
        }

        let validCode = await verificationToken.isValid();
  
        if(validCode){
            let defaultXp = 0;

            body['experience'] = defaultXp;
            body['totalBalance'] = req.body.totalBalance ? req.body.totalBalance : 0.0;

            body['options'] = await Profile.getOptionsByXp(defaultXp);

            let newUser = new User(body);
            newUser.save().then((user) => {
                res.send({
                    success: true,
                    data: user
                });
            }).catch((e) => {
                res.status(400).send(e);
            });

        
        }else{
            res.status(401).send('Código inválido');
        } 
    })
});

app.get('/user/verification_code/:email', async (req, res) => {
    let email = req.params.email;
    
    let result = await User.sendVerificationToken(email);
    result['alreadyRegistered'] = await User.isRegistered(email);
    res.send(result);
});

app.post('/user', (req, res) => {
    let body = _.pick(req.body, ['name', 'email']);
   
    let verificationToken = new VerificationToken({
        email: body.email,
        code: req.body.verificationCode,
    });

    User.findOne({email: body.email}).then(async (u) => {
        if(u){
            res.status(400).send({
                success: false,
                error: 'Email já cadastrado'
            })
            return;
        }

        let validCode = await verificationToken.isValid();
  
        if(validCode){
            let defaultXp = 0;

            body['experience'] = defaultXp;
            body['totalBalance'] = req.body.totalBalance ? req.body.totalBalance : 0.0;

            body['options'] = await Profile.getOptionsByXp(defaultXp);

            let newUser = new User(body);

            newUser.save().then(async (user) => {

                if(user){
                    let token = await user.generateAuthToken();
                    res.header('x-auth', token).send({success: true, data: user});
                }else {
                    res.send({success: false})
                }
            }).catch((e) => {
                res.status(400).send(e);
            });

        
        }else{
            res.status(401).send('Código inválido');
        } 
    })
})

app.post('/users/login', (req, res) => {
    let body = _.pick(req.body, ['email', 'verificationCode']);
   
    let verificationToken = new VerificationToken({
        email: body.email,
        code: req.body.verificationCode,
    });

    User.findOne({email: body.email}).then(async (user) => {

        if(!user){
            res.status(401).send('Email inválido');
            return;
        }
        
        let validCode = await verificationToken.isValid();
  
        if(validCode){
           
            user.generateAuthToken().then((token) => {
                res.header('x-auth', token).send(user);
            });
        }else{
            res.status(401).send('Código inválido');
        } 
    })
});

app.get('/balance', authenticate, (req, res) => {
    res.send(''+req.user.totalBalance);
});

app.post('/transaction/:type', authenticate, (req, res) => {
    let type = req.params.type;

    let body = _.pick(req.body, ['value', 'label', 'description', 'category']);
    body['type'] = type;
    body['userId'] = req.user._id;

    let newTransaction = new Transaction(body);
    newTransaction.save().then((t) => {
        
        User.findOne({email: req.user.email}).then((u) => {
            if(type == 'in'){
                u.totalBalance += t.value;
            } else if(type == 'out'){
                u.totalBalance -= t.value;
            }
            u.save().then((updatedUser) => {
                res.send(t);
            }).catch((e) => {
                console.log(e);
            });
        });

    }).catch((e) => {
        res.status(400).send(e);
    });
});

app.get('/transaction', authenticate, async (req, res) => {

    let user = req.user;
    let transactions = await Transaction.getAllByUserId(user._id);
    res.send(transactions);
});


app.listen(port, () => {
    console.log(`server running on port ${port}`);
});