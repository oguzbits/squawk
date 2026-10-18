import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const UPLOAD_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 300;

// The endpoint comes from AWS_ENDPOINT_URL (Floci locally); path-style addressing is needed there.
export const createS3Client = (): S3Client =>
  new S3Client({ forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL) });

export type Storage = ReturnType<typeof createStorage>;

export function createStorage(s3: S3Client, bucket: string) {
  return {
    // S3 itself rejects uploads whose size or content type differ from what was declared.
    // Each entry in Fields becomes an exact-match condition in the signed policy.
    createUpload(key: string, contentType: string, size: number) {
      return createPresignedPost(s3, {
        Bucket: bucket,
        Key: key,
        Expires: UPLOAD_TTL_SECONDS,
        Fields: { 'Content-Type': contentType },
        Conditions: [['content-length-range', size, size]],
      });
    },

    async statObject(
      key: string,
    ): Promise<{ size: number; contentType: string | undefined } | null> {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: head.ContentLength ?? 0, contentType: head.ContentType };
      } catch (err) {
        if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async deleteObject(key: string): Promise<void> {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    downloadUrl(key: string, fileName: string): Promise<string> {
      const safeName = fileName.replace(/[^A-Za-z0-9._ -]/g, '_');
      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${safeName}"`,
        }),
        { expiresIn: DOWNLOAD_TTL_SECONDS },
      );
    },
  };
}
