import { ApolloServer } from 'apollo-server-fastify';
import {
  ApolloServerTestClient,
  createTestClient,
} from 'apollo-server-testing';
import { GraphQLResponse } from 'apollo-server-types';
import { Connection, getConnection } from 'typeorm';
import nock from 'nock';
import { FastifyInstance } from 'fastify';
import request from 'supertest';
import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { mocked } from 'ts-jest/utils';

import { Context } from '../src/Context';
import createApolloServer from '../src/apollo';
import {
  authorizeRequest,
  MockContext,
  Mutation,
  testMutationError,
  testMutationErrorCode,
  testQueryErrorCode,
} from './helpers';
import appFunc from '../src';
import { Roles } from '../src/roles';
import { Source, SourceRequest } from '../src/entity';
import { sourceRequestFixture } from './fixture/sourceRequest';
import { uploadLogo } from '../src/common';
import {
  GQLDeclineSourceRequestInput,
  GQLRequestSourceInput,
  GQLUpdateSourceRequestInput,
} from '../src/schema/sourceRequests';

let app: FastifyInstance;
let con: Connection;
let server: ApolloServer;
let client: ApolloServerTestClient;
let loggedUser: string = null;
let roles: Roles[] = [];

jest.mock('../src/common', () => ({
  ...(jest.requireActual('../src/common') as Record<string, unknown>),
  uploadLogo: jest.fn(),
}));

const mockInfo = (): nock.Scope =>
  nock(process.env.GATEWAY_URL)
    .get('/v1/users/me/info')
    .matchHeader('authorization', `Service ${process.env.GATEWAY_SECRET}`)
    .matchHeader('user-id', '1')
    .matchHeader('logged-in', 'true')
    .reply(200, { email: 'ido@daily.dev', name: 'Ido' });

const testModeratorAuthorization = (mutation: Mutation): Promise<void> => {
  roles = [];
  loggedUser = '1';
  return testMutationErrorCode(client, mutation, 'FORBIDDEN');
};

const testNotFound = (mutation: Mutation): Promise<void> => {
  roles = [Roles.Moderator];
  loggedUser = '1';
  return testMutationErrorCode(client, mutation, 'NOT_FOUND');
};

beforeAll(async () => {
  con = await getConnection();
  server = await createApolloServer({
    context: (): Context => new MockContext(con, loggedUser, false, roles),
    playground: false,
  });
  client = createTestClient(server);
  app = await appFunc();
  return app.ready();
});

beforeEach(async () => {
  loggedUser = null;
  roles = [];
});

afterAll(() => app.close());

