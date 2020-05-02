const mongoose = require('mongoose');
//sets the promise library of mongoose
mongoose.Promise = global.Promise;

//does not receive any callback, but behind the scenes, mongoose always wait to connect before doing any action
//mongoose connect promise error handler does not work
mongoose.connect(process.env.MONGODB_URI, {useNewUrlParser:true,  useUnifiedTopology: true}, (err) => {
    if(err)
        console.log(`error connecting to ${process.env.MONGODB_URI}`);
});

module.exports = {mongoose}

