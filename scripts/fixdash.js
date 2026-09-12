const fs = require('fs');
const p = 'C:/KALYAN_COVERING_STORE/public/admin/dashboard.html';
const content = fs.readFileSync(p, 'utf8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);

// Find the FIRST </html> occurrence after line 3800
let htmlIdx = -1;
for (let i = 3800; i < lines.length; i++) {
    if (lines[i].includes('</html>')) {
        htmlIdx = i;
        console.log('First </html> found at line:', i + 1, '| content:', lines[i].trim());
        break;
    }
}

if (htmlIdx > 0) {
    const clean = lines.slice(0, htmlIdx + 1).join('\n');
    fs.writeFileSync(p, clean, 'utf8');
    console.log('Cleaned. New line count:', clean.split('\n').length);
} else {
    console.log('Not found. Showing lines 3828-3840:');
    for (let i = 3827; i < Math.min(3840, lines.length); i++) {
        console.log((i+1) + ': ' + lines[i].substring(0, 80));
    }
}
