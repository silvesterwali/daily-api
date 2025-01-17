import { Connection, getConnection } from 'typeorm';
import { FastifyInstance } from 'fastify';

import appFunc from '../../src/background';
import worker from '../../src/workers/newPost';
import { expectSuccessfulBackground, saveFixtures } from '../helpers';
import {
  Keyword,
  Post,
  PostKeyword,
  PostTag,
  Source,
  User,
} from '../../src/entity';
import { sourcesFixture } from '../fixture/source';

let con: Connection;
let app: FastifyInstance;

beforeAll(async () => {
  con = await getConnection();
  app = await appFunc();
  return app.ready();
});

beforeEach(async () => {
  jest.resetAllMocks();
  await saveFixtures(con, Source, sourcesFixture);
});

it('should save a new post with basic information', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
  const tags = await con.getRepository(PostTag).find();
  expect(tags.length).toEqual(0);
  expect(posts[0]).toMatchSnapshot({
    createdAt: expect.any(Date),
    metadataChangedAt: expect.any(Date),
    score: expect.any(Number),
    id: expect.any(String),
    shortId: expect.any(String),
  });
});

it('should save a new post with full information', async () => {
  const timestamp = new Date(2020, 5, 11, 1, 17);

  await con.getRepository(Keyword).save([
    { value: 'javascript', occurrences: 20, status: 'allow' },
    { value: 'html', occurrences: 15, status: 'allow' },
    { value: 'webdev', occurrences: 5 },
    { value: 'js', occurrences: 5, status: 'synonym', synonym: 'javascript' },
    { value: 'nodejs', occurrences: 5, status: 'deny' },
  ]);
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    publishedAt: timestamp.toISOString(),
    image: 'https://image.com',
    ratio: 2,
    placeholder: 'data:image/jpeg;base64,placeholder',
    tags: ['webdev', 'javascript', 'html'],
    keywords: ['webdev', 'javascript', 'html', 'js', 'nodejs'],
    siteTwitter: 'site',
    creatorTwitter: 'creator',
    readTime: '5.123',
    description: 'This is my description',
    summary: 'This is my summary',
    toc: [
      {
        text: 'Title 1',
        id: 'title-1',
        children: [{ text: 'Sub 1', id: 'sub-1' }],
      },
      { text: 'Title 2', id: 'title-2' },
    ],
  });
  const posts = await con.getRepository(Post).find();
  const tags = await con.getRepository(PostTag).find({ select: ['tag'] });
  expect(posts.length).toEqual(1);
  expect(posts[0]).toMatchSnapshot({
    createdAt: expect.any(Date),
    metadataChangedAt: expect.any(Date),
    score: expect.any(Number),
    id: expect.any(String),
    shortId: expect.any(String),
  });
  expect(tags).toMatchSnapshot();
});

it('should handle empty tags array', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    tags: [],
  });
  const posts = await con.getRepository(Post).find();
  const tags = await con.getRepository(PostTag).find();
  expect(posts.length).toEqual(1);
  expect(tags.length).toEqual(0);
});

it('should save keywords', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    keywords: ['vue', 'nodejs'],
  });
  const posts = await con.getRepository(Post).find();
  const postKeywords = await con
    .getRepository(PostKeyword)
    .find({ select: ['keyword'], order: { keyword: 'ASC' } });
  const keywords = await con
    .getRepository(Keyword)
    .find({ select: ['value', 'status'], order: { value: 'ASC' } });
  expect(posts.length).toEqual(1);
  expect(postKeywords).toMatchSnapshot();
  expect(keywords).toMatchSnapshot();
});

it('should ignore numerical only keywords', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    keywords: ['vue', 'nodejs', '123'],
  });
  const posts = await con.getRepository(Post).find();
  const postKeywords = await con
    .getRepository(PostKeyword)
    .find({ select: ['keyword'], order: { keyword: 'ASC' } });
  const keywords = await con
    .getRepository(Keyword)
    .find({ select: ['value', 'status'], order: { value: 'ASC' } });
  expect(posts.length).toEqual(1);
  expect(postKeywords).toMatchSnapshot();
  expect(keywords).toMatchSnapshot();
});

it('should increase occurrences by one when keyword exists', async () => {
  await con.getRepository(Keyword).save([{ value: 'nodejs', status: 'allow' }]);
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    keywords: ['vue', 'nodejs'],
  });
  const posts = await con.getRepository(Post).find();
  const postKeywords = await con
    .getRepository(PostKeyword)
    .find({ select: ['keyword'], order: { keyword: 'ASC' } });
  const keywords = await con.getRepository(Keyword).find({
    select: ['value', 'status', 'occurrences'],
    order: { value: 'ASC' },
  });
  expect(posts.length).toEqual(1);
  expect(postKeywords).toMatchSnapshot();
  expect(keywords).toMatchSnapshot();
});

it('should handle duplicate keywords', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    keywords: ['vue', 'nodejs', 'vue'],
  });
  const posts = await con.getRepository(Post).find();
  const postKeywords = await con
    .getRepository(PostKeyword)
    .find({ select: ['keyword'], order: { keyword: 'ASC' } });
  const keywords = await con
    .getRepository(Keyword)
    .find({ select: ['value', 'status'], order: { value: 'ASC' } });
  expect(posts.length).toEqual(1);
  expect(postKeywords).toMatchSnapshot();
  expect(keywords).toMatchSnapshot();
});

