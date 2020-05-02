const mongoose = require('mongoose');

let Transaction = mongoose.model('Transaction', {
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
    }
});

module.exports = { Transaction };
