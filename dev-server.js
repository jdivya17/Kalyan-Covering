"use strict";
const app = require('./api/index.js');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`[Dev Server] Kalyan Covering API running on port ${PORT}`);
});
