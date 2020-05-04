const mongoose = require('mongoose');

let schema = new mongoose.Schema({
    value: {
        type: Number,
        required: true,
        min: 0,
    }, 
    type: {
        type: String,
        required: true
    }, 
    label: String, 
    description: String, 
    category: String,  
    userId: {
        type: mongoose.Types.ObjectId,
        required: true 
    },
    createdAt: { type: Date, default: Date.now }
});

schema.statics.getAllByUserId = function(userId) {
    return new Promise((resolve, reject) => {
        Transaction.find({userId}).then((transactions) => {
            resolve(transactions);
        }).catch((e) => {
            resolve(e.message);
        });
    });
}

let Transaction = mongoose.model('Transaction', schema);

module.exports = { Transaction };
