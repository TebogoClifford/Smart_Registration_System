// mark-esm.js — run after `prisma generate` (see the "generate" npm script).
// Prisma 7 generates its client as TypeScript ES modules. This backend is CommonJS, so the generated
// folder gets its own package.json saying "module"; Node 22.18+ then runs those .ts files directly and
// lets the CommonJS code require() them.
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'src', 'generated', 'prisma', 'package.json');
fs.writeFileSync(out, '{ "type": "module" }\n');
console.log('marked', path.relative(process.cwd(), out), 'as an ES module package');
