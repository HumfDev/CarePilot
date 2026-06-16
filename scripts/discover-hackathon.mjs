#!/usr/bin/env node
/**
 * Print Databricks resources in the hackathon profile for filling databricks.yml.
 * Usage: DATABRICKS_CONFIG_PROFILE=hackathon node scripts/discover-hackathon.mjs
 */
import { execFileSync } from 'node:child_process';

const profile = process.env.DATABRICKS_CONFIG_PROFILE ?? 'hackathon';
const args = (sub) => {
  const a = [...sub];
  if (profile) a.push('--profile', profile);
  a.push('-o', 'json');
  return a;
};

function run(sub) {
  try {
    return JSON.parse(execFileSync('databricks', args(sub), { encoding: 'utf8' }));
  } catch (err) {
    console.error(`Failed: databricks ${sub.join(' ')}`);
    console.error(err.stderr?.toString() || err.message);
    process.exit(1);
  }
}

console.log(`Profile: ${profile}\n`);

const apps = run(['apps', 'list']);
console.log('=== Apps ===');
for (const a of apps) {
  console.log(`  ${a.name}  id=${a.id}`);
  console.log(`    url: ${a.url}`);
  console.log(`    source: ${a.default_source_code_path ?? '(git)'}`);
}

const projects = run(['postgres', 'list-projects']);
console.log('\n=== Lakebase projects ===');
for (const p of projects) {
  console.log(`  ${p.name}  uid=${p.uid ?? ''}`);
}

const warehouses = run(['warehouses', 'list']);
console.log('\n=== SQL warehouses ===');
for (const w of warehouses.warehouses ?? warehouses ?? []) {
  console.log(`  ${w.name}  id=${w.id}  state=${w.state}`);
}

console.log('\nNext: update targets.hackathon.variables in databricks.yml, then:');
console.log('  npm run deploy:hackathon');
