import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const diagnosticsDir = '.artifacts/supabase-release-proof';
const proofRequired = process.env.CI === 'true' || process.env.REQUIRE_SUPABASE_RELEASE_PROOF === '1';

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function skip(reason) {
  if (proofRequired) {
    console.error(`Supabase release proof is required but unavailable: ${reason}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Skipping local Supabase release journey: ${reason}. CI owns this check.`);
  process.exitCode = 0;
}

function parseEnvironment(output) {
  return Object.fromEntries(
    output.split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf('=');
      return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
    })
  );
}

const cli = run('supabase', ['--version']);
if (cli.error || cli.status !== 0) {
  skip('Supabase CLI is unavailable');
} else {
  const docker = run('docker', ['info']);
  if (docker.error || docker.status !== 0) {
    skip('Docker is unavailable');
  } else {
    mkdirSync(diagnosticsDir, { recursive: true });
    const started = run('supabase', ['start']);
    if (started.status !== 0) {
      const startupDiagnostics = `${started.stdout ?? ''}\n${started.stderr ?? ''}`
        .replace(/(?:anon|service_role|jwt|secret|password|key)[^\r\n]*/gi, '[redacted]')
        .slice(-12000);
      writeFileSync(`${diagnosticsDir}/startup.txt`, startupDiagnostics || 'Supabase start returned no diagnostics.\n');
      console.error('Local Supabase stack failed to start. See CI diagnostics when running in GitHub Actions.');
      process.exitCode = 1;
    } else {
      try {
        const environment = parseEnvironment(run('supabase', ['status', '-o', 'env']).stdout ?? '');
        if (!environment.API_URL || !environment.ANON_KEY || !environment.SERVICE_ROLE_KEY || !environment.DB_URL) {
          throw new Error('Local Supabase stack did not provide the required test configuration.');
        }

        const migrate = run('node', ['scripts/apply-test-migrations.mjs'], {
          stdio: 'inherit',
          env: { ...process.env, TEST_DATABASE_URL: environment.DB_URL }
        });
        if (migrate.status !== 0) throw new Error('Local Supabase migrations failed.');

        const build = run('npm', ['run', 'build'], { stdio: 'inherit' });
        if (build.status !== 0) throw new Error('Production build failed.');

        const testEnvironment = {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: environment.API_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.ANON_KEY,
          SUPABASE_SERVICE_ROLE_KEY: environment.SERVICE_ROLE_KEY,
          TEST_DATABASE_URL: environment.DB_URL,
          TEST_SUPABASE_LOCAL: '1',
          TEST_SUPABASE_URL: environment.API_URL,
          TEST_SUPABASE_SERVICE_ROLE_KEY: environment.SERVICE_ROLE_KEY,
          TEST_SUPABASE_ANON_KEY: environment.ANON_KEY,
          RELEASE_PROOF_ARTIFACTS_DIR: diagnosticsDir
        };
        const test = run('npm', ['run', 'test:release-proof:http'], {
          stdio: 'inherit',
          env: testEnvironment
        });
        if (test.status !== 0) {
          process.exitCode = test.status ?? 1;
        } else {
          const supplemental = run('npm', ['run', 'test:db'], {
            stdio: 'inherit',
            env: testEnvironment
          });
          if (supplemental.status !== 0) {
            process.exitCode = supplemental.status ?? 1;
          } else {
            const serviceRole = run('npm', ['run', 'test:supabase:service-role'], {
              stdio: 'inherit',
              env: testEnvironment
            });
            process.exitCode = serviceRole.status ?? 1;
          }
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Local Supabase release journey failed.');
        process.exitCode = 1;
      } finally {
        // Container names and health states aid CI diagnosis without retaining generated credentials.
        const containers = run('docker', ['ps', '--format', '{{.Names}}\t{{.Status}}']);
        writeFileSync(`${diagnosticsDir}/docker-containers.txt`, containers.stdout ?? 'Docker diagnostics unavailable.\n');
        run('supabase', ['stop', '--no-backup']);
      }
    }
  }
}
