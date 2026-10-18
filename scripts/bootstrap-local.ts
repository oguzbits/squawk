// Creates the local AWS resources in Floci that the app expects. Idempotent.
// Superseded by Terraform once infra/ exists (see docs/adr/0002).
import {
  CreateDBInstanceCommand,
  DBInstanceNotFoundFault,
  DescribeDBInstancesCommand,
  RDSClient,
  waitUntilDBInstanceAvailable,
} from '@aws-sdk/client-rds';

const DB_INSTANCE_ID = 'squawk';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'localhost.floci.io']);

const endpoint = process.env.AWS_ENDPOINT_URL;
if (!endpoint || !LOCAL_HOSTS.has(new URL(endpoint).hostname)) {
  throw new Error(`Refusing to run: AWS_ENDPOINT_URL must point to local Floci, got "${endpoint}"`);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = new URL(process.env.DATABASE_URL);

await waitForFloci(endpoint);

const rds = new RDSClient({});
const port = (await findInstancePort()) ?? (await createInstance());
// Floci assigns proxy ports in creation order, so the configured port must match the assigned one.
if (String(port) !== db.port) {
  throw new Error(`RDS instance listens on port ${port}, but DATABASE_URL uses port ${db.port}`);
}
console.log(`RDS instance "${DB_INSTANCE_ID}" available on port ${port}`);

async function waitForFloci(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(new URL('/_floci/health', baseUrl))).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Floci not reachable at ${baseUrl}`);
}

async function findInstancePort(): Promise<number | undefined> {
  try {
    const { DBInstances } = await rds.send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID }),
    );
    return DBInstances?.[0]?.Endpoint?.Port;
  } catch (err) {
    if (err instanceof DBInstanceNotFoundFault) return undefined;
    throw err;
  }
}

async function createInstance(): Promise<number | undefined> {
  console.log(`Creating RDS instance "${DB_INSTANCE_ID}"...`);
  await rds.send(
    new CreateDBInstanceCommand({
      DBInstanceIdentifier: DB_INSTANCE_ID,
      Engine: 'postgres',
      EngineVersion: '16',
      DBInstanceClass: 'db.t3.micro',
      AllocatedStorage: 20,
      DBName: db.pathname.slice(1),
      MasterUsername: decodeURIComponent(db.username),
      MasterUserPassword: decodeURIComponent(db.password),
    }),
  );
  await waitUntilDBInstanceAvailable(
    { client: rds, maxWaitTime: 120 },
    { DBInstanceIdentifier: DB_INSTANCE_ID },
  );
  return findInstancePort();
}
