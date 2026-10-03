const { execSync } = require('child_process');
const out = execSync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine').toString();
const lines = out.split('\n').filter(l => l.includes('rexeditzz-insta-agent'));
console.log(lines.join('\n'));
