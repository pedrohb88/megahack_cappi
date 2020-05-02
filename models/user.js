const mongoose = require('mongoose');
const validator = require('validator');

let { VerificationToken } = require('./verificationToken');
const cryptoRandomString = require('crypto-random-string');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

let userSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 1
    },
    email: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        minlength: 1,
        validate: {
            validator: validator.isEmail,
            message: '{VALUE} is not a valid email',
        }
    },
    phone: {
        type: String,
        trim: true,
        //unique: true, dá problema quando tem mais de 1 null
        minlength: 1
    },
    tokens: [{
        access: {
            type: String,
            minlength: 1,
        },
        token: {
            type: String,
            minlength: 1
        }
    }],
    experience: {
        type: Number,
        required: 0,
        min: 0,
    },
    options: [{
        id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        }
    }],
    totalBalance: {
        type: Number,
        required: true,
    }
});

userSchema.statics.sendVerificationToken = function (email) {
    return new Promise((resolve, reject) => {

        VerificationToken.deleteMany({ email: email }).then(() => {
            let code = cryptoRandomString({ length: 8 });

            bcrypt.genSalt(10, (err, salt) => {
                bcrypt.hash(code, salt, (err, hash) => {
                    let token = new VerificationToken({ email, code: hash });

                    token.save();

                    /*//send token code to user email
                    console.log(`sending code ${code} hashed as ${hash} to ${email}
                    `);
                    resolve({
                        success: true,
                        error: 'error'
                    });*/
                    var transporter = nodemailer.createTransport({
                        service: 'gmail',
                        auth: {
                            user: process.env['MAILER_MAIL'],
                            pass: process.env['MAILER_PASS']
                        }
                    });

                    var mailOptions = {
                        from: process.env['MAILER_MAIL'],
                        to: email,
                        subject: `Seu código de verificação da Cappi é ${code}`,
                        text: `Olá! Seu código de verificação da Cappi é: ${code}. Basta enviar esse código pelo whatsapp :)`
                    };

                    transporter.sendMail(mailOptions, function (error, info) {
                        if (error) {
                            console.log(error);
                        } else {
                            console.log('Email sent: ' + info.response);
                        }

                    
                        resolve({
                            success: error ? false:true,
                            error: error
                        });
                    });
                });
            });
        });
    });
}


userSchema.methods.generateAuthToken = function(){
    let user = this;
    let access = 'auth';
    let token = jwt.sign({
        _id: user._id.toHexString(),
        access
    }, process.env.JWT_SECRET).toString();

    user.tokens = user.tokens.concat({access, token});

    //when returning from a then call, it returns a Promise. When returning a value from a then call, it returns a Promise with the value as a param to the next then call
    return user.save().then(() => {
        return token;
    });
};

userSchema.methods.removeToken = function(tokenToRemove){
    let user = this;

    return User.updateOne({
        _id: user._id
    },{
        $pull: {
            tokens: {
                token: tokenToRemove
            }
        }
    });
};

userSchema.statics.findByToken = function(token){
    let User = this; //the model itself, not the instance
    let decoded;

    //if then token wasn't changed, then the token object is returned
    try{
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch(e) {
        /*return new Promise((resolve, reject) => {
            reject();
        });*/
        //same as
        return Promise.reject();
    }

    //returns a Promise with the user as param
    //find the user who matches the id stored in the token, and the user who has this token on the token array
    return User.findOne({
        _id: decoded._id,
        //the token could have been deleted from the database before the request, so it's necessary to check for the token itself.
        'tokens.token': token,
        'tokens.access': 'auth'
    });
};

userSchema.statics.findByPhone = function(phone) {
    let User = this;
    
    return User.findOne({
        phone: phone
    });
}

let User = mongoose.model('User', userSchema);

module.exports = { User };