it('should replace synonym keywords', async () => {
  await con.getRepository(Keyword).save([
    { value: 'node', status: 'synonym', synonym: 'nodejs' },
    { value: 'nodejs', status: 'allow' },
  ]);
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    keywords: ['vue', 'node'],
  });
  const posts = await con.getRepository(Post).find();
  const postKeywords = await con
    .getRepository(PostKeyword)
    .find({ select: ['keyword'], order: { keyword: 'ASC' } });
  const keywords = await con
    .getRepository(Keyword)
    .find({ select: ['value', 'status'], order: { value: 'ASC' } });
  expect(posts.length).toEqual(1);
  expect(postKeywords).toMatchSnapshot();
  expect(keywords).toMatchSnapshot();
});

it('should handle empty keywords array', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    keywords: [],
  });
  const posts = await con.getRepository(Post).find();
  const postKeywords = await con.getRepository(PostKeyword).find();
  const keywords = await con.getRepository(Keyword).find();
  expect(posts.length).toEqual(1);
  expect(postKeywords.length).toEqual(0);
  expect(keywords.length).toEqual(0);
});

it('should ignore null value violation', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: null,
    publicationId: 'a',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(0);
});

it('should set tagsStr to null when all keywords are not allowed', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    keywords: ['a', 'b'],
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
  expect(posts[0].tagsStr).toEqual(null);
});

it('should not save post with existing url', async () => {
  await con.getRepository(Post).save({
    id: 'p2',
    shortId: 'p2',
    title: 'Title 2',
    url: 'https://post.com',
    sourceId: 'b',
  });

  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
});

it('should not save post when url matches existing canonical url', async () => {
  await con.getRepository(Post).save({
    id: 'p2',
    shortId: 'p2',
    title: 'Title 2',
    url: 'https://post.com',
    canonicalUrl: 'https://post.dev',
    sourceId: 'b',
  });

  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.dev',
    publicationId: 'a',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
});

it('should not save post when canonical url matches existing url', async () => {
  await con.getRepository(Post).save({
    id: 'p2',
    shortId: 'p2',
    title: 'Title 2',
    url: 'https://post.com',
    canonicalUrl: 'https://post.dev',
    sourceId: 'b',
  });

  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.io',
    canonicalUrl: 'https://post.com',
    publicationId: 'a',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
});

it('should not save post when canonical url matches existing canonical url', async () => {
  await con.getRepository(Post).save({
    id: 'p2',
    shortId: 'p2',
    title: 'Title 2',
    url: 'https://post.com',
    canonicalUrl: 'https://post.dev',
    sourceId: 'b',
  });

  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.io',
    canonicalUrl: 'https://post.dev',
    publicationId: 'a',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
});

it('should match post to author', async () => {
  await con.getRepository(User).save([
    {
      id: '1',
      name: 'Ido',
      image: 'https://daily.dev/ido.jpg',
      twitter: 'IdoShamun',
    },
  ]);

  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    creatorTwitter: '@Idoshamun',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
  expect(posts[0]).toMatchSnapshot({
    createdAt: expect.any(Date),
    metadataChangedAt: expect.any(Date),
    score: expect.any(Number),
    id: expect.any(String),
    shortId: expect.any(String),
  });
});

it('should not match post to author based on username', async () => {
  await con.getRepository(User).save([
    {
      id: '1',
      name: 'Ido',
      image: 'https://daily.dev/ido.jpg',
      username: 'idoshamun',
    },
  ]);
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    creatorTwitter: '@idoshamun',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
  expect(posts[0]).toMatchSnapshot({
    createdAt: expect.any(Date),
    metadataChangedAt: expect.any(Date),
    score: expect.any(Number),
    id: expect.any(String),
    shortId: expect.any(String),
  });
});

it('should not match post to author', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    creatorTwitter: '@nouser',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
  expect(posts[0]).toMatchSnapshot({
    createdAt: expect.any(Date),
    metadataChangedAt: expect.any(Date),
    score: expect.any(Number),
    id: expect.any(String),
    shortId: expect.any(String),
  });
});

it('should clear empty creator twitter', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    creatorTwitter: '',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
  expect(posts[0].creatorTwitter).toBeNull();
});

it('should clear invalid creator twitter', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.com',
    publicationId: 'a',
    creatorTwitter: '@',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
  expect(posts[0].creatorTwitter).toBeNull();
});

it('should not save post when author is banned', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Title',
    url: 'https://post.io',
    publicationId: 'a',
    creatorTwitter: '@NewGenDeveloper',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(0);
});

it('should unescape html text', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'It&#039;s ok jQuery, I still love you',
    url: 'https://post.com',
    publicationId: 'a',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
  const tags = await con.getRepository(PostTag).find();
  expect(tags.length).toEqual(0);
  expect(posts[0]).toMatchSnapshot({
    createdAt: expect.any(Date),
    metadataChangedAt: expect.any(Date),
    score: expect.any(Number),
    id: expect.any(String),
    shortId: expect.any(String),
  });
});

it('should keep html-like text', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    title: 'Here is my <progress> element',
    url: 'https://post.com',
    publicationId: 'a',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(1);
  const tags = await con.getRepository(PostTag).find();
  expect(tags.length).toEqual(0);
  expect(posts[0]).toMatchSnapshot({
    createdAt: expect.any(Date),
    metadataChangedAt: expect.any(Date),
    score: expect.any(Number),
    id: expect.any(String),
    shortId: expect.any(String),
  });
});

it('should ignore message if title is empty', async () => {
  await expectSuccessfulBackground(app, worker, {
    id: 'p1',
    url: 'https://post.io',
    publicationId: 'a',
    creatorTwitter: '@NewGenDeveloper',
  });
  const posts = await con.getRepository(Post).find();
  expect(posts.length).toEqual(0);
});
