const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/admin/dashboard.html');
const content = fs.readFileSync(filePath, 'utf8');

const lines = content.split(/\r?\n/);
lines.forEach((l, i) => {
    if (l.includes('renderPhotoGrid')) {
        console.log((i+1) + ': ' + l);
    }
});
