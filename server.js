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
    {label: 'out', text: 'Digite *-XX,XX* para adicionar um gasto. Exemplo: -50,00'},
    {label: 'in', text: 'Digite *+XX,XX* para adicionar um ganho. Exemplo +45,50'},
    {label: 'balance', text: 'Digite *saldo* para ver seu saldo atual'},
    {label: 'transactions', text: 'Digite *extrato* para ver seu histórico de ganhos e gastos'},
    //{label: 'transactionsLimited', text: 'Digite *extrato X* pra ver seu histórico nos últimos X dias. Exemplo: extrato 5'},
    //{label: 'undoLast', text: 'Digite *desfazer* para cancelar a última ação'},
    //'{label: 'tips', text: 'Digite *dicas* para receber dicas do Cappi'},
    {label: 'help',text: 'Digite *ajuda* para receber a lista de comandos'}
];

let comandosString = function(){
    let str = '';
    comandos.forEach((comando) => {
        str += `- ${comando.text}\n`;
    });

    str += '\n_Obs: Para adicionar uma descrição ao gasto ou receita, digite-a após o valor. Exemplo: -50,00 compras da semana_';
    return str;
}

let identifyCommand = function(str){
    
    str = str.trim().toLowerCase();

    switch(str){
        case 'saldo':
            return {type: 'balance'};
            break;
        case 'extrato':
            return {type: 'transactions'};
            break;
        case 'ajuda':
            return {type: 'help'};
            break;
        default:
            break;
    }

    let firstChar = str.charAt(0);
    if(firstChar == '+' || firstChar == '-'){

        str = str.replace(',', '.');

        if(firstChar == '+'){
            let value = str.split('+')[1].split(' ')[0];
            let label = str.split(' ').slice(1).join(' ');
            return {type: 'in', value, label};
        } else {
            let value = str.split('-')[1].split(' ')[0];
            let label = str.split(' ').slice(1).join(' ');
            return {type: 'out', value, label};
        }
    }

    return {type: 'unidentified'};
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
                            let msgResponse = new MessagingResponse();
                            msgResponse.message(`Houve algum erro com o código informado :( Pode conferir e digitar novamente, por favor?`);
                            res.send(msgResponse.toString());
                        }

                    }).catch((e) => {
                        console.log(e);
                        let msgResponse = new MessagingResponse();
                        msgResponse.message(`Houve algum erro com o código informado :( Pode conferir e digitar novamente, por favor?`);
                        res.send(msgResponse.toString());
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

                    console.log(command);
                  
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
                    }else if(commandType == 'transactions') {
                        let headers = {
                            'x-api-key': process.env['API_KEY'],
                            'x-phone': phone
                        }
                        
                        axios.get(`${apiUrl}/transaction`, {headers})
                        .then((response) => {
                            let transactions = response.data;
                            let transactionsStr = 'Extrato vazio';

                           
                            if(transactions.length > 0){
                                let totalValue = 0.0;
                                transactionsStr = 'Extrato: \n\n';
                                let i = 0;
                                transactions.forEach((t) => {
                                    
                                    if(t.type == 'in') totalValue += t.value;
                                    else if(t.type == 'out') totalValue -= t.value;

                                    i++;
                                    let desc = t.label != '' ? ` --- Descrição: ${t.label}` : '';
                                    let s = t.type == 'out' ? '-':'';

                                    let date = new Date(t.createdAt).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"});
                                    let year = date.split('/')[2].split(',')[0];

                                    let addZero = (str) => {
                                        return parseInt(str) < 10 ? '0'+str:str;
                                    };
                                    console.log(date);
                                    let month = addZero(date.split('/')[0]);
                                    let day = addZero(date.split('/')[1]);

                                    let dateStr = `${day}/${month}/${year}`;

                                    transactionsStr += `${i}. Valor: ${s}R$${t.value} --- Data: ${dateStr}${desc}\n`;
                                });

                                let s = totalValue < 0 ? '-' : '';
                                transactionsStr += `\nSaldo atual: ${s}R$${totalValue}`;
                            }

                            const messagingResponse = new MessagingResponse();
                            let message = messagingResponse.message(transactionsStr);
                            res.send(message.toString());
                        }).catch((e) => {
                            console.log(e);
                            res.status(400).send(e.message);
                        });
                    }else if(commandType == 'help'){

                  
                        const messagingResponse = new MessagingResponse();
                        let message = messagingResponse.message(`Lista de comandos: \n${comandosString()}`);
                        res.send(message.toString());
                    }
                    else {
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


app.get('/user', authenticate, (req, res) => {

    User.findByToken(req.header('x-auth')).then((user) => {

        if(!user) res.status(401).send();
        else {

            res.send(user);
        }
    }).catch((e) => {
        console.log(e);
        res.status(400).send(e);
    });
});

app.get('/balance', authenticate, (req, res) => {
    res.send(''+req.user.totalBalance);
});

app.post('/transaction/:type', authenticate, (req, res) => {
    let type = req.params.type;

    let body = _.pick(req.body, ['value', 'label', 'description', 'category', 'createdAt']);
    body['type'] = type;
    body['userId'] = req.user._id;
    console.log('entrou na rota');
    let newTransaction = new Transaction(body);
    newTransaction.save().then((t) => {
        console.log('salvou a transação');
        
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
                res.status(400).send();
            });
        });

    }).catch((e) => {
        console.log(e);
        res.status(400).send(e);
    });
});

app.get('/transaction', authenticate, async (req, res) => {

    let user = req.user;
    let transactions = await Transaction.getAllByUserId(user._id);
    res.send(transactions);
});

app.post('/user/verifyCode', async (req, res) => {
    let body = _.pick(req.body, ['email', 'verificationCode']);
   
    let verificationToken = new VerificationToken({
        email: body.email,
        code: req.body.verificationCode,
    });

    let validCode = await verificationToken.isValid();
    if(validCode) res.status(200).send();
    else res.status(401).send();
})


app.listen(port, () => {
    console.log(`server running on port ${port}`);
});