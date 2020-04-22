import 'reflect-metadata';
import * as fastify from 'fastify';
import * as helmet from 'fastify-helmet';
import { FastifyInstance } from 'fastify';
import * as fastJson from 'fast-json-stringify';
import { createConnection, getConnection, getConnectionManager } from 'typeorm';

import trace from './trace';

import './config';
// import { Context } from './Context';
// import { Request } from './Request';
// import createApolloServer from './apollo';

const stringifyHealthCheck = fastJson({
  type: 'object',
  properties: {
    status: {
      type: 'string',
    },
  },
});

export default async function app(): Promise<FastifyInstance> {
  const isProd = process.env.NODE_ENV === 'production';
  // eslint-disable-next-line
  const connection = getConnectionManager().has('default')
    ? getConnection()
    : await createConnection();

  const app = fastify({
    logger: true,
    disableRequestLogging: true,
    trustProxy: isProd,
  });

  app.register(helmet);
  app.register(trace, { enabled: isProd });

  app.get('/health', (req, res) => {
    res.type('application/health+json');
    res.send(stringifyHealthCheck({ status: 'ok' }));
  });

  // const server = await createApolloServer({
  //   context: (ctx): Context => new Context(ctx.req as Request, connection),
  //   playground: isProd
  //     ? false
  //     : { settings: { 'request.credentials': 'include' } },
  // });
  // app.register(server.createHandler({ disableHealthCheck: true }));

  return app;
}
