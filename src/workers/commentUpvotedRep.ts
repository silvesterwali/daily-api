import { messageToJson, Worker } from './worker';
import { Comment } from '../entity';
import { increaseReputation } from '../common';

interface Data {
  userId: string;
  commentId: string;
}

const worker: Worker = {
  subscription: 'comment-upvoted-rep',
  handler: async (message, con, logger): Promise<void> => {
    const data: Data = messageToJson(message);
    try {
      const comment = await con.getRepository(Comment).findOne(data.commentId);
      if (!comment) {
        logger.info(
          {
            data,
            messageId: message.messageId,
          },
          'comment does not exist',
        );
        return;
      }
      if (comment.userId !== data.userId) {
        await increaseReputation(con, logger, comment.userId, 1);
        logger.info(
          {
            data,
            messageId: message.messageId,
          },
          'increased reputation due to upvote',
        );
      }
    } catch (err) {
      logger.error(
        {
          data,
          messageId: message.messageId,
          err,
        },
        'failed to increase reputation due to upvote',
      );
    }
  },
};

export default worker;
