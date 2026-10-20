// Creates the local AWS resources in Floci that the app expects. Idempotent.
// Superseded by Terraform once infra/ exists (see docs/adr/0002).
import {
  CreateDBInstanceCommand,
  DBInstanceNotFoundFault,
  DescribeDBInstancesCommand,
  RDSClient,
  waitUntilDBInstanceAvailable,
} from '@aws-sdk/client-rds';
import {
  CreateEventSourceMappingCommand,
  CreateFunctionCommand,
  GetFunctionCommand,
  LambdaClient,
  ListEventSourceMappingsCommand,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda';
import {
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketNotificationConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CreateQueueCommand, GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { readFileSync } from 'node:fs';

const DB_INSTANCE_ID = 'squawk';
const IMPORT_FUNCTION = 'squawk-flight-import';
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

await ensureBucket();
await ensureImportPipeline();

async function ensureBucket(): Promise<void> {
  const bucket = process.env.S3_BUCKET ?? 'squawk-attachments';
  const s3 = new S3Client({ forcePathStyle: true });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (!(err instanceof Error) || err.name !== 'BucketAlreadyOwnedByYou') throw err;
  }
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [process.env.WEB_ORIGIN ?? 'http://localhost:5173'],
            AllowedMethods: ['POST'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 300,
          },
        ],
      },
    }),
  );
  console.log(`S3 bucket "${bucket}" ready`);
}

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

// S3 (imports/ prefix) -> SQS -> Lambda, with a dead-letter queue for files that keep failing.
async function ensureImportPipeline(): Promise<void> {
  const bucket = process.env.S3_BUCKET ?? 'squawk-attachments';
  const sqs = new SQSClient({});
  const lambda = new LambdaClient({});
  const s3 = new S3Client({ forcePathStyle: true });

  const queueArn = async (name: string, attributes: Record<string, string> = {}) => {
    const { QueueUrl } = await sqs.send(
      new CreateQueueCommand({ QueueName: name, Attributes: attributes }),
    );
    const { Attributes } = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }),
    );
    return Attributes?.QueueArn ?? '';
  };
  const dlqArn = await queueArn('flight-import-dlq');
  const arn = await queueArn('flight-import-files', {
    // Longer than the function timeout, otherwise a running invocation would be delivered again.
    VisibilityTimeout: '60',
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 3 }),
  });

  await s3.send(
    new PutBucketNotificationConfigurationCommand({
      Bucket: bucket,
      NotificationConfiguration: {
        QueueConfigurations: [
          {
            QueueArn: arn,
            Events: ['s3:ObjectCreated:*'],
            Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'imports/' }] } },
          },
        ],
      },
    }),
  );

  // The function reaches the database through the RDS proxy port of the Floci container.
  const functionDatabaseUrl = new URL(db);
  functionDatabaseUrl.hostname = 'floci';
  const config = {
    FunctionName: IMPORT_FUNCTION,
    Runtime: 'nodejs22.x' as const,
    Handler: 'index.handler',
    Timeout: 30,
    Role: 'arn:aws:iam::000000000000:role/squawk-importer',
    Environment: { Variables: { DATABASE_URL: functionDatabaseUrl.toString() } },
  };
  const zip = readFileSync(new URL('../apps/importer/dist/importer.zip', import.meta.url));
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: IMPORT_FUNCTION }));
    await lambda.send(
      new UpdateFunctionCodeCommand({ FunctionName: IMPORT_FUNCTION, ZipFile: zip }),
    );
    await waitUntilFunctionUpdatedV2(
      { client: lambda, maxWaitTime: 60 },
      { FunctionName: IMPORT_FUNCTION },
    );
    await lambda.send(new UpdateFunctionConfigurationCommand(config));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
    await lambda.send(new CreateFunctionCommand({ ...config, Code: { ZipFile: zip } }));
  }

  const { EventSourceMappings } = await lambda.send(
    new ListEventSourceMappingsCommand({ FunctionName: IMPORT_FUNCTION }),
  );
  if (!EventSourceMappings?.some((m) => m.EventSourceArn === arn)) {
    await lambda.send(
      new CreateEventSourceMappingCommand({
        FunctionName: IMPORT_FUNCTION,
        EventSourceArn: arn,
        BatchSize: 1,
      }),
    );
  }
  console.log(`Import pipeline ready (function "${IMPORT_FUNCTION}")`);
}
