#!/usr/bin/env node
/**
 * Dependency-free secret scanner for tracked (or --staged) files.
 * Prints ONLY file:line and pattern name — never prints matched values.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const stagedOnly = process.argv.includes('--staged');
const cmd = stagedOnly
  ? 'git diff --cached --name-only --diff-filter=ACM'
  : 'git ls-files';

let rawList = '';
try {
  rawList = execSync(cmd, { encoding: 'utf8' });
} catch (err) {
  console.error('secret-scan: failed to list git files:', err.message);
  process.exit(1);
}

const files = rawList.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

const binaryExtRe = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|eot|pdf|mp4|webm|zip|gz|tar|exe|dll|so|dylib|bin)$/i;
const skipPrefixRe = /^(dist|node_modules)\//;

function isPlaceholder(val) {
  const v = String(val || '').trim().replace(/^['"`]|['"`]$/g, '');
  if (!v) return true;
  if (/^[Xx*_-]+$/.test(v)) return true;
  if (/^(your_|example|placeholder|changeme|replace_me|process\.env)/i.test(v)) return true;
  if (/^rzp_(?:live|test)_[Xx*]{6,}$/i.test(v)) return true;
  return false;
}

const rules = [
  {
    name: 'razorpay_live_key',
    test(line) {
      const m = line.match(/\b(rzp_live_[A-Za-z0-9]{14,})\b/);
      if (!m) return false;
      const suffix = m[1].slice('rzp_live_'.length);
      return !isPlaceholder(suffix);
    }
  },
  {
    name: 'razorpay_key_secret',
    test(line) {
      const m = line.match(/\bRAZORPAY_KEY_SECRET\s*=\s*([^\s#]+)/);
      return Boolean(m && !isPlaceholder(m[1]));
    }
  },
  {
    name: 'shiprocket_password',
    test(line) {
      const m = line.match(/\bSHIPROCKET_PASSWORD\s*=\s*([^\s#]+)/);
      return Boolean(m && !isPlaceholder(m[1]));
    }
  },
  {
    name: 'private_key_block',
    test(line) {
      return /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/.test(line);
    }
  },
  {
    name: 'aws_access_key',
    test(line) {
      return /\bAKIA[0-9A-Z]{16}\b/.test(line);
    }
  },
  {
    name: 'twilio_key_or_sid',
    test(line) {
      return /\b(?:AC|SK)[0-9a-fA-F]{32}\b/.test(line);
    }
  }
];

const findings = [];

for (const rel of files) {
  const norm = rel.replace(/\\/g, '/');
  if (skipPrefixRe.test(norm) || binaryExtRe.test(norm)) continue;
  const full = path.resolve(process.cwd(), norm);
  if (!fs.existsSync(full)) continue;
  const stat = fs.statSync(full);
  if (!stat.isFile()) continue;

  const buf = fs.readFileSync(full);
  if (buf.includes(0)) continue; // skip binary files

  const lines = buf.toString('utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const rule of rules) {
      if (rule.test(line)) {
        findings.push(`${norm}:${idx + 1} [${rule.name}]`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error('Potential secrets detected:');
  for (const f of findings) {
    console.error(`  ${f}`);
  }
  process.exit(1);
}

console.log(`secret-scan: OK (${files.length} tracked files checked, 0 issues).`);
