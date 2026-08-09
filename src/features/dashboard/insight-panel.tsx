import Link from 'next/link';
import { ArrowRight, Lightbulb, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import type { Insight, InsightTone } from '@/server/analytics/insights';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const TONE_ICON: Record<InsightTone, typeof TrendingUp> = {
  positive: TrendingUp,
  negative: TrendingDown,
  warning: TriangleAlert,
  neutral: Lightbulb,
};

const TONE_STYLE: Record<InsightTone, string> = {
  positive: 'bg-success/10 text-success',
  negative: 'bg-destructive/10 text-destructive',
  warning: 'bg-warning/15 text-warning',
  neutral: 'bg-primary/10 text-primary',
};

/**
 * Generated observations.
 *
 * When the data does not support any statement, this says so plainly instead of
 * inventing filler — a panel of made-up bullets would be worse than an empty one.
 */
export function InsightPanel({ insights }: { insights: Insight[] }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4 text-primary" aria-hidden="true" />
          Insights
        </CardTitle>
        <CardDescription>Generated from your live trading and stock data.</CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        {insights.length === 0 ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center">
            <Lightbulb className="mb-2 h-7 w-7 text-muted-foreground/40" aria-hidden="true" />
            <p className="text-sm font-medium">Nothing noteworthy yet</p>
            <p className="mt-1 max-w-[15rem] text-xs text-muted-foreground">
              Once you have recorded some sales and stock movements, trends and warnings will show up here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {insights.map((insight) => {
              const Icon = TONE_ICON[insight.tone];
              const content = (
                <>
                  <span
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      TONE_STYLE[insight.tone],
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug">{insight.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {insight.detail}
                    </span>
                  </span>
                  {insight.href && (
                    <ArrowRight
                      className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  )}
                </>
              );

              return (
                <li key={insight.id}>
                  {insight.href ? (
                    <Link
                      href={insight.href}
                      className="group flex gap-2.5 rounded-md p-1.5 -m-1.5 transition-colors hover:bg-accent/60"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex gap-2.5">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
