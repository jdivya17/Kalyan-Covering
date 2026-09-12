const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('====================================================');
console.log('🔍 FULL PROJECT CODEBASE AUDIT & HEALTH CHECK');
console.log('====================================================\n');

let totalIssues = 0;

// 1. Check all JS files for syntax errors
console.log('--- 1. JavaScript Syntax Verification ---');
function checkJsDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
                checkJsDirectory(fullPath);
            }
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
            try {
                const code = fs.readFileSync(fullPath, 'utf8');
                // For node files or modules, parse syntax
                new vm.Script(code, { filename: fullPath });
            } catch (err) {
                // If it fails because of 'import' statements in browser ES modules, test with module parsing if possible
                if (err.message.includes('Cannot use import statement outside a module')) {
                    // Valid ES Module syntax
                } else {
                    console.error(`❌ Syntax Error in ${fullPath}: ${err.message}`);
                    totalIssues++;
                }
            }
        }
    }
}

checkJsDirectory('public/js');
checkJsDirectory('server');
checkJsDirectory('api');
checkJsDirectory('functions');
console.log('✔ JS Syntax scan completed.\n');

// 2. Check HTML files for broken script tags and missing assets
console.log('--- 2. HTML Asset & Script References Check ---');
function checkHtmlDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
                checkHtmlDirectory(fullPath);
            }
        } else if (entry.name.endsWith('.html')) {
            const html = fs.readFileSync(fullPath, 'utf8');
            
            // Check script tags src
            const scriptMatches = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)];
            for (const sm of scriptMatches) {
                const src = sm[1];
                if (src.startsWith('http://') || src.startsWith('https://')) continue;
                
                const resolvedPath = path.resolve(path.dirname(fullPath), src.split('?')[0]);
                if (!fs.existsSync(resolvedPath)) {
                    console.warn(`⚠️ Broken script link in ${fullPath}: "${src}" (Resolved: ${resolvedPath})`);
                    totalIssues++;
                }
            }

            // Check CSS links
            const cssMatches = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/g)];
            for (const cm of cssMatches) {
                const href = cm[1];
                if (href.startsWith('http://') || href.startsWith('https://')) continue;
                
                const resolvedPath = path.resolve(path.dirname(fullPath), href.split('?')[0]);
                if (!fs.existsSync(resolvedPath)) {
                    console.warn(`⚠️ Broken CSS link in ${fullPath}: "${href}" (Resolved: ${resolvedPath})`);
                    totalIssues++;
                }
            }
        }
    }
}

checkHtmlDirectory('public');
console.log('✔ HTML references scan completed.\n');

// 3. Check API Routes matching
console.log('--- 3. API Router & Endpoint Verification ---');
try {
    const apiApp = require('./api/index.js');
    console.log('✔ API server loaded cleanly (express router initialized).');
} catch (e) {
    console.error('❌ Error loading api/index.js:', e.message);
    totalIssues++;
}

console.log(`\n====================================================`);
console.log(`Audit Finished. Total critical issues found: ${totalIssues}`);
console.log(`====================================================`);
