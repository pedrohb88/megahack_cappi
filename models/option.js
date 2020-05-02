const mongoose = require('mongoose');

let optionSchema = new mongoose.Schema( {
    name: {
        type: String, 
        required: true,
    }
});

let Option = mongoose.model('Option', optionSchema);

module.exports = { Option };