describe('mutation requestSource', () => {
  const MUTATION = `
  mutation RequestSource($data: RequestSourceInput!) {
  requestSource(data: $data) {
    sourceUrl
    userId
    userName
    userEmail
  }
}`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { data: { sourceUrl: 'http://source.com' } },
      },
      'UNAUTHENTICATED',
    ));

  it('should return bad request when url is not valid', async () => {
    loggedUser = '1';
    return testMutationError(
      client,
      {
        mutation: MUTATION,
        variables: { data: { sourceUrl: 'invalid' } },
      },
      (errors) => expect(errors).toMatchSnapshot(),
    );
  });

  it('should add new source request', async () => {
    mockInfo();
    loggedUser = '1';
    const data: GQLRequestSourceInput = { sourceUrl: 'http://source.com' };
    const res = await client.mutate({
      mutation: MUTATION,
      variables: { data },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('mutation updateSourceRequest', () => {
  const MUTATION = (id: string): string => `
  mutation UpdateSourceRequest($data: UpdateSourceRequestInput!) {
  updateSourceRequest(id: "${id}", data: $data) {
    sourceUrl
    sourceId
    sourceName
    sourceImage
    sourceTwitter
    sourceFeed
  }
}`;

  it('should not authorize when not moderator', () =>
    testModeratorAuthorization({
      mutation: MUTATION('1'),
      variables: { data: { sourceUrl: 'http://new.com' } },
    }));

  it('should throw not found when source request does not exist', () =>
    testNotFound({
      mutation: MUTATION(uuidv4()),
      variables: { data: { sourceUrl: 'http://new.com' } },
    }));

  it('should partially update existing request', async () => {
    roles = [Roles.Moderator];
    loggedUser = '1';
    const req = await con
      .getRepository(SourceRequest)
      .save(sourceRequestFixture[2]);
    const data: GQLUpdateSourceRequestInput = {
      sourceUrl: 'http://source.com',
      sourceImage: 'http://image.com',
    };
    const res = await client.mutate({
      mutation: MUTATION(req.id),
      variables: { data },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('mutation declineSourceRequest', () => {
  const MUTATION = (id: string): string => `
  mutation DeclineSourceRequest($data: DeclineSourceRequestInput!) {
  declineSourceRequest(id: "${id}", data: $data) {
    approved
    closed
    reason
  }
}`;

  it('should not authorize when not moderator', () =>
    testModeratorAuthorization({
      mutation: MUTATION('1'),
      variables: { data: { reason: 'not-active' } },
    }));

  it('should throw not found when source request does not exist', () =>
    testNotFound({
      mutation: MUTATION(uuidv4()),
      variables: { data: { reason: 'not-active' } },
    }));

  it('should decline a source request', async () => {
    roles = [Roles.Moderator];
    loggedUser = '1';
    const req = await con
      .getRepository(SourceRequest)
      .save(sourceRequestFixture[2]);
    const data: GQLDeclineSourceRequestInput = { reason: 'not-active' };
    const res = await client.mutate({
      mutation: MUTATION(req.id),
      variables: { data },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('mutation approveSourceRequest', () => {
  const MUTATION = (id: string): string => `
  mutation ApproveSourceRequest {
  approveSourceRequest(id: "${id}") {
    approved
    closed
    reason
  }
}`;

  it('should not authorize when not moderator', () =>
    testModeratorAuthorization({
      mutation: MUTATION('1'),
    }));

  it('should throw not found when source request does not exist', () =>
    testNotFound({
      mutation: MUTATION(uuidv4()),
    }));

  it('should approve a source request', async () => {
    roles = [Roles.Moderator];
    loggedUser = '1';
    const req = await con
      .getRepository(SourceRequest)
      .save(sourceRequestFixture[2]);
    const res = await client.mutate({
      mutation: MUTATION(req.id),
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('mutation uploadSourceRequestLogo', () => {
  const MUTATION = (id: string): string => `
  mutation UploadSourceRequestLogo($file: Upload!) {
  uploadSourceRequestLogo(id: "${id}", file: $file) {
    sourceImage
  }
}`;

  it('should not authorize when not moderator', async () => {
    roles = [];
    const res = await authorizeRequest(
      request(app.server)
        .post('/graphql')
        .field(
          'operations',
          JSON.stringify({
            query: MUTATION('1'),
            variables: { file: null },
          }),
        )
        .field('map', JSON.stringify({ '0': ['variables.file'] }))
        .attach('0', './__tests__/fixture/happy_card.png'),
    ).expect(200);
    const body = res.body as GraphQLResponse;
    expect(body.errors.length).toEqual(1);
    expect(body.errors[0].extensions.code).toEqual('FORBIDDEN');
  });

  it('should upload new logo for source request', async () => {
    loggedUser = '1';
    const req = await con
      .getRepository(SourceRequest)
      .save(sourceRequestFixture[2]);
    mocked(uploadLogo).mockResolvedValue('http://image.com');
    const res = await authorizeRequest(
      request(app.server)
        .post('/graphql')
        .field(
          'operations',
          JSON.stringify({
            query: MUTATION(req.id),
            variables: { file: null },
          }),
        )
        .field('map', JSON.stringify({ '0': ['variables.file'] }))
        .attach('0', './__tests__/fixture/happy_card.png'),
      loggedUser,
      [Roles.Moderator],
    ).expect(200);
    const body = res.body as GraphQLResponse;
    expect(body.errors).toBeFalsy();
    expect(body.data).toMatchSnapshot();
  });
});

describe('mutation publishSourceRequest', () => {
  const MUTATION = (id: string): string => `
  mutation PublishSourceRequest {
  publishSourceRequest(id: "${id}") {
    approved
    closed
  }
}`;

  it('should not authorize when not moderator', () =>
    testModeratorAuthorization({
      mutation: MUTATION('1'),
    }));

  it('should throw not found when source request does not exist', () =>
    testNotFound({
      mutation: MUTATION(uuidv4()),
    }));

  it('should publish a source request', async () => {
    roles = [Roles.Moderator];
    loggedUser = '1';
    const req = await con
      .getRepository(SourceRequest)
      .save(sourceRequestFixture[2]);
    const res = await client.mutate({
      mutation: MUTATION(req.id),
    });
    expect(res.data).toMatchSnapshot();
    const source = await con.getRepository(Source).findOneOrFail(req.sourceId);
    expect(source).toMatchSnapshot();
    expect(await source.feeds).toMatchSnapshot();
  });
});

describe('query pendingSourceRequests', () => {
  const QUERY = (first = 10): string => `{
  pendingSourceRequests(first: ${first}) {
    pageInfo {
      endCursor
      hasNextPage
    }
    edges {
      node {
        sourceUrl
      }
    }
  }
}`;

  it('should not authorize when not moderator', async () => {
    roles = [];
    loggedUser = '1';
    return testQueryErrorCode(client, { query: QUERY() }, 'FORBIDDEN');
  });

  it('should return pending source requests', async () => {
    roles = [Roles.Moderator];
    loggedUser = '1';

    await con.getRepository(SourceRequest).save(sourceRequestFixture);

    const res = await client.query({ query: QUERY() });
    expect(res.data).toMatchSnapshot();
  });
});

describe('compatibility routes', () => {
  describe('POST /publications/request', () => {
    it('should not authorize when not logged in', () => {
      return request(app.server)
        .post('/v1/publications/request')
        .send({ source: 'http://source.com' })
        .expect(401);
    });

    it('should return bad request when url is not valid', () => {
      mockInfo();
      return authorizeRequest(
        request(app.server).post('/v1/publications/request'),
      )
        .send({ source: 'invalid' })
        .expect(400);
    });

    it('should request new source', () => {
      mockInfo();
      return authorizeRequest(
        request(app.server).post('/v1/publications/request'),
      )
        .send({ source: 'http://source.com' })
        .expect(204);
    });

    it('should request new source (/requests)', () => {
      mockInfo();
      return authorizeRequest(
        request(app.server).post('/v1/publications/requests'),
      )
        .send({ source: 'http://source.com' })
        .expect(204);
    });
  });

  describe('GET /publications/requests/open', () => {
    it('should return pending source requests', async () => {
      await con.getRepository(SourceRequest).save(sourceRequestFixture);

      const res = await authorizeRequest(
        request(app.server).get('/v1/publications/requests/open'),
        loggedUser,
        [Roles.Moderator],
      ).expect(200);
      const actual = res.body.map((x) => _.omit(x, ['id', 'createdAt']));
      expect(actual).toMatchSnapshot();
    });
  });

  describe('PUT /publications/requests/:id', () => {
    it('should update an existing source request', async () => {
      loggedUser = '1';
      const req = await con
        .getRepository(SourceRequest)
        .save(sourceRequestFixture[2]);
      await authorizeRequest(
        request(app.server).put(`/v1/publications/requests/${req.id}`),
        loggedUser,
        [Roles.Moderator],
      )
        .send({ url: 'http://source.com', pubImage: 'http://image.com' })
        .expect(204);
      expect(
        await con.getRepository(SourceRequest).findOne(req.id, {
          select: ['sourceUrl', 'sourceImage', 'sourceName', 'sourceTwitter'],
        }),
      ).toMatchSnapshot();
    });
  });

  describe('POST /publications/requests/:id/decline', () => {
    it('should decline a source request', async () => {
      loggedUser = '1';
      const req = await con
        .getRepository(SourceRequest)
        .save(sourceRequestFixture[2]);
      await authorizeRequest(
        request(app.server).post(`/v1/publications/requests/${req.id}/decline`),
        loggedUser,
        [Roles.Moderator],
      )
        .send({ reason: 'not-active' })
        .expect(204);
      expect(
        await con.getRepository(SourceRequest).findOne(req.id, {
          select: ['approved', 'closed', 'reason'],
        }),
      ).toMatchSnapshot();
    });
  });

  describe('POST /publications/requests/:id/approve', () => {
    it('should approve a source request', async () => {
      loggedUser = '1';
      const req = await con
        .getRepository(SourceRequest)
        .save(sourceRequestFixture[2]);
      await authorizeRequest(
        request(app.server).post(`/v1/publications/requests/${req.id}/approve`),
        loggedUser,
        [Roles.Moderator],
      )
        .send()
        .expect(204);
      expect(
        await con.getRepository(SourceRequest).findOne(req.id, {
          select: ['approved', 'closed', 'reason'],
        }),
      ).toMatchSnapshot();
    });
  });

  describe('POST /publications/requests/:id/publish', () => {
    it('should publish a source request', async () => {
      loggedUser = '1';
      const req = await con
        .getRepository(SourceRequest)
        .save(sourceRequestFixture[2]);
      await authorizeRequest(
        request(app.server).post(`/v1/publications/requests/${req.id}/publish`),
        loggedUser,
        [Roles.Moderator],
      )
        .send()
        .expect(204);
      expect(
        await con.getRepository(SourceRequest).findOne(req.id, {
          select: ['approved', 'closed'],
        }),
      ).toMatchSnapshot();
    });
  });
});
