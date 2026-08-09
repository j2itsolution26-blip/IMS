'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { SettingDefinition } from '@/lib/settings-definitions';
import { updateSettings } from '@/features/admin/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Settings editor.
 *
 * Controls are chosen from each setting's declared type, so adding a setting to
 * the catalogue makes it editable here with no further UI work.
 */

const GROUP_META: Record<string, { title: string; description: string }> = {
  company: {
    title: 'Company',
    description: 'Printed on receipts and used as headers on exported reports.',
  },
  regional: {
    title: 'Regional',
    description: 'How money is formatted throughout the application.',
  },
  inventory: {
    title: 'Inventory',
    description: 'These thresholds decide what counts as low, critical, slow moving, and dead stock.',
  },
  sales: {
    title: 'Sales & POS',
    description: 'Defaults applied at the till and the threshold for large-sale alerts.',
  },
};

export function SettingsForm({
  definitions,
  values,
  canEdit,
}: {
  definitions: SettingDefinition[];
  values: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(values);
  const [saving, setSaving] = React.useState(false);

  const dirty = React.useMemo(
    () => Object.keys(draft).some((key) => draft[key] !== values[key]),
    [draft, values],
  );

  const groups = React.useMemo(() => {
    const map = new Map<string, SettingDefinition[]>();
    for (const definition of definitions) {
      const list = map.get(definition.group) ?? [];
      list.push(definition);
      map.set(definition.group, list);
    }
    return [...map.entries()];
  }, [definitions]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);

    const result = await updateSettings(draft);
    setSaving(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(
      result.data === 0 ? 'Nothing to save.' : `${result.data} setting${result.data === 1 ? '' : 's'} updated.`,
    );
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {groups.map(([group, items]) => {
        const meta = GROUP_META[group] ?? { title: group, description: '' };

        return (
          <Card key={group}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{meta.title}</CardTitle>
              {meta.description && <CardDescription>{meta.description}</CardDescription>}
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {items.map((definition) => {
                const value = draft[definition.key] ?? definition.value;

                if (definition.type === 'BOOLEAN') {
                  return (
                    <div
                      key={definition.key}
                      className="flex items-start justify-between gap-4 rounded-md border p-3 sm:col-span-2"
                    >
                      <div className="min-w-0">
                        <Label htmlFor={definition.key}>{definition.label}</Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">{definition.description}</p>
                      </div>
                      <Switch
                        id={definition.key}
                        checked={value === 'true'}
                        disabled={!canEdit}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({ ...current, [definition.key]: checked ? 'true' : 'false' }))
                        }
                      />
                    </div>
                  );
                }

                return (
                  <div key={definition.key} className="space-y-1.5">
                    <Label htmlFor={definition.key}>{definition.label}</Label>
                    <Input
                      id={definition.key}
                      type={definition.type === 'NUMBER' ? 'number' : 'text'}
                      step={definition.type === 'NUMBER' ? 'any' : undefined}
                      value={value}
                      disabled={!canEdit}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [definition.key]: event.target.value }))
                      }
                      aria-describedby={`${definition.key}-description`}
                    />
                    <p id={`${definition.key}-description`} className="text-xs text-muted-foreground">
                      {definition.description}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      {canEdit && (
        <div className="sticky bottom-4 flex justify-end">
          <Button type="submit" loading={saving} disabled={!dirty}>
            {dirty ? 'Save changes' : 'No changes'}
          </Button>
        </div>
      )}

      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          You have read-only access to settings. Ask an administrator to make changes.
        </p>
      )}
    </form>
  );
}
