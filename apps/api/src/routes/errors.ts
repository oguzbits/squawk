import { z } from 'zod';
import type { FastifyReply } from 'fastify';

export const errorSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
});

const TITLES: Record<number, string> = {
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
};

export const problem = (reply: FastifyReply, statusCode: 404 | 409 | 422, message: string) =>
  reply.code(statusCode).send({ statusCode, error: TITLES[statusCode], message });
