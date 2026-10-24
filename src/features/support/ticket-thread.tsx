import { Info, Lock, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import type { ThreadMessage } from '@/server/support/support-service';

/**
 * A ticket's conversation, oldest first. Every message body is rendered as
 * text by React (never as HTML), with line breaks kept, so nothing a
 * requester or administrator types can run in anyone's browser.
 *
 * Internal notes only ever reach this component on the administrators' page;
 * the requester's query never selects them. They are still drawn unmistakably
 * differently, so an administrator always knows who can read what.
 */
export function TicketThread({ messages, viewer }: { messages: ThreadMessage[]; viewer: 'requester' | 'admin' }) {
  return (
    <ol className="space-y-4" aria-label="Conversation">
      {messages.map((message) => {
        if (message.authorKind === 'SYSTEM') {
          return (
            <li key={message.id} className="flex items-start justify-center gap-2 px-2 text-center text-xs text-muted-foreground">
              {message.visibility === 'INTERNAL' ? (
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label="Internal" />
              ) : (
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>
                {message.body} · <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
              </span>
            </li>
          );
        }

        const internal = message.visibility === 'INTERNAL';
        const mine = viewer === 'requester' ? message.authorKind === 'REQUESTER' : message.authorKind === 'ADMIN';
        return (
          <li key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
            <article
              className={cn(
                'w-full max-w-[min(100%,40rem)] rounded-2xl border p-4 text-sm',
                internal
                  ? 'border-dashed border-warning/50 bg-warning/10'
                  : mine
                    ? 'border-primary/20 bg-primary/5'
                    : 'bg-card',
              )}
              aria-label={internal ? `Internal note by ${message.authorName}` : `Message from ${message.authorName}`}
            >
              <header className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="flex items-center gap-1.5 font-semibold">
                  {internal && <Lock className="h-3.5 w-3.5 text-warning-text" aria-hidden="true" />}
                  {message.authorName}
                  {internal && (
                    <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-warning-text">
                      Internal note · not visible to the requester
                    </span>
                  )}
                </p>
                <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
                  {formatDateTime(message.createdAt)}
                </time>
              </header>
              <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
              {message.attachments.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
                  {message.attachments.map((file) => (
                    <li key={file.id}>
                      <a
                        href={`/api/support/attachments/${file.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block overflow-hidden rounded-lg border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- a one-minute signed URL behind an access check; next/image would cache it */}
                        <img
                          src={`/api/support/attachments/${file.id}`}
                          alt={`Screenshot ${file.name}`}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-28 w-40 object-cover transition-opacity group-hover:opacity-90"
                        />
                        <span className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
                          <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="max-w-[8.5rem] truncate">{file.name}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
