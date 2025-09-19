import fs from 'fs';
import path from 'path';

const credentialsPath = path.join(process.cwd(), 'credentials.json');
const credentialsFile = fs.readFileSync(credentialsPath, 'utf-8');
const credentials = JSON.parse(credentialsFile);
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
const finalJSONString = JSON.stringify(credentials);
console.log('\n✅ COPIE A LINHA ABAIXO E COLE NA HEROKU:\n');
console.log(finalJSONString);
console.log('\n');