import { Injectable } from '@nestjs/common';

/** A comment on a Ticket or a PR (`issue_comment.created`): who and when, never what it says (ADR 0003). */
export interface TicketCommentEvent {
  readonly projectId: string;
  readonly issueNumber: number;
  readonly commentId: number;
  readonly author: string;
  readonly isPullRequest: boolean;
  readonly createdAt: string;
}

/** A review of a PR (`pull_request_review.submitted`): who, its verdict and the commit it judged, never its body. */
export interface PullRequestReviewEvent {
  readonly projectId: string;
  readonly prNumber: number;
  readonly reviewer: string;
  readonly state: string;
  readonly commitId: string | null;
}

type Listener<T> = (event: T) => void | Promise<void>;

/**
 * What happens on a Ticket or a PR that the tables do not keep, forwarded in
 * process to the modules that react to it (BOUCLE-5, BOUCLE-6), which read
 * its content in the browser. A listener runs in the Pilote's scope, after
 * the webhook's writes; one that throws fails the webhook's handler alone.
 */
@Injectable()
export class TicketActivity {
  private readonly comments: Listener<TicketCommentEvent>[] = [];
  private readonly reviews: Listener<PullRequestReviewEvent>[] = [];

  onComment(listener: Listener<TicketCommentEvent>): void {
    this.comments.push(listener);
  }

  onReview(listener: Listener<PullRequestReviewEvent>): void {
    this.reviews.push(listener);
  }

  async comment(event: TicketCommentEvent): Promise<void> {
    for (const listener of this.comments) await listener(event);
  }

  async review(event: PullRequestReviewEvent): Promise<void> {
    for (const listener of this.reviews) await listener(event);
  }
}
