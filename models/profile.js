const mongoose = require('mongoose');

let profileSchema = new mongoose.Schema({
    name: {
        type: String, 
        required: true,
    },
    minXp: {
        type: Number, 
        required: true,
    },
    options: [{
        id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        }
    }],
});

profileSchema.statics.getOptionsByXp = function(xp) {
    return new Promise((resolve, reject) => {
        let Profile = this;
        let result = [];

        Profile.find({minXp: { $lte: xp}})
        .then((profiles) => {

            profiles.forEach((profile) => {
                result = [...result, ...profile.options];
            });

            resolve(result);
        })
        .catch((e) => {
            resolve([]);
        });
    });
};

let Profile = mongoose.model('Profile', profileSchema);

module.exports = { Profile };
